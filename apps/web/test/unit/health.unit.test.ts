import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Server } from 'node:http';
import { HEALTH_PATH, createServer, listen, matchRoute } from '../../src/server.js';

describe('matchRoute (pure)', () => {
  it('GET /api/health → 200 { status: ok }', () => {
    expect(matchRoute('GET', HEALTH_PATH)).toEqual({
      status: 200,
      body: { status: 'ok' },
    });
  });

  it('unknown path → 404', () => {
    expect(matchRoute('GET', '/api/nope').status).toBe(404);
  });

  it('non-GET on health → 404', () => {
    expect(matchRoute('POST', HEALTH_PATH).status).toBe(404);
  });
});

describe('health endpoint over loopback http', () => {
  let server: Server;
  let port: number;

  beforeAll(async () => {
    server = createServer();
    port = await listen(server);
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  });

  it('GET /api/health → 200', async () => {
    const response = await fetch(`http://127.0.0.1:${port}${HEALTH_PATH}`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: 'ok' });
  });
});
