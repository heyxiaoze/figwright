import { z } from 'zod';

import type { ToolSpec } from './spec.js';

export const FETCH_ASSET_TOOL_NAME = 'fetch_asset';

/** Map a file name's extension to a MIME type for the inline image block. */
const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
};

export const mimeForName = (name: string): string => {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
};

/**
 * Retrieve a staged export asset by its one-time token. The server pulls the file from its staging
 * store (WebDAV/SFTP) using credentials that never leave the server, returns the raw bytes — so a
 * remote partner agent can write them into its own code project for seamless figma-to-code across
 * machines — and then deletes the staged copy. A used or expired token returns an error. Available
 * to read-only partners, since fetching their own assets is part of the read/codegen flow.
 */
export const fetchAssetTool: ToolSpec = {
  name: FETCH_ASSET_TOOL_NAME,
  description:
    'Retrieve a staged export asset by its one-time token and return the raw bytes, so a remote ' +
    'partner agent can write the file into its own code project (seamless figma-to-code across ' +
    'machines). The save_image_fills / save_screenshots results include `assetToken` per exported ' +
    'image when the server is configured with a WebDAV/SFTP transfer target. Call this with that ' +
    'token: the server fetches the file from its staging store (credentials never leave the server) ' +
    'and returns it, then deletes the staged copy. Returns { fileName, base64, bytes } plus an image ' +
    'block for raster assets. Tokens expire after ~10 minutes; a used or expired token returns an ' +
    'error. Available to read-only partners (it is how they receive their assets).',
  inputSchema: z.object({
    token: z.string().describe('One-time asset token from a save_* result'),
  }),
  // Server-only: resolves a staged asset and never dispatches to the plugin, so it is 'local'
  // (excluded from the plugin argument-contract derivation) yet still advertised to every client,
  // including read-only partners (fetching their own assets is part of the read/codegen flow).
  kind: 'local',
};

/** Build MCP content blocks for a fetched asset. */
export const assetContent = (
  name: string,
  bytes: Buffer,
): { type: 'text'; text: string }[] | ({ type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string })[] => {
  const b64 = bytes.toString('base64');
  const mime = mimeForName(name);
  const blocks: ({ type: 'image'; data: string; mimeType: string } | { type: 'text'; text: string })[] = [];
  if (mime.startsWith('image/')) {
    blocks.push({ type: 'image', data: b64, mimeType: mime });
  }
  blocks.push({
    type: 'text',
    text: JSON.stringify({ fileName: name, base64: b64, bytes: bytes.length }),
  });
  return blocks;
};
