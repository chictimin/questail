/**
 * U5-[1] W-S2 백업 목록 API — <dataDir>/backups/questail-*.db 읽기.
 * 키 경로·키 파일명은 반환 0(반향 규칙).
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { BACKUP_DIR_NAME } from '../../db/backup.js';
import { settingsInternalError, type SettingsDeps } from './settings-info.js';

export const SETTINGS_BACKUPS_PATH = '/api/settings/backups';

export interface BackupEntry {
  name: string;
  size: number;
  /** mtime epoch 초 (C-1 단위). */
  mtime: number;
}

export function registerSettingsBackupsRoutes(app: Hono, deps?: SettingsDeps): void {
  app.get(SETTINGS_BACKUPS_PATH, (c) => {
    if (deps === undefined) {
      return settingsInternalError(c);
    }
    return c.json({ backups: listBackups(deps.dataDir) });
  });
}

/** <dataDir>/backups/questail-*.db 목록 — mtime 내림. 디렉터리 없으면 []. */
export function listBackups(dataDir: string): BackupEntry[] {
  const dir = join(dataDir, BACKUP_DIR_NAME);
  if (!existsSync(dir)) {
    return [];
  }
  const entries: BackupEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.startsWith('questail-') || !name.endsWith('.db')) {
      continue;
    }
    const stat = statSync(join(dir, name));
    if (!stat.isFile()) {
      continue;
    }
    entries.push({
      name,
      size: stat.size,
      mtime: Math.floor(stat.mtimeMs / 1000),
    });
  }
  entries.sort((a, b) => b.mtime - a.mtime);
  return entries;
}
