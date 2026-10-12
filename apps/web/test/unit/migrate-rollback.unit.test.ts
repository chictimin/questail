import Database from 'better-sqlite3';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { runApply, runRollback } from '../../../../tools/migrate-r1-once.js';
import {
  REPO,
  TOOL,
  TSX_CLI,
  TZ,
  dumpAll,
  listBackups,
  makeFixture,
  type Fixture,
} from './helpers/d14-fixture.js';

/** D-14 --rollback 테스트(계약 「테스트」 8). */
const LOCK_CHILD = join(dirname(fileURLToPath(import.meta.url)), 'helpers', 'd14-lock-child.ts');

function dbPath(fx: Fixture): string {
  return join(fx.dataDir, 'questail.db');
}

async function applied(): Promise<{ fx: Fixture; before: ReturnType<typeof dumpAll>; backup: string }> {
  const fx = await makeFixture();
  const before = dumpAll(dbPath(fx));
  const outcome = await runApply({
    dataDir: fx.dataDir,
    history: fx.historyPath,
    cache: fx.cacheDir,
    library: fx.libraryPath,
    tz: TZ,
    out: fx.outPath,
    expectHistorySha: fx.historySha,
    expectRows: fx.rows,
  });
  expect(outcome.code).toBe(0);
  return { fx, before, backup: listBackups(fx.dataDir)[0] };
}

function isolated(fx: Fixture): string[] {
  return readdirSync(fx.dataDir).filter((n) => n.startsWith('.rollback-d14-'));
}

describe('migrate --rollback', () => {
  it('성공: DB가 백업 시점과 같고 격리 폴더에 적용 후 DB가 보존된다', async () => {
    const { fx, before, backup } = await applied();
    const afterApply = dumpAll(dbPath(fx));
    const outcome = await runRollback({ dataDir: fx.dataDir, backup });
    expect(outcome.code).toBe(0);
    expect(dumpAll(dbPath(fx))).toEqual(before);
    const dirs = isolated(fx);
    expect(dirs).toHaveLength(1);
    expect(dumpAll(join(fx.dataDir, dirs[0], 'questail.db'))).toEqual(afterApply);
    const text = [...outcome.stdout, ...outcome.stderr].join('\n');
    expect(text).not.toContain(fx.dataDir);
    expect(text).not.toMatch(/\d{17}/);
    // 백업 파일은 그대로 남는다
    expect(listBackups(fx.dataDir)).toContain(backup);
    const db = new Database(dbPath(fx), { readonly: true });
    expect((db.prepare('SELECT COUNT(*) AS n FROM import_ledger').get() as { n: number }).n).toBe(0);
    db.close();
  });

  it('BUSY — 별도 자식 프로세스 잠금 보유: 이동 0·종료 ≠ 0', { timeout: 60000 }, async () => {
    // 이 프로세스가 잠금을 쥐면 자식이 취득할 수 없으므로 적용은 CLI 자식으로 한다(종료 시 잠금 해제).
    const fx = await makeFixture();
    const apply = spawnSync(
      process.execPath,
      [
        TSX_CLI, TOOL, '--apply',
        '--data-dir', fx.dataDir, '--history', fx.historyPath, '--cache', fx.cacheDir,
        '--library', fx.libraryPath, '--tz', TZ, '--out', fx.outPath,
        '--expect-history-sha', fx.historySha, '--expect-rows', String(fx.rows),
      ],
      { cwd: REPO, encoding: 'utf8' },
    );
    expect(apply.status).toBe(0);
    const backup = listBackups(fx.dataDir)[0];
    const afterApply = dumpAll(dbPath(fx));
    const holder: ChildProcess = spawn(process.execPath, [TSX_CLI, LOCK_CHILD, fx.dataDir], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    try {
      await new Promise<void>((resolve, reject) => {
        let out = '';
        const timer = setTimeout(() => reject(new Error('LOCKED 대기 초과')), 30000);
        holder.stdout?.on('data', (c: Buffer) => {
          out += c.toString();
          if (out.includes('LOCKED')) {
            clearTimeout(timer);
            resolve();
          }
        });
      });
      const run = spawnSync(
        process.execPath,
        [TSX_CLI, TOOL, '--rollback', '--data-dir', fx.dataDir, '--backup', backup],
        { cwd: REPO, encoding: 'utf8' },
      );
      expect(run.status).not.toBe(0);
      expect(run.stdout + run.stderr).toContain('another Questail process');
      expect(dumpAll(dbPath(fx))).toEqual(afterApply);
      expect(isolated(fx)).toEqual([]);
    } finally {
      holder.kill('SIGTERM');
    }
  });

  it('없는 백업·경로 형태 이름·integrity 실패 백업 → 원 DB 그대로·격리 폴더 0', async () => {
    const { fx, backup } = await applied();
    const afterApply = dumpAll(dbPath(fx));
    for (const name of ['nope.db', '../questail.db', `${backup}/..`]) {
      const outcome = await runRollback({ dataDir: fx.dataDir, backup: name });
      expect(outcome.code).not.toBe(0);
    }
    // 손상 백업
    const broken = 'broken.db';
    const bytes = readFileSync(join(fx.dataDir, 'backups', backup));
    bytes.fill(0xab, 4096, 4096 + 2048);
    writeFileSync(join(fx.dataDir, 'backups', broken), bytes);
    const outcome = await runRollback({ dataDir: fx.dataDir, backup: broken });
    expect(outcome.code).not.toBe(0);
    // 스키마 불일치 백업(해시 변조)
    const tampered = 'tampered.db';
    copyFileSync(join(fx.dataDir, 'backups', backup), join(fx.dataDir, 'backups', tampered));
    const db = new Database(join(fx.dataDir, 'backups', tampered));
    db.exec("UPDATE __drizzle_migrations SET hash = 'x' || substr(hash, 2) WHERE rowid = 1");
    db.close();
    expect((await runRollback({ dataDir: fx.dataDir, backup: tampered })).code).not.toBe(0);
    expect(dumpAll(dbPath(fx))).toEqual(afterApply);
    expect(isolated(fx)).toEqual([]);
  });

  it('복사 실패 주입 → 격리 파일 원위치 복귀·종료 ≠ 0·재기동 금지 표지', async () => {
    const { fx, backup } = await applied();
    const afterApply = dumpAll(dbPath(fx));
    const outcome = await runRollback(
      { dataDir: fx.dataDir, backup },
      {
        copy: () => {
          throw new Error('copy boom');
        },
      },
    );
    expect(outcome.code).not.toBe(0);
    expect(outcome.stderr.join('\n')).toContain('DO NOT RESTART');
    expect(dumpAll(dbPath(fx))).toEqual(afterApply);
    expect(existsSync(dbPath(fx))).toBe(true);
  });

  it('복사본이 백업과 다르면(복사 후 오염) 복원 실패로 처리하고 원위치 복귀', async () => {
    const { fx, backup } = await applied();
    const afterApply = dumpAll(dbPath(fx));
    const outcome = await runRollback(
      { dataDir: fx.dataDir, backup },
      {
        copy: (src, dst) => {
          copyFileSync(src, dst);
          const bytes = readFileSync(dst);
          bytes[bytes.length - 1] ^= 0xff;
          writeFileSync(dst, bytes);
        },
      },
    );
    expect(outcome.code).not.toBe(0);
    expect(dumpAll(dbPath(fx))).toEqual(afterApply);
  });
});
