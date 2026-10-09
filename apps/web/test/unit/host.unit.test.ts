import { describe, expect, it } from 'vitest';
import { HEALTH_PATH, createServerApp } from '../../src/server/app.js';
import { isAllowedOrigin, parseHostName } from '../../src/server/middleware/host.js';

describe('parseHostName', () => {
  it('포트 제거', () => {
    expect(parseHostName('127.0.0.1:4747')).toBe('127.0.0.1');
  });

  it('IPv6 대괄호', () => {
    expect(parseHostName('[::1]:4747')).toBe('::1');
  });

  it('빈 값 → null', () => {
    expect(parseHostName(null)).toBe(null);
    expect(parseHostName('')).toBe(null);
  });
});

describe('isAllowedOrigin', () => {
  it('허용 2종', () => {
    expect(isAllowedOrigin('http://127.0.0.1:4747')).toBe(true);
    expect(isAllowedOrigin('http://localhost:4747')).toBe(true);
  });

  it('외부·파괴값 거부', () => {
    expect(isAllowedOrigin('http://evil.com')).toBe(false);
    expect(isAllowedOrigin('not-a-url')).toBe(false);
  });
});

describe('hostCheck (합성 앱 request — Host는 URL이 아니라 헤더로 준다)', () => {
  const url = 'http://x' + HEALTH_PATH;

  it('허용 Host → 200', async () => {
    const response = await createServerApp().request(url, {
      headers: { host: '127.0.0.1:4747' },
    });
    expect(response.status).toBe(200);
  });

  it('허용 Origin → 200', async () => {
    const response = await createServerApp().request(url, {
      headers: { host: 'localhost:4747', origin: 'http://localhost:4747' },
    });
    expect(response.status).toBe(200);
  });

  it('Host 없음 → 403 {code: INVALID_HOST}', async () => {
    const response = await createServerApp().request(url);
    expect(response.status).toBe(403);
    expect((await response.json()) as { code: string }).toEqual({
      code: 'INVALID_HOST',
      params: { host: '[redacted]' },
    });
  });

  it('악성 Host → 403 {code: INVALID_HOST}', async () => {
    const response = await createServerApp().request(url, {
      headers: { host: 'evil.com' },
    });
    expect(response.status).toBe(403);
    const body = (await response.json()) as {
      code: string;
      params: { host: string };
    };
    expect(body.code).toBe('INVALID_HOST');
    expect(body.params.host).toBe('[redacted]');
  });

  it('악성 Origin → 403 {code: INVALID_ORIGIN}', async () => {
    const response = await createServerApp().request(url, {
      headers: { host: '127.0.0.1:4747', origin: 'http://evil.com' },
    });
    expect(response.status).toBe(403);
    expect(((await response.json()) as { code: string }).code).toBe(
      'INVALID_ORIGIN',
    );
  });
});
