import { mkdir, writeFile } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';

import type {
  ImageFillsResult,
  NodeImageFills,
  SaveImageFillsResult,
  SavedImageFill,
  SavedNodeImageFills,
} from '@figwright/shared';
import { z } from 'zod';

import { getTransferManager } from '../transfer.js';
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
    '{ nodes: [{ nodeId, nodeName?, parentName?, images: [{ index, imageHash, format, path, relativePath?, base64, assetToken?, width?, height?, scaleMode? }], ' +
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
    'enumerated. Each image ALSO returns `base64` — the original encoded bytes. When THIS MCP CLIENT ' +
    'RUNS ON A DIFFERENT MACHINE than the server (a remote partner connected over the LAN/streamable-MCP), ' +
    '`path`/`relativePath` point at the server’s disk and are unreachable from your machine. Retrieve ' +
    'the file in one of two ways: (1) if the server is configured with a WebDAV/SFTP transfer target, ' +
    'each image includes `assetToken` — call fetch_asset(token) to pull the bytes over the MCP ' +
    'connection (credentials never leave the server; the staged copy is deleted on fetch), then write ' +
    'them into your own code project; (2) otherwise decode `base64` and write the bytes to your own ' +
    "machine’s asset directory so the file exists locally. For a rendered/composited raster use " +
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
const carry = (img: NodeImageFills['images'][number]): Omit<
  SavedImageFill,
  'format' | 'path' | 'relativePath'
> => ({
  index: img.index,
  imageHash: img.imageHash,
  // Carried so a remote partner (whose machine can't see this server's `path`) can decode + write
  // the bytes on its own disk. Null when the fill couldn't be resolved (matches `path: null`).
  base64: img.base64,
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
): Promise<SaveImageFillsResult> => {
  const dir = resolve(outDir);
  await mkdir(dir, { recursive: true });

  // Dedup writes by imageHash: a hash reused across nodes maps to one file written once. Track the
  // occupied paths so a different hash that sanitizes to the same name cleanly falls back to the hash.
  const toWrite = new Map<string, Buffer>();
  const hashToPath = new Map<string, { path: string; format: string }>();
  const occupied = new Set<string>();

  const outNodes: SavedNodeImageFills[] = nodes.map(node => {
    const multi = node.images.length > 1;
    const images: SavedImageFill[] = node.images.map(img => {
      if (img.base64 === null || img.imageHash === null)
        return { ...carry(img), path: null, relativePath: null };

      const existing = hashToPath.get(img.imageHash);
      if (existing !== undefined)
        return {
          ...carry(img),
          format: existing.format,
          path: existing.path,
          relativePath: relative(dir, existing.path),
        };

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
      return { ...carry(img), format, path: candidate, relativePath: relative(dir, candidate) };
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

  // Staged transfer: if a WebDAV/SFTP target is configured, upload each unique file once and mint a
  // one-time token the remote partner redeems via fetch_asset (credentials stay server-side; the
  // staged copy is deleted on fetch). Best-effort — on failure the partner still has `base64`.
  const mgr = getTransferManager();
  if (mgr) {
    const pathToToken = new Map<string, string>();
    await Promise.all(
      [...toWrite].map(async ([p, buf]) => {
        try {
          pathToToken.set(p, await mgr.stage(p.split('/').pop() ?? 'image', buf));
        } catch {
          /* transfer unavailable — fall back to inline base64 */
        }
      }),
    );
    for (const node of outNodes) {
      for (const img of node.images) {
        if (img.path && pathToToken.has(img.path)) img.assetToken = pathToToken.get(img.path)!;
      }
    }
  }

  return { nodes: outNodes };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side save_image_fills handler to fetch the original fill bytes, then lands them
 * on the server filesystem.
 */
export const handleSaveImageFills = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveImageFillsResult> => {
  const args = inputSchema.parse(rawArgs);
  const { nodes } = (await dispatch(SAVE_IMAGE_FILLS_TOOL_NAME, {
    nodeIds: args.nodeIds,
  })) as ImageFillsResult;
  return writeImageFills(args.outDir, nodes);
};
