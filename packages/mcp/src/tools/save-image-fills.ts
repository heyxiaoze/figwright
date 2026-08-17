import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import type { ImageFillsResult, NodeImageFills } from '@figwright/shared';
import { z } from 'zod';

import {
  ASSET_TOKEN_RESULT_NOTE,
  ASSET_URL_RESULT_NOTE,
  buildAssetUrl,
  getPublicBaseUrl,
  getTransferManager,
  isDirectDelivery,
} from '../transfer.js';
import type {
  RemoteSavedImageFill,
  RemoteSavedNodeImageFills,
  RemoteSaveImageFillsResult,
} from '../bridge-schema.js';
import type { ToolSpec } from './spec.js';

export const SAVE_IMAGE_FILLS_TOOL_NAME = 'save_image_fills';

const inputSchema = z.object({
  nodeIds: z.array(z.string()).describe('Figma node ids whose IMAGE fills to extract'),
  outDir: z
    .string()
    .describe('Directory to write the original image files into (created if missing)'),
});

export const saveImageFillsTool: ToolSpec = {
  name: SAVE_IMAGE_FILLS_TOOL_NAME,
  description:
    "Extract the ORIGINAL image bytes behind each node's IMAGE fills and write them to disk under " +
    'outDir — the source asset exactly as uploaded (no mask, clip, crop, scale, or effects applied), ' +
    'unlike save_screenshots / get_screenshot which re-render the composited node. Returns ' +
    '{ nodes: [{ nodeId, nodeName?, parentName?, images: [{ index, imageHash, format, path, relativePath?, assetToken?, base64? (inline mode only), width?, height?, scaleMode? }], ' +
    'mixed? }] }. File names are lowercased and restricted to [a-z0-9-] (spaces and any other ' +
    'character collapse to a single hyphen). Files follow the structured convention `IMG-[location]-[name][-index].[ext]` where ' +
    'location is the parent Figma layer (parentName) and name is this layer (nodeName) — e.g. ' +
    '`IMG-Blog-1-Cover.png` or `IMG-Blog-1-Gallery-3.jpg`. With no parent it falls back to `IMG-[name]`, ' +
    'and with a missing/colliding name it falls back to the imageHash, so identical images (same ' +
    'imageHash reused across nodes) still share one file. index is added only with multiple image ' +
    'fills and is the paint position in node.fills; width/height are the image intrinsic size; ' +
    'scaleMode is how the fill is displayed (FILL / FIT / CROP / TILE); format is sniffed from the ' +
    'bytes (PNG / JPG / GIF / WEBP, or BIN if unrecognized). path (and relativePath) is null when the ' +
    'fill image cannot be resolved; images:[] means the ' +
    'node has no image fill; mixed:true means the node fills are per-text-range and were not ' +
    'enumerated. Each image returns `assetToken` when the server has a WebDAV/SFTP transfer target ' +
    'configured, and `base64` ONLY in inline mode (no transfer target). path is always relative to ' +
    'outDir (filename only) — it never exposes the server filesystem. When THIS MCP CLIENT RUNS ON ' +
    'A DIFFERENT MACHINE than the server (a remote partner connected over the LAN/streamable-MCP), ' +
    '`path`/`relativePath` point at the server’s disk and are unreachable from your machine. HOW TO ' +
    'RETRIEVE THE BYTES: (1) when `assetToken` is present, call fetch_asset(token) to pull the bytes ' +
    'over the MCP connection (credentials never leave the server; the staged copy is deleted on ' +
    'fetch), then write them into your own code project — this is the primary path and returns NO ' +
    'base64; (2) only when `assetToken` is ABSENT (inline mode) is `base64` returned — decode it and ' +
    "write the bytes to your own machine’s asset directory. Do NOT assume base64 is always present; " +
    'when a transfer target is configured it is intentionally omitted to keep responses small. For a ' +
    'rendered/composited raster use ' +
    'save_screenshots; for a vector node use export_pdf.',
  inputSchema,
  kind: 'local',
};

/**
 * Sniff the container from the leading magic bytes so the file lands with the right extension. Only
 * the formats Figma stores as image fills are recognized; anything else is written verbatim as
 * `.bin` (lossless — the bytes are preserved, only the label is generic).
 */
export const detectImageFormat = (bytes: Buffer): { format: string; ext: string } => {
  if (
    bytes.length >= 4 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return { format: 'PNG', ext: 'png' };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return { format: 'JPG', ext: 'jpg' };
  if (bytes.length >= 3 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46)
    return { format: 'GIF', ext: 'gif' };
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  )
    return { format: 'WEBP', ext: 'webp' };
  return { format: 'BIN', ext: 'bin' };
};

/**
 * Map a name to a filesystem-safe basename: lowercase, only [a-z0-9-] survive, any other character
 * (spaces, punctuation, non-ASCII) collapses to a single hyphen, runs of hyphens are merged, and
 * leading/trailing hyphens are trimmed. An empty result falls back to 'image'.
 */
/**
 * Normalize an outDir supplied by a caller before resolving it on the server. A remote partner often
 * passes its OWN machine's path (e.g. `c:\project\public\images`). On the server OS that string is
 * neither a drive nor a separator, so path.resolve() would append it verbatim under the server cwd
 * and produce a garbage path like `<repo>/c:\project\...`. Strip a Windows drive prefix and turn
 * backslashes into forward slashes so the value becomes a clean relative sub-folder. Absolute POSIX
 * paths (local same-machine use) are left intact.
 */
const normalizeOutDir = (raw: string): string =>
  raw.replace(/^[A-Za-z]:[\\/]+/, '').replace(/\\/g, '/').trim();

const sanitize = (name: string): string => {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'image';
};

/** Carry the identifying/display fields through from the plugin result to the write result. */
const carry = (
  img: NodeImageFills['images'][number],
  includeBase64: boolean,
): Omit<RemoteSavedImageFill, 'format' | 'path' | 'relativePath'> => ({
  index: img.index,
  imageHash: img.imageHash,
  // base64 is included only in inline mode. When a transfer target is configured the partner must
  // use `assetToken` + `fetch_asset` instead, so we drop the inline bytes to keep the result small
  // (a remote agent feeding base64 back into its own context blows up the token budget).
  ...(includeBase64 ? { base64: img.base64 } : {}),
  ...(img.width !== undefined ? { width: img.width } : {}),
  ...(img.height !== undefined ? { height: img.height } : {}),
  ...(img.scaleMode !== undefined ? { scaleMode: img.scaleMode } : {}),
});

/**
 * Decode the base64 image bytes into files under outDir (created if missing). Files follow the
 * structured convention `IMG-[location]-[name][-index]` (location = parent layer, name = this
 * layer) so the export self-describes where the asset lives and what it depicts; with no parent it
 * falls back to `IMG-[name]`, and with a missing/colliding name it falls back to the imageHash as a
 * guaranteed-unique label. Identical images (same imageHash reused across nodes) are written exactly
 * once and named after the FIRST node that referenced them; every usage still gets its own result
 * entry pointing at the shared path. Pure-fs and dispatch-free so it can be unit-tested against a
 * temp directory.
 */
export const writeImageFills = async (
  outDir: string,
  nodes: readonly NodeImageFills[],
): Promise<RemoteSaveImageFillsResult> => {
  const dir = resolve(normalizeOutDir(outDir));
  await mkdir(dir, { recursive: true });

  // A transfer target (WebDAV/SFTP) configured means the partner should pull bytes via assetToken +
  // fetch_asset, so we omit inline base64 from the result. In inline mode (no target) base64 stays.
  const mgr = getTransferManager();
  const transferActive = mgr !== null;
  // Direct-delivery mode: hand back a download URL instead of an assetToken (zero base64 over MCP).
  const directDelivery = isDirectDelivery();

  // Dedup writes by imageHash: a hash reused across nodes maps to one file written once. Track the
  // occupied paths so a different hash that sanitizes to the same name cleanly falls back to the hash.
  const toWrite = new Map<string, Buffer>();
  const hashToPath = new Map<string, { path: string; format: string }>();
  const occupied = new Set<string>();

  const outNodes: RemoteSavedNodeImageFills[] = nodes.map(node => {
    const multi = node.images.length > 1;
    const images: RemoteSavedImageFill[] = node.images.map(img => {
      if (img.base64 === null || img.imageHash === null)
        return { ...carry(img, !transferActive), path: null, relativePath: null };

      const existing = hashToPath.get(img.imageHash);
      if (existing !== undefined) {
        const relPath = relative(dir, existing.path);
        return {
          ...carry(img, !transferActive),
          format: existing.format,
          path: relPath,
          relativePath: relPath,
        };
      }

      const buf = Buffer.from(img.base64, 'base64');
      const { format, ext } = detectImageFormat(buf);
      // Structured name: IMG-[location]-[name] where location = parent layer, name = this layer.
      // Falls back to IMG-[name] when there's no parent, then to the bare imageHash when the name is
      // absent too. The index suffix is added only when the node has multiple image fills.
      const loc = node.parentName?.trim();
      const name = node.nodeName?.trim();
      let base: string;
      if (loc && name) base = `IMG-${sanitize(loc)}-${sanitize(name)}`;
      else if (name) base = `IMG-${sanitize(name)}`;
      else base = sanitize(img.imageHash);
      const structured = loc !== undefined || name !== undefined;
      const suffix = structured && multi ? `-${img.index}` : '';
      let candidate = join(dir, `${base}${suffix}.${ext}`);
      let guard = 0;
      while (occupied.has(candidate)) {
        candidate = join(dir, `${sanitize(img.imageHash)}-${guard++}.${ext}`);
      }
      occupied.add(candidate);
      hashToPath.set(img.imageHash, { path: candidate, format });
      toWrite.set(candidate, buf);
      // Return only the outDir-relative path — never the server's absolute filesystem path.
      // Remote peers see a clean name; local callers can resolve against their own outDir.
      const relPath = relative(dir, candidate);
      return { ...carry(img, !transferActive), format, path: relPath, relativePath: relPath };
    });
    return {
      nodeId: node.nodeId,
      images,
      ...(node.nodeName !== undefined ? { nodeName: node.nodeName } : {}),
      ...(node.parentName !== undefined ? { parentName: node.parentName } : {}),
      ...(node.mixed === true ? { mixed: true } : {}),
    };
  });

  await Promise.all([...toWrite].map(([path, buf]) => writeFile(path, buf)));

  // Staged transfer: when a WebDAV/SFTP target is configured, upload each unique file once and mint
  // a one-time token the remote partner redeems via fetch_asset (credentials stay server-side; the
  // staged copy is deleted on fetch). base64 is omitted from the result in this mode (no inline
  // fallback), so staging must succeed — a failure here aborts the whole save rather than silently
  // leaving the partner with neither bytes nor a token.
  if (mgr) {
    const pathToToken = new Map<string, string>();
    await Promise.all(
      [...toWrite].map(async ([p, buf]) => {
        // Key by relative path (same as img.path) so the lookup below matches.
        const relKey = relative(dir, p);
        pathToToken.set(relKey, await mgr.stage(p.split('/').pop() ?? 'image', buf));
      }),
    );
    for (const node of outNodes) {
      for (const img of node.images) {
        if (img.path && pathToToken.has(img.path)) {
          const token = pathToToken.get(img.path)!;
          if (directDelivery) img.assetUrl = buildAssetUrl(token, getPublicBaseUrl());
          else img.assetToken = token;
        }
      }
    }
  }

  return {
    nodes: outNodes,
    ...(transferActive ? { note: directDelivery ? ASSET_URL_RESULT_NOTE : ASSET_TOKEN_RESULT_NOTE } : {}),
  };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side save_image_fills handler to fetch the original fill bytes, then lands them
 * on the server filesystem.
 */
export const handleSaveImageFills = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<RemoteSaveImageFillsResult> => {
  const args = inputSchema.parse(rawArgs);
  const { nodes } = (await dispatch(SAVE_IMAGE_FILLS_TOOL_NAME, {
    nodeIds: args.nodeIds,
  })) as ImageFillsResult;
  return writeImageFills(args.outDir, nodes);
};
