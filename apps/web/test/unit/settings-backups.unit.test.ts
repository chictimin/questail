/** U5-[1] W-S2 GET /api/settings/backups — 목록·정렬·빈 디렉터리·키 미포함. */
import { mkdtempSync, mkdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { KEY_FILE_NAME } from '../../src/data/index.js';
import { BACKUP_DIR_NAME } from '../../src/db/backup.js';
import { createApp } from '../../src/server/app.js';
import { SETTINGS_BACKUPS_PATH } from '../../src/server/routes/settings-backups.js';

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length > 0) {
    const dir = dirs.pop() as string;
    rmSync(dir, { recursive: true, force: true });
  }
});

function track(dir: string): string {
  dirs.push(dir);
  return dir;
}

function seedBackups(dir: string): void {
  const out = join(dir, BACKUP_DIR_NAME);
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'questail-2026-10-08T21-40-00-000Z.db'), 'old');
  writeFileSync(join(out, 'questail-2026-10-09T09-12-00-000Z.db'), 'new-data');
  writeFileSync(join(out, 'stray.txt'), 'ignore me');
  // 같은 초 기록 방지 — mtime 고정(내림 확인용).
  utimesSync(join(out, 'questail-2026-10-08T21-40-00-000Z.db'), 1700000000, 1700000000);
  utimesSync(join(out, 'questail-2026-10-09T09-12-00-000Z.db'), 1700100000, 1700100000);
}

describe('GET /api/settings/backups', () => {
  it('deps 없음 → 500 INTERNAL', async () => {
    const response = await createApp().request(SETTINGS_BACKUPS_PATH);
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
  });

  it('목록 mtime 내림 + stray 제외 + 키 미포함', async () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'questail-u5w2-')));
    seedBackups(dir);
    const app = createApp(undefined, undefined, { dataDir: dir, version: '0.1.0-test' });
    const response = await app.request(SETTINGS_BACKUPS_PATH);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      backups: { name: string; size: number; mtime: number }[];
    };
    expect(body.backups.map((entry) => entry.name)).toEqual([
      'questail-2026-10-09T09-12-00-000Z.db',
      'questail-2026-10-08T21-40-00-000Z.db',
    ]);
    for (const entry of body.backups) {
      expect(typeof entry.size).toBe('number');
      expect(Number.isInteger(entry.mtime)).toBe(true);
    }
    expect(JSON.stringify(body)).not.toContain(KEY_FILE_NAME);
  });

  it('backups 디렉터리 없음 → []', async () => {
    const dir = track(mkdtempSync(join(tmpdir(), 'questail-u5w2empty-')));
    const app = createApp(undefined, undefined, { dataDir: dir, version: '0.1.0-test' });
    const response = await app.request(SETTINGS_BACKUPS_PATH);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ backups: [] });
  });
});
