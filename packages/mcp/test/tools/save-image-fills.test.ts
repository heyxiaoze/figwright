import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ImageFillsResult, NodeImageFills, SaveImageFillsResult } from '@figwright/shared';
import { afterEach, describe, expect, it } from 'vitest';

import {
  detectImageFormat,
  handleSaveImageFills,
  SAVE_IMAGE_FILLS_TOOL_NAME,
  saveImageFillsTool,
  type ToolDispatcher,
  writeImageFills,
} from '../../src/tools/save-image-fills.js';
import { setTransferManager, TransferManager, type AssetStore } from '../../src/transfer.js';
import { toToolDefinition } from '../tool-schema.js';

const saveImageFillsToolDefinition = toToolDefinition(saveImageFillsTool);

// Minimal magic-byte payloads, base64-encoded the way the plugin ships them over the wire.
const b64 = (bytes: number[]): string => Buffer.from(bytes).toString('base64');
const PNG_B64 = b64([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPG_B64 = b64([0xff, 0xd8, 0xff, 0xe0, 0x00]);

const emptyDispatch: ToolDispatcher = async () => ({ nodes: [] }) satisfies ImageFillsResult;

const dirs: string[] = [];
const makeDir = async (): Promise<string> => {
  const dir = await mkdtemp(join(tmpdir(), 'save-image-fills-'));
  dirs.push(dir);
  return dir;
};

afterEach(async () => {
  await Promise.all(dirs.map(d => rm(d, { recursive: true, force: true })));
  dirs.length = 0;
  // The transfer manager is a process-wide singleton the save tool reads via getTransferManager().
  setTransferManager(null);
});

/** In-memory AssetStore so we can drive the staging path without a real WebDAV/SFTP server. */
class FakeStore implements AssetStore {
  files = new Map<string, Buffer>();
  async upload(key: string, bytes: Buffer): Promise<void> {
    this.files.set(key, bytes);
  }
  async download(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    if (b === undefined) throw new Error('missing');
    return b;
  }
  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}

describe('save_image_fills — definition', () => {
  it('requires nodeIds + outDir and is read-only (kind local)', () => {
    expect(saveImageFillsToolDefinition.name).toBe(SAVE_IMAGE_FILLS_TOOL_NAME);
    expect(saveImageFillsTool.kind).toBe('local');
    expect(saveImageFillsToolDefinition.inputSchema).toMatchObject({
      type: 'object',
      required: ['nodeIds', 'outDir'],
      properties: {
        nodeIds: { type: 'array', items: { type: 'string' } },
        outDir: { type: 'string' },
      },
    });
  });
});

describe('detectImageFormat', () => {
  it('recognizes PNG / JPG / GIF / WEBP by magic bytes', () => {
    expect(detectImageFormat(Buffer.from([0x89, 0x50, 0x4e, 0x47]))).toEqual({
      format: 'PNG',
      ext: 'png',
    });
    expect(detectImageFormat(Buffer.from([0xff, 0xd8, 0xff]))).toEqual({
      format: 'JPG',
      ext: 'jpg',
    });
    expect(detectImageFormat(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toEqual({
      format: 'GIF',
      ext: 'gif',
    });
    const webp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
    expect(detectImageFormat(webp)).toEqual({ format: 'WEBP', ext: 'webp' });
  });

  it('falls back to BIN for an unrecognized container (bytes still preserved)', () => {
    expect(detectImageFormat(Buffer.from([0x00, 0x01, 0x02, 0x03]))).toEqual({
      format: 'BIN',
      ext: 'bin',
    });
  });
});

describe('writeImageFills', () => {
  it('writes each fill to a hash-named file with the sniffed extension', async () => {
    const base = await makeDir();
    const dir = join(base, 'nested', 'assets');
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [
          {
            index: 0,
            imageHash: 'abcHASH',
            base64: PNG_B64,
            width: 200,
            height: 100,
            scaleMode: 'FILL',
          },
          { index: 2, imageHash: 'jpgHASH', base64: JPG_B64, scaleMode: 'CROP' },
        ],
      },
    ];
    const result = await writeImageFills(dir, nodes);

    expect(result).toEqual({
      nodes: [
        {
          nodeId: '1:1',
          images: [
            {
              index: 0,
              imageHash: 'abcHASH',
              base64: PNG_B64,
              format: 'PNG',
              path: 'abchash.png',
              relativePath: 'abchash.png',
              width: 200,
              height: 100,
              scaleMode: 'FILL',
            },
            {
              index: 2,
              imageHash: 'jpgHASH',
              base64: JPG_B64,
              format: 'JPG',
              path: 'jpghash.jpg',
              relativePath: 'jpghash.jpg',
              scaleMode: 'CROP',
            },
          ],
        },
      ],
    } satisfies SaveImageFillsResult);
    expect((await readFile(join(dir, 'abchash.png'))).toString('base64')).toBe(PNG_B64);
    expect((await readFile(join(dir, 'jpghash.jpg'))).toString('base64')).toBe(JPG_B64);
  });

  it('dedupes a shared imageHash to one file while every usage still maps to it', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [{ index: 0, imageHash: 'logo', base64: PNG_B64, scaleMode: 'FILL' }],
      },
      {
        nodeId: '2:2',
        images: [{ index: 0, imageHash: 'logo', base64: PNG_B64, scaleMode: 'FIT' }],
      },
    ];
    const result = await writeImageFills(dir, nodes);
    // path is outDir-relative (never the server's absolute filesystem path — remote peers see a
    // clean name); relativePath mirrors it for convenience.
    const shared = 'logo.png';
    const sharedAbs = join(dir, 'logo.png');
    expect(result.nodes[0]?.images[0]?.path).toBe(shared);
    expect(result.nodes[1]?.images[0]?.path).toBe(shared);
    expect(result.nodes[0]?.images[0]?.relativePath).toBe('logo.png');
    expect(result.nodes[1]?.images[0]?.relativePath).toBe('logo.png');
    expect((await readFile(sharedAbs)).toString('base64')).toBe(PNG_B64);
  });

  it('returns path null (no write) for an unresolved image and passes mixed through', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      { nodeId: '1:1', images: [{ index: 0, imageHash: 'gone', base64: null, scaleMode: 'FILL' }] },
      { nodeId: '2:2', images: [{ index: 1, imageHash: null, base64: null }] },
      { nodeId: '3:3', images: [], mixed: true },
    ];
    const result = await writeImageFills(dir, nodes);
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: 'gone',
      base64: null,
      path: null,
      relativePath: null,
      scaleMode: 'FILL',
    });
    expect(result.nodes[1]?.images[0]).toEqual({
      index: 1,
      imageHash: null,
      base64: null,
      path: null,
      relativePath: null,
    });
    expect(result.nodes[2]).toEqual({ nodeId: '3:3', images: [], mixed: true });
    await expect(readFile(join(dir, 'gone.png'))).rejects.toThrow(/ENOENT/);
  });

  it('names files as IMG-[location]-[name] from the parent + layer name', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        parentName: 'Blog-1',
        nodeName: 'Cover',
        images: [{ index: 0, imageHash: 'h', base64: PNG_B64, scaleMode: 'FILL' }],
      },
    ];
    const result = await writeImageFills(dir, nodes);
    const expected = 'IMG-blog-1-cover.png';
    expect(result.nodes[0]?.nodeName).toBe('Cover');
    expect(result.nodes[0]?.parentName).toBe('Blog-1');
    expect(result.nodes[0]?.images[0]?.path).toBe(expected);
    expect(result.nodes[0]?.images[0]?.relativePath).toBe(expected);
    expect((await readFile(join(dir, expected))).toString('base64')).toBe(PNG_B64);
  });

  it('falls back to IMG-[name] when there is no parent layer name', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        nodeName: 'Hero Photo',
        images: [{ index: 0, imageHash: 'h', base64: PNG_B64 }],
      },
    ];
    const result = await writeImageFills(dir, nodes);
    expect(result.nodes[0]?.images[0]?.path).toBe('IMG-hero-photo.png');
    expect(result.nodes[0]?.images[0]?.relativePath).toBe('IMG-hero-photo.png');
  });

  it('appends the fill index only when a node has multiple image fills', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        nodeName: 'Banner',
        images: [
          { index: 0, imageHash: 'a', base64: PNG_B64 },
          { index: 3, imageHash: 'b', base64: JPG_B64 },
        ],
      },
    ];
    const result = await writeImageFills(dir, nodes);
    expect(result.nodes[0]?.images[0]?.path).toBe('IMG-banner-0.png');
    expect(result.nodes[0]?.images[1]?.path).toBe('IMG-banner-3.jpg');
    expect(result.nodes[0]?.images[0]?.relativePath).toBe('IMG-banner-0.png');
    expect(result.nodes[0]?.images[1]?.relativePath).toBe('IMG-banner-3.jpg');
  });

  it('dedupes by hash and names the shared file after the first node that referenced it', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      { nodeId: '1:1', nodeName: 'Logo', images: [{ index: 0, imageHash: 'logo', base64: PNG_B64 }] },
      { nodeId: '2:2', nodeName: 'Brand', images: [{ index: 0, imageHash: 'logo', base64: PNG_B64 }] },
    ];
    const result = await writeImageFills(dir, nodes);
    const shared = 'IMG-logo.png';
    const sharedAbs = join(dir, 'IMG-logo.png');
    expect(result.nodes[0]?.images[0]?.path).toBe(shared);
    expect(result.nodes[1]?.images[0]?.path).toBe(shared);
    expect(result.nodes[0]?.images[0]?.relativePath).toBe(shared);
    expect((await readFile(sharedAbs)).toString('base64')).toBe(PNG_B64);
  });

  it('falls back to the hash name when two different images sanitize to the same path', async () => {
    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      { nodeId: '1:1', nodeName: 'Pic', images: [{ index: 0, imageHash: 'aaa', base64: PNG_B64 }] },
      { nodeId: '2:2', nodeName: 'Pic', images: [{ index: 0, imageHash: 'bbb', base64: PNG_B64 }] },
    ];
    const result = await writeImageFills(dir, nodes);
    expect(result.nodes[0]?.images[0]?.path).toBe('IMG-pic.png');
    expect(result.nodes[0]?.images[0]?.relativePath).toBe('IMG-pic.png');
    // Second "Pic" (same name + extension, different hash) collides → hash-named fallback.
    expect(result.nodes[1]?.images[0]?.path).toBe('bbb-0.png');
    expect(result.nodes[1]?.images[0]?.relativePath).toBe('bbb-0.png');
  });
});

describe('handleSaveImageFills', () => {
  it('dispatches save_image_fills with nodeIds and lands the bytes on disk', async () => {
    const dir = await makeDir();
    let dispatched: { tool: string; args: unknown } | null = null;
    const dispatch: ToolDispatcher = async (tool, args) => {
      dispatched = { tool, args };
      return {
        nodes: [{ nodeId: '1:1', images: [{ index: 0, imageHash: 'h', base64: PNG_B64 }] }],
      } satisfies ImageFillsResult;
    };

    const result = (await handleSaveImageFills(dispatch, {
      nodeIds: ['1:1'],
      outDir: dir,
    })) as SaveImageFillsResult;

    expect(dispatched).toEqual({ tool: 'save_image_fills', args: { nodeIds: ['1:1'] } });
    expect(result.nodes[0]?.images[0]).toEqual({
      index: 0,
      imageHash: 'h',
      base64: PNG_B64,
      format: 'PNG',
      path: 'h.png',
      relativePath: 'h.png',
    });
    expect((await readFile(join(dir, 'h.png'))).toString('base64')).toBe(PNG_B64);
  });

  it('rejects input missing outDir', async () => {
    await expect(handleSaveImageFills(emptyDispatch, { nodeIds: ['1:1'] })).rejects.toThrow(
      /outDir/,
    );
  });
});

describe('writeImageFills — WebDAV/SFTP staging (assetToken)', () => {
  it('mints a one-time assetToken per unique file and the staged bytes are retrievable', async () => {
    const store = new FakeStore();
    const mgr = new TransferManager(store);
    setTransferManager(mgr);

    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      {
        nodeId: '1:1',
        images: [
          { index: 0, imageHash: 'abcHASH', base64: PNG_B64, scaleMode: 'FILL' },
          { index: 2, imageHash: 'jpgHASH', base64: JPG_B64, scaleMode: 'CROP' },
        ],
      },
    ];
    const result = await writeImageFills(dir, nodes);

    const tokens = result.nodes[0]!.images.map(i => i.assetToken).filter(Boolean);
    expect(tokens).toHaveLength(2);
    // Transfer mode: base64 is intentionally OMITTED — the partner pulls bytes via fetch_asset.
    expect(result.nodes[0]!.images[0]!.base64).toBeUndefined();
    // And the in-result note tells the partner agent how to retrieve the bytes.
    expect(result.note).toContain('fetch_asset');

    const first = await mgr.fetch(tokens[0]!);
    expect(first).not.toBeNull();
    expect(first!.bytes.toString('base64')).toBe(PNG_B64);
    expect(await mgr.fetch(tokens[0]!)).toBeNull(); // one-time
  });

  it('aborts the whole save when staging throws (no silent base64 fallback)', async () => {
    const boom = new FakeStore();
    boom.upload = async () => {
      throw new Error('staging down');
    };
    setTransferManager(new TransferManager(boom));

    const dir = await makeDir();
    const nodes: NodeImageFills[] = [
      { nodeId: '1:1', images: [{ index: 0, imageHash: 'abcHASH', base64: PNG_B64, scaleMode: 'FILL' }] },
    ];
    // Staging is part of the save: a transfer failure must surface, not silently drop the token
    // and fall back to inline base64 (which would bloat the remote LLM's context).
    await expect(writeImageFills(dir, nodes)).rejects.toThrow('staging down');
  });
});
