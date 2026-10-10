import { describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { KEY_FILE_NAME, createSteamRequest } from '../../src/data/connection.js';

/**
 * U2 #13A passStatus 옵션 단위 테스트. 합성 키 파일 + 가짜 fetch만 쓴다. 실호출 없음.
 */
const DUMMY = '0123456789abcdef0123456789abcdef';

function keyPathWithKey(): { dir: string; keyPath: string } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-u2pass-'));
  const db = new Database(join(dir, 'questail.db'));
  db.exec(
    'CREATE TABLE IF NOT EXISTS account (id integer PRIMARY KEY, steam_id text, created_at integer NOT NULL)',
  );
  db.close();
  const keyPath = join(dir, KEY_FILE_NAME);
  writeFileSync(keyPath, DUMMY, { mode: 0o600 });
  if (process.platform !== 'win32') {
    chmodSync(keyPath, 0o600);
  }
  return { dir, keyPath };
}

describe('createSteamRequest passStatus', () => {
  it('목록 status는 {ok:true, status, body}로 넘긴다', async () => {
    const { keyPath } = keyPathWithKey();
    const body = { playerstats: { error: 'Requested app has no stats', success: false } };
    const ctx = createSteamRequest({
      keyPath,
      fetchFn: async () => ({ status: 400, json: async () => body }),
      passStatus: [400],
    });
    await expect(ctx.request(() => 'https://example.invalid/x')).resolves.toEqual({
      ok: true,
      status: 400,
      body,
    });
  });

  it('401·403·429는 목록에 있어도 기존 실패 변환이 우선한다', async () => {
    const { keyPath } = keyPathWithKey();
    for (const [status, code] of [
      [401, 'AUTH_INVALID_KEY'],
      [403, 'ACCESS_PRIVATE'],
      [429, 'RATE_LIMITED'],
    ] as const) {
      const ctx = createSteamRequest({
        keyPath,
        fetchFn: async () => ({ status, json: async () => ({}) }),
        passStatus: [400, 401, 403, 429],
      });
      await expect(ctx.request(() => 'https://example.invalid/x')).resolves.toMatchObject({
        ok: false,
        code,
      });
    }
  });

  it('JSON 파싱 실패 시 body null이다', async () => {
    const { keyPath } = keyPathWithKey();
    const ctx = createSteamRequest({
      keyPath,
      fetchFn: async () => ({
        status: 400,
        json: async () => {
          throw new Error('bad json');
        },
      }),
      passStatus: [400],
    });
    await expect(ctx.request(() => 'https://example.invalid/x')).resolves.toEqual({
      ok: true,
      status: 400,
      body: null,
    });
  });

  it('생략 시 동작 불변(400 → NETWORK)', async () => {
    const { keyPath } = keyPathWithKey();
    const ctx = createSteamRequest({
      keyPath,
      fetchFn: async () => ({ status: 400, json: async () => ({}) }),
    });
    await expect(ctx.request(() => 'https://example.invalid/x')).resolves.toEqual({
      ok: false,
      code: 'NETWORK',
      params: { status: 400 },
    });
  });
});
