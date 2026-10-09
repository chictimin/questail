import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-14 dry-run 블랙박스 테스트. CLI를 직접 실행한다.
 * 합성 픽스처만 쓴다. 캡틴 원본 접촉 없음.
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REPO = join(WEB, '..', '..');
const TOOL = join(REPO, 'tools', 'migrate-r1-once.ts');

function fixtureDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'questail-d14-zolu-'));
  writeFileSync(
    join(dir, 'history.jsonl'),
    [
      JSON.stringify({ ts: 1700000000, gameId: '1', platform: 'steam', playtimeMinutes: 10 }),
      JSON.stringify({ ts: 1700003600, gameId: '1', platform: 'steam', playtimeMinutes: 20 }),
      JSON.stringify({ ts: 1700086400, gameId: '1', platform: 'steam', playtimeMinutes: 30 }),
      JSON.stringify({ ts: 1700000000, gameId: '2', platform: 'steam', playtimeMinutes: 5 }),
      JSON.stringify({ ts: 1700000000000, gameId: '2', platform: 'steam', playtimeMinutes: 6 }),
      '깨진 줄',
      JSON.stringify({ ts: 1, gameId: '3' }),
      '',
    ].join('\n'),
  );
  writeFileSync(join(dir, 'library.md'), '| title | game_id |\n| --- | --- |\n| g | 1 |\n');
  return dir;
}

interface Report {
  keptRows: number;
  dropped: { reason: string; count: number }[];
  representativeRows: number;
  excludedRows: number;
  gapCandidates: unknown[];
  sourceSha256Before: string;
  sourceSha256After: string;
}

function runCli(dir: string): Report {
  const cacheDir = join(dir, 'cache');
  mkdirSync(cacheDir, { recursive: true });
  execFileSync(
    'pnpm',
    [
      'tsx',
      TOOL,
      '--history',
      join(dir, 'history.jsonl'),
      '--cache',
      cacheDir,
      '--library',
      join(dir, 'library.md'),
      '--tz',
      'Asia/Seoul',
      '--out',
      join(dir, 'report.json'),
    ],
    { cwd: REPO, stdio: 'pipe' },
  );
  return JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')) as Report;
}

describe('migrate dry-run', () => {
  it('(게임, 로컬일)별 첫 관측만 남긴다', () => {
    const report = runCli(fixtureDir());
    expect(report.keptRows).toBe(5);
    expect(report.dropped).toEqual([
      { reason: 'malformed-json', count: 1 },
      { reason: 'missing-field', count: 1 },
    ]);
    expect(report.representativeRows).toBe(3);
    expect(report.excludedRows).toBe(2);
    expect(report.gapCandidates).toEqual([]);
    expect(report.sourceSha256Before).toBe(report.sourceSha256After);
  });

  it('인자 없으면 실패한다', () => {
    expect(() => execFileSync('pnpm', ['tsx', TOOL], { cwd: REPO, stdio: 'pipe' })).toThrow();
  });
});
