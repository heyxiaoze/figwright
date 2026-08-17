import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  type GetScreenshotResult,
  type SavedScreenshot,
  type SaveScreenshotsResult,
  SCREENSHOT_FORMATS,
  type ScreenshotImage,
} from '@figwright/shared';
import { z } from 'zod';

import { GET_SCREENSHOT_TOOL_NAME } from './get-screenshot.js';
import { getTransferManager, ASSET_TOKEN_RESULT_NOTE } from '../transfer.js';
import type { ToolSpec } from './spec.js';

export const SAVE_SCREENSHOTS_TOOL_NAME = 'save_screenshots';

const inputSchema = z.object({
  nodeIds: z.array(z.string()).describe('Figma node ids to export'),
  outDir: z.string().describe('Directory to write files into (created if missing)'),
  format: z
    .enum(SCREENSHOT_FORMATS)
    .describe('Export format: PNG (default) / JPG / SVG')
    .optional(),
  scale: z.number().positive().describe('Raster scale factor (PNG/JPG), default 1').optional(),
});

export const saveScreenshotsTool: ToolSpec = {
  name: SAVE_SCREENSHOTS_TOOL_NAME,
  description:
    'Export nodes and write them to disk under outDir: { saved: [{ nodeId, format, path, assetToken?, base64? (inline only), recovered?, empty? }] }. ' +
    'format is PNG (default) / JPG / SVG; scale applies to raster formats (default 1). ' +
    'path is null for missing or non-exportable nodes. Each entry returns `assetToken` when the server has a ' +
    'WebDAV/SFTP transfer target configured, and `base64` ONLY in inline mode (no transfer target). ' +
    'path is always relative to outDir (filename only) — it never exposes the server filesystem. When ' +
    'THIS MCP CLIENT RUNS ON A DIFFERENT MACHINE than the server (a remote partner connected over the ' +
    'LAN/streamable-MCP), `path` points at the server’s disk and is unreachable from your machine. HOW TO ' +
    'RETRIEVE THE BYTES: (1) when `assetToken` is present, call fetch_asset(token) to pull the bytes over ' +
    'the MCP connection (credentials never leave the server; the staged copy is deleted on fetch), then ' +
    'write them into your own code project — this is the primary path and returns NO base64; (2) only ' +
    'when `assetToken` is ABSENT (inline mode) is `base64` returned — decode it and write the file to your ' +
    'own `outDir`. Do NOT assume base64 is always present; when a transfer target is configured it is ' +
    'intentionally omitted to keep responses small. Nodes that are fully clipped or off-canvas ' +
    "(e.g. a carousel's edge items) are auto-recovered at their intrinsic bounds and flagged recovered:true. " +
    'empty:true means the node genuinely renders nothing even unclipped (hidden / no content) so the file is blank. ' +
    'Files are named after a sanitized node id.',
  inputSchema,
  kind: 'local',
};
const EXTENSIONS: Record<string, string> = { PNG: 'png', JPG: 'jpg', SVG: 'svg' };

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

/** Map a Figma node id (e.g. "1:2") to a filesystem-safe basename, blocking path traversal. */
const sanitize = (id: string): string => id.replace(/[^\w.-]/g, '-');

/**
 * Decode the base64 images into files under outDir (created if missing). Pure-fs and dispatch-free
 * so it can be unit-tested against a temp directory.
 */
export const writeScreenshots = async (
  outDir: string,
  images: readonly ScreenshotImage[],
): Promise<SaveScreenshotsResult> => {
  const dir = resolve(normalizeOutDir(outDir));
  await mkdir(dir, { recursive: true });

  // A transfer target (WebDAV/SFTP) configured means the partner should pull bytes via assetToken +
  // fetch_asset, so we omit inline base64 from the result. In inline mode (no target) base64 stays.
  const mgr = getTransferManager();

  const saved: SavedScreenshot[] = await Promise.all(
    images.map(async (img): Promise<SavedScreenshot> => {
      const flags = {
        ...(img.empty === true ? { empty: true as const } : {}),
        ...(img.recovered === true ? { recovered: true as const } : {}),
      };
      if (img.base64 === null)
        return {
          nodeId: img.nodeId,
          format: img.format,
          path: null,
          ...(mgr ? {} : { base64: null }),
          ...flags,
        };
      const ext = EXTENSIONS[img.format] ?? img.format.toLowerCase();
      const absPath = join(dir, `${sanitize(img.nodeId)}.${ext}`);
      await writeFile(absPath, Buffer.from(img.base64, 'base64'));
      // Return only the filename (outDir-relative) — never leak the server's absolute path.
      const relPath = `${sanitize(img.nodeId)}.${ext}`;
      const result: SavedScreenshot = {
        nodeId: img.nodeId,
        format: img.format,
        path: relPath,
        ...(mgr ? {} : { base64: img.base64 }),
        ...flags,
      };
      // Staged transfer: when a WebDAV/SFTP target is configured, upload the bytes and hand the
      // partner a one-time token (credentials stay server-side; they fetch via fetch_asset and the
      // copy is deleted). base64 is omitted in this mode, so staging must succeed — any failure
      // aborts the save rather than silently leaving the partner with neither bytes nor a token.
      if (mgr) {
        result.assetToken = await mgr.stage(
          `${sanitize(img.nodeId)}.${ext}`,
          Buffer.from(img.base64, 'base64'),
        );
      }
      return result;
    }),
  );

  return { saved, ...(mgr ? { note: ASSET_TOKEN_RESULT_NOTE } : {}) };
};

export type ToolDispatcher = (toolName: string, args: unknown) => Promise<unknown>;

/**
 * Reuses the plugin-side get_screenshot export (no dedicated plugin handler) to fetch base64 bytes,
 * then lands them on the server filesystem — the first server-side write tool.
 */
export const handleSaveScreenshots = async (
  dispatch: ToolDispatcher,
  rawArgs: unknown,
): Promise<SaveScreenshotsResult> => {
  const args = inputSchema.parse(rawArgs);

  const screenshotArgs: Record<string, unknown> = { nodeIds: args.nodeIds };
  if (args.format !== undefined) screenshotArgs.format = args.format;
  // Always pass an explicit scale: an omitted scale makes get_screenshot auto-fit the raster for
  // model consumption, but files written to disk are user artifacts and must stay full-res.
  screenshotArgs.scale = args.scale ?? 1;

  const { images } = (await dispatch(
    GET_SCREENSHOT_TOOL_NAME,
    screenshotArgs,
  )) as GetScreenshotResult;
  return writeScreenshots(args.outDir, images);
};
