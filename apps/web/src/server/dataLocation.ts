/**
 * P-12 [해석 — 기동 1단계] 데이터 폴더 해석.
 * ① QUESTAIL_DATA_DIR 명시 → 그 경로 그대로 / ② 미지정 → 루트 R 바로 아래만 본다
 * (a 레거시 판정·b 레거시 사용·c 계정 폴더 1개·d 2개 이상 실패·e 둘 다 없음 = 미부착).
 * ③ 계정 폴더 DB의 steam_id가 폴더 이름과 다르면 기동 실패. ⑤ 스테이징 잔여 정리, ⑦ 키 임시 파일 정리.
 * 실패 안내에는 값·키 원문을 싣지 않는다(경로는 R 같은 폴더 위치만).
 */
import Database from 'better-sqlite3';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DB_FILE_NAME } from '../db/open.js';
import type { OwnerLock } from '../db/ownerLock.js';
import { createLogger } from './logging.js';

export const ACCOUNT_DIR_PATTERN = /^\d{17}$/;
const STAGING_PATTERN = /^\.staging-(\d{17})-(\d+)-[A-Za-z0-9]+$/;
const KEY_TMP_PATTERN = /^steam\.key\.(\d+)\.tmp$/;

export const LEGACY_AND_ACCOUNT_MESSAGE =
  '[web] legacy data/questail.db and an account folder exist together — move one of them or set QUESTAIL_DATA_DIR';
export const LEGACY_UNCONNECTED_GAMES_MESSAGE =
  '[web] legacy data/questail.db has game records that are not linked, so the app does not start — point QUESTAIL_DATA_DIR at that folder or move it manually';
export const MULTIPLE_ACCOUNTS_MESSAGE =
  '[web] more than one account folder — set QUESTAIL_DATA_DIR';
export const LEGACY_UNREADABLE_MESSAGE =
  '[web] cannot read legacy data/questail.db; cannot start — check or move the file';
export const ACCOUNT_FOLDER_MISMATCH_MESSAGE =
  '[web] account ID in the account folder DB differs from the folder name — fix or move that folder';

export type DataLocation =
  | { mode: 'explicit' | 'legacy' | 'account'; dir: string; root?: string }
  | { mode: 'unattached'; root: string };

export type ResolveDeps = {
  /** 소유 잠금 취득(레지스트리 재사용). 실패 변환은 호출 측(boot)이 맡는다. */
  acquireLock: (dir: string) => OwnerLock | Promise<OwnerLock>;
  /** 미지정 시 기본 루트 R(<저장소>/data). */
  defaultRoot: () => string;
  selfPid?: number;
  /** ③ 계정 폴더 DB의 steam_id 읽기(readonly). 미지정 시 readAccountSteamId. 테스트 순서 관측용. */
  readSteamId?: (dbPath: string) => string | null;
};

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** 계정 폴더 = 이름이 ^\d{17}$ 이고 안에 questail.db 파일이 있는 디렉터리(점 시작 이름 무시). */
export function listAccountFolders(root: string): string[] {
  const names: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || !ACCOUNT_DIR_PATTERN.test(entry.name)) {
      continue;
    }
    const full = join(root, entry.name);
    let isDir = false;
    try {
      isDir = statSync(full).isDirectory();
    } catch {
      isDir = false;
    }
    if (isDir && isFile(join(full, DB_FILE_NAME))) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

/** DB를 읽기 전용으로 열어 fn 실행 후 닫는다. 열기·조회 실패는 throw. */
function withReadonlyDb<T>(dbPath: string, fn: (db: Database.Database) => T): T {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    return fn(db);
  } finally {
    db.close();
  }
}

/** 계정 행 steam_id — 행 없음·NULL은 null. 열기·조회 실패는 throw. */
export function readAccountSteamId(dbPath: string): string | null {
  return withReadonlyDb(dbPath, (db) => {
    const row = db
      .prepare('select steam_id as steamId from account limit 1')
      .get() as { steamId: string | null } | undefined;
    return row?.steamId ?? null;
  });
}

/** ⑤ R 아래 .staging-<steamId>-<pid>-<rand> 중 pid가 자기 자신이 아닌 것 삭제. 실패는 경고 1줄 후 계속. */
export function cleanStaging(root: string, selfPid: number = process.pid): void {
  let names: string[];
  try {
    names = readdirSync(root);
  } catch {
    return;
  }
  for (const name of names) {
    const match = STAGING_PATTERN.exec(name);
    if (match === null || Number(match[2]) === selfPid) {
      continue;
    }
    try {
      rmSync(join(root, name), { recursive: true, force: true });
    } catch {
      createLogger().warn('[web] staging leftover cleanup failed — next boot retries');
    }
  }
}

/** ⑦ D 아래 steam.key.<pid>.tmp 중 pid가 자기 자신이 아닌 것 삭제. 실패는 경고 1줄. */
export function cleanKeyTmp(dir: string, selfPid: number = process.pid): void {
  let names: string[];
  try {
    names = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of names) {
    const match = KEY_TMP_PATTERN.exec(name);
    if (match === null || Number(match[1]) === selfPid) {
      continue;
    }
    try {
      rmSync(join(dir, name), { force: true });
    } catch {
      createLogger().warn('[web] key temp file cleanup failed');
    }
  }
}

export async function resolveDataLocation(
  env: NodeJS.ProcessEnv,
  envKey: string,
  deps: ResolveDeps,
): Promise<DataLocation> {
  const selfPid = deps.selfPid ?? process.pid;
  const raw = env[envKey];
  // ① 명시 — 계정 하위 폴더 없음, 기동 시 부착. D 잠금만(R 개념 없음).
  if (raw !== undefined && raw !== '') {
    const dir = resolve(raw);
    await deps.acquireLock(dir);
    cleanKeyTmp(dir, selfPid);
    return { mode: 'explicit', dir };
  }
  // ② 미지정 — R 잠금 먼저(R 아래 스테이징·rename·⑤ 정리 권한).
  const root = deps.defaultRoot();
  await deps.acquireLock(root);
  cleanStaging(root, selfPid);
  const folders = listAccountFolders(root);
  const legacyPath = join(root, DB_FILE_NAME);
  let legacyConnected = false;
  if (isFile(legacyPath)) {
    let counts: { connected: number; games: number };
    try {
      counts = withReadonlyDb(legacyPath, (db) => ({
        connected: (
          db
            .prepare('select count(*) as n from account where steam_id is not null')
            .get() as { n: number }
        ).n,
        games: (db.prepare('select count(*) as n from games').get() as { n: number }).n,
      }));
    } catch {
      throw new Error(LEGACY_UNREADABLE_MESSAGE);
    }
    if (counts.connected >= 1) {
      if (folders.length >= 1) {
        throw new Error(LEGACY_AND_ACCOUNT_MESSAGE);
      }
      legacyConnected = true;
    } else if (counts.games >= 1) {
      throw new Error(LEGACY_UNCONNECTED_GAMES_MESSAGE);
    } else {
      // 빈 레거시 — 없는 것으로 보고 진행. 경고는 1줄, 경로 원문 외 정보 없음.
      createLogger().warn(`[web] ignoring empty legacy DB: ${legacyPath}`);
    }
  }
  if (legacyConnected) {
    await finalizeLock(root, deps, selfPid);
    return { mode: 'legacy', dir: root, root };
  }
  if (folders.length >= 2) {
    throw new Error(MULTIPLE_ACCOUNTS_MESSAGE);
  }
  if (folders.length === 1) {
    const name = folders[0] as string;
    const dir = join(root, name);
    // T 잠금을 readonly 검사보다 먼저 잡는다 — 다른 프로세스가 쥔 폴더의 DB를 열지 않는다.
    // ③ 불일치로 실패해도 잠금은 프로세스 종료로 해제된다.
    await finalizeLock(dir, deps, selfPid);
    let steamId: string | null;
    try {
      steamId = (deps.readSteamId ?? readAccountSteamId)(join(dir, DB_FILE_NAME));
    } catch {
      throw new Error(ACCOUNT_FOLDER_MISMATCH_MESSAGE);
    }
    if (steamId !== name) {
      throw new Error(ACCOUNT_FOLDER_MISMATCH_MESSAGE);
    }
    return { mode: 'account', dir, root };
  }
  return { mode: 'unattached', root };
}

async function finalizeLock(dir: string, deps: ResolveDeps, selfPid: number): Promise<void> {
  await deps.acquireLock(dir);
  cleanKeyTmp(dir, selfPid);
}
