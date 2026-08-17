import type { ImageFillBytes, ImageFillsResult, NodeImageFills } from '@figwright/shared';

import type { SandboxToolHandler } from '../dispatcher.js';

/** Bytes + intrinsic size for one resolved image hash. Width/height are optional: some fills can't
 * report dimensions (see fetchImage), and the bytes are what actually get saved. */
interface ResolvedImage {
  base64: string;
  width?: number;
  height?: number;
}

/**
 * Extract the ORIGINAL bytes behind each node's IMAGE fills via getImageByHash().getBytesAsync() —
 * the asset as uploaded, with no mask / clip / crop / scale / effects applied (that is what
 * get_screenshot's exportAsync bakes in). Read-only: reading image bytes never mutates the
 * document.
 *
 * The same imageHash (a logo reused across many nodes) is fetched exactly once per call — the byte
 * fetch + size lookup is memoized by hash, so a design that repeats one asset doesn't re-download
 * it N times.
 */
export const createSaveImageFillsHandler =
  (figmaCtx: typeof figma): SandboxToolHandler =>
  async params => {
    const p = (params ?? {}) as { nodeIds?: unknown };
    if (
      !Array.isArray(p.nodeIds) ||
      p.nodeIds.length === 0 ||
      p.nodeIds.some(id => typeof id !== 'string')
    ) {
      throw new TypeError('save_image_fills: nodeIds must be a non-empty string[]');
    }

    const cache = new Map<string, Promise<ResolvedImage | null>>();
    const fetchImage = (hash: string): Promise<ResolvedImage | null> => {
      let pending = cache.get(hash);
      if (pending === undefined) {
        pending = (async (): Promise<ResolvedImage | null> => {
          const image = figmaCtx.getImageByHash(hash);
          if (image === null) return null;
          // Read bytes first — this forces the image to load. Dimensions are only advisory metadata
          // on the saved file; some fills (e.g. images not yet painted into the document) reject
          // getSizeAsync() with "Image dimensions not available", so tolerate that and fall back to
          // unknown dimensions rather than failing the whole export with INTERNAL_ERROR.
          const bytes = await image.getBytesAsync();
          let width: number | undefined;
          let height: number | undefined;
          try {
            const size = await image.getSizeAsync();
            width = size.width;
            height = size.height;
          } catch {
            /* dimensions unavailable — omit them; bytes are still valid */
          }
          // exactOptionalPropertyTypes: spread only the dimensions that actually resolved.
          return {
            base64: figmaCtx.base64Encode(bytes),
            ...(width !== undefined ? { width } : {}),
            ...(height !== undefined ? { height } : {}),
          };
        })();
        cache.set(hash, pending);
      }
      return pending;
    };

    const ids = p.nodeIds as readonly string[];
    const nodes: NodeImageFills[] = await Promise.all(
      ids.map(async (nodeId): Promise<NodeImageFills> => {
        const node = await figmaCtx.getNodeByIdAsync(nodeId);
        if (node === null || !('fills' in node)) return { nodeId, images: [] };

        const fills = (node as unknown as { fills: readonly Paint[] | typeof figma.mixed }).fills;
        // Mixed fills (per-text-range) can't be indexed as an array — flag rather than crash.
        if (fills === figmaCtx.mixed)
          return {
            nodeId,
            nodeName: node.name,
            parentName: node.parent?.name ?? undefined,
            images: [],
            mixed: true,
          };

        // Fetch every fill's bytes in parallel (shared hashes still resolve once via the memoized
        // cache), then drop the non-image paints — keeps fill order without an await in a loop.
        const entries = await Promise.all(
          fills.map(async (paint, index): Promise<ImageFillBytes | null> => {
            if (paint.type !== 'IMAGE') return null;
            const { scaleMode } = paint;
            const imageHash = paint.imageHash ?? null;
            if (imageHash === null) return { index, imageHash: null, base64: null, scaleMode };
            const data = await fetchImage(imageHash);
            if (data === null) return { index, imageHash, base64: null, scaleMode };
            return {
              index,
              imageHash,
              base64: data.base64,
              width: data.width,
              height: data.height,
              scaleMode,
            };
          }),
        );
        const images = entries.filter((e): e is ImageFillBytes => e !== null);
        return { nodeId, nodeName: node.name, parentName: node.parent?.name ?? undefined, images };
      }),
    );

    const result: ImageFillsResult = { nodes };
    return result;
  };
