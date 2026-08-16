import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createAssetStore,
  getTransferManager,
  initTransferManager,
  TransferManager,
  WebDavStore,
  type AssetStore,
} from '../src/transfer.js';

/** In-memory AssetStore for exercising the manager without a network. */
class FakeStore implements AssetStore {
  files = new Map<string, Buffer>();
  async upload(key: string, bytes: Buffer): Promise<void> {
    this.files.set(key, bytes);
  }
  async download(key: string): Promise<Buffer> {
    const b = this.files.get(key);
    if (!b === undefined) throw new Error('missing');
    if (b === undefined) throw new Error('missing');
    return b;
  }
  async remove(key: string): Promise<void> {
    this.files.delete(key);
  }
}

describe('TransferManager', () => {
  it('stages bytes and redeems them once, then consumes the token', async () => {
    const store = new FakeStore();
    const mgr = new TransferManager(store);

    const token = await mgr.stage('cover.png', Buffer.from('hello-bytes'));
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);

    const res = await mgr.fetch(token);
    expect(res).not.toBeNull();
    expect(res!.bytes.toString()).toBe('hello-bytes');
    expect(res!.name).toBe('cover.png');

    // token is one-time: a second redeem returns null
    expect(await mgr.fetch(token)).toBeNull();
    // and the staged copy was deleted
    expect(store.files.size).toBe(0);
  });

  it('returns null for an unknown / already-used token', async () => {
    const mgr = new TransferManager(new FakeStore());
    expect(await mgr.fetch('not-a-real-token')).toBeNull();
  });

  it('expires tokens after the TTL and sweeps the staged file', async () => {
    const store = new FakeStore();
    const mgr = new TransferManager(store, 1); // 1ms TTL
    const token = await mgr.stage('x.png', Buffer.from('data'));
    await new Promise((r) => setTimeout(r, 8));
    const res = await mgr.fetch(token);
    expect(res).toBeNull();
    expect(store.files.size).toBe(0); // swept on expiry
  });
});

describe('createAssetStore', () => {
  it('returns null for inline mode and missing credentials', () => {
    expect(createAssetStore({ mode: 'inline' })).toBeNull();
    expect(createAssetStore({ mode: 'webdav' })).toBeNull(); // no webdav config
    expect(createAssetStore({ mode: 'sftp' })).toBeNull(); // no sftp config
  });

  it('builds a WebDavStore when configured', () => {
    expect(
      createAssetStore({ mode: 'webdav', webdav: { url: 'https://d', username: 'u', password: 'p' } }),
    ).not.toBeNull();
  });
});

describe('WebDavStore', () => {
  let original: typeof fetch;
  let calls: { url: string; method?: string; body?: unknown; headers?: Record<string, string> }[] = [];

  beforeEach(() => {
    calls = [];
    original = global.fetch;
    global.fetch = (async (input: any, init?: any) => {
      const url = typeof input === 'string' ? input : input.url;
      const headers: Record<string, string> = {};
      const h = init?.headers as Record<string, string> | undefined;
      if (h) for (const k of Object.keys(h)) headers[k.toLowerCase()] = String(h[k]);
      const method = (init?.method ?? 'GET') as string;
      calls.push({ url, method, body: init?.body, headers });
      if (method === 'PUT') return new Response(null, { status: 201 });
      if (method === 'GET') return new Response(Buffer.from('imgbytes'), { status: 200 });
      if (method === 'DELETE') return new Response(null, { status: 204 });
      if (method === 'MKCOL') return new Response(null, { status: 201 });
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = original;
  });

  it('PUTs to the joined URL after MKCOL, GETs and DELETEs by key', async () => {
    const store = new WebDavStore({
      url: 'https://dav.example.com/remote.php/webdav',
      path: 'assets',
      username: 'u',
      password: 'p',
    });
    await store.upload('abc/cover.png', Buffer.from('x'));
    expect(calls.some((c) => c.method === 'MKCOL')).toBe(true);
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.url).toBe('https://dav.example.com/remote.php/webdav/assets/abc/cover.png');

    const buf = await store.download('abc/cover.png');
    expect(buf.toString()).toBe('imgbytes');

    await store.remove('abc/cover.png');
    expect(calls.some((c) => c.method === 'DELETE' && c.url === 'https://dav.example.com/remote.php/webdav/assets/abc/cover.png')).toBe(true);
  });

  it('sends Basic auth', async () => {
    const store = new WebDavStore({ url: 'https://d', username: 'u', password: 'p' });
    await store.upload('k', Buffer.from('x'));
    const put = calls.find((c) => c.method === 'PUT');
    expect(put?.headers?.authorization).toBe('Basic ' + Buffer.from('u:p').toString('base64'));
  });
});

describe('initTransferManager', () => {
  it('installs a manager for webdav config and null otherwise', () => {
    initTransferManager(undefined);
    expect(getTransferManager()).toBeNull();

    initTransferManager(JSON.stringify({ mode: 'inline' }));
    expect(getTransferManager()).toBeNull();

    initTransferManager(
      JSON.stringify({ mode: 'webdav', webdav: { url: 'https://d', username: 'u', password: 'p' } }),
    );
    expect(getTransferManager()).not.toBeNull();

    // bad JSON falls back to null
    initTransferManager('{ not json');
    expect(getTransferManager()).toBeNull();
  });
});
