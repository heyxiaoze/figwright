import type { CreateResult } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';
import { placeNode } from './place.js';

const SCALE_MODES = ['FILL', 'FIT', 'CROP', 'TILE'] as const;
type ScaleMode = (typeof SCALE_MODES)[number];

/**
 * Import an image and place it as a rectangle with an IMAGE fill. Source is either base64 `data`
 * (decoded with figma.base64Decode) or a `url` (fetched via createImageAsync — manifest allows it).
 * The rectangle defaults to the image's intrinsic size unless width/height are given.
 */
export const createImportImageHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as {
      data?: unknown;
      url?: unknown;
      name?: unknown;
      parentId?: unknown;
      x?: unknown;
      y?: unknown;
      width?: unknown;
      height?: unknown;
      scaleMode?: unknown;
    };
    if (typeof p.data !== 'string' && typeof p.url !== 'string') {
      throw new TypeError('import_image: provide data (base64) or url');
    }
    const scaleMode: ScaleMode = SCALE_MODES.includes(p.scaleMode as ScaleMode)
      ? (p.scaleMode as ScaleMode)
      : 'FILL';

    const image =
      typeof p.data === 'string'
        ? figmaCtx.createImage(figmaCtx.base64Decode(p.data))
        : await figmaCtx.createImageAsync(p.url as string);

    // Dimensions are only needed to size the placed rectangle. getSizeAsync() can reject with
    // "Image dimensions not available" for an image that isn't loaded yet, so tolerate that and fall
    // back to the caller's explicit size (if any) or the default rectangle size.
    let width: number | undefined;
    let height: number | undefined;
    try {
      const size = await image.getSizeAsync();
      width = size.width;
      height = size.height;
    } catch {
      /* dimensions unavailable — use explicit size or leave the default rectangle size */
    }

    const rect = figmaCtx.createRectangle();
    if (typeof p.name === 'string') rect.name = p.name;
    if (typeof p.width === 'number' || typeof p.height === 'number' || width !== undefined) {
      rect.resize(
        typeof p.width === 'number' ? p.width : (width ?? 100),
        typeof p.height === 'number' ? p.height : (height ?? 100),
      );
    }
    if (typeof p.x === 'number') rect.x = p.x;
    if (typeof p.y === 'number') rect.y = p.y;
    rect.fills = [{ type: 'IMAGE', scaleMode, imageHash: image.hash }];

    await placeNode(figmaCtx, rect, p.parentId, 'import_image');

    const result: CreateResult = { ok: true, nodeId: rect.id, name: rect.name, type: rect.type };
    return result;
  };
