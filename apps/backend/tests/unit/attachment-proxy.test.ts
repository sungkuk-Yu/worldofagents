import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getStore } from '../../src/lib/devstore';
import { config } from '../../src/config';
import { createTestApp, closeTestApp, TestApp } from '../helpers';

const path = '0123456789ab/12345678-1234-1234-1234-123456789abc.png';
let app: TestApp;

beforeAll(async () => { app = await createTestApp(); });
afterAll(async () => { await closeTestApp(app); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('GET /api/attachments/object/* security headers', () => {
  it('returns safe image bytes with nosniff, sandbox CSP, and conservative caching', async () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    getStore().blobs.set(path, { bytes, mime: 'image/png' });
    const res = await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` });
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(bytes);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
  });

  it('downgrades untrusted MIME types and rejects malformed object paths', async () => {
    getStore().blobs.set(path, { bytes: Buffer.from('<svg/>'), mime: 'image/svg+xml' });
    const unsafe = await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` });
    expect(unsafe.statusCode).toBe(200);
    expect(unsafe.headers['content-type']).toBe('application/octet-stream');
    expect(unsafe.headers['x-content-type-options']).toBe('nosniff');
    const malformed = await app.inject({ method: 'GET', url: '/api/attachments/object/../../etc/passwd' });
    expect(malformed.statusCode).toBe(404);
  });

  it('proxies production Storage bytes unchanged with safe MIME and headers', async () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    const bytes = Buffer.from([0, 255, 10, 128, 42]);
    const fetchMock = vi.fn(async () => new Response(bytes, { status: 200, headers: { 'content-type': 'image/png; charset=binary' } }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(res.statusCode).toBe(200);
    expect(res.rawPayload).toEqual(bytes);
    expect(res.headers['content-type']).toBe('image/png');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBe("sandbox; default-src 'none'; frame-ancestors 'none'");
    expect(res.headers['cache-control']).toBe('private, no-store, max-age=0');
  });

  it('streams with backpressure and aborts upstream after the configured byte limit', async () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    const maxBytesSpy = vi.spyOn(config.upload, 'maxBytes', 'get').mockReturnValue(4);
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.enqueue(new Uint8Array([4, 5])); },
      cancel() { canceled = true; },
    });
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      init?.signal?.addEventListener('abort', () => { canceled = true; });
      return new Response(body, { status: 200, headers: { 'content-type': 'image/png' } });
    });
    vi.stubGlobal('fetch', fetchMock);
    try { await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` }); } catch { /* Fastify terminates oversized streamed responses after headers are sent. */ }
    expect(canceled).toBe(true);
    maxBytesSpy.mockRestore();
  });

  it('rejects unsupported upstream MIME as octet-stream', async () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('<svg/>', { headers: { 'content-type': 'image/svg+xml' } })));
    const res = await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/octet-stream');
    expect(res.rawPayload).toEqual(Buffer.from('<svg/>'));
  });

  it('returns an error for upstream fetch failures', async () => {
    vi.spyOn(config, 'devMode', 'get').mockReturnValue(false);
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('upstream unavailable'); }));
    const res = await app.inject({ method: 'GET', url: `/api/attachments/object/${path}` });
    expect(res.statusCode).toBe(500);
  });
});
