/**
 * tools/generate-fixtures.ts — 합성 대량 픽스처 생성기 (D-16, A 소유).
 *
 * 1000·5000건 owned 목록을 결정적으로 찍어낸다. 출력은 gitignore 경로
 * `apps/web/test/fixtures/local/` 아래에만 쓰고 커밋하지 않는다.
 * 시드 고정이라 같은 입력은 같은 바이트를 낸다.
 *
 * 실행:
 *   pnpm tsx tools/generate-fixtures.ts --count 1000 --out-dir apps/web/test/fixtures/local
 *
 * 이 파일을 직접 실행했을 때만 돈다. import만으로는 돌지 않는다.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const LOCAL_DIR = join('apps', 'web', 'test', 'fixtures', 'local');

function parseArgs(argv: string[]): { count: number; outDir: string } {
  const get = (name: string): string => {
    const ix = argv.indexOf(name);
    if (ix < 0 || ix + 1 >= argv.length || argv[ix + 1].startsWith('--')) {
      throw new Error(`필수 인자 없음: ${name}`);
    }
    return argv[ix + 1];
  };
  const count = Number(get('--count'));
  if (!Number.isInteger(count) || count <= 0 || count > 10000) {
    throw new Error('count는 1~10000 정수다');
  }
  return { count, outDir: get('--out-dir') };
}

function assertLocalOutDir(outDir: string): string {
  const abs = resolve(REPO_ROOT, outDir);
  const localAbs = resolve(REPO_ROOT, LOCAL_DIR);
  if (abs !== localAbs && !abs.startsWith(localAbs + sep)) {
    throw new Error(`out-dir는 ${LOCAL_DIR} 아래여야 한다(대량 픽스처 커밋 금지)`);
  }
  return abs;
}

/** 결정적 생성. mulberry32 시드 고정. */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const absOut = assertLocalOutDir(opts.outDir);
  const rand = mulberry32(20261009);
  const games = [];
  for (let i = 0; i < opts.count; i += 1) {
    const appid = 991000 + i;
    games.push({
      appid,
      playtime_forever: Math.floor(rand() * 20000),
      rtime_last_played: 1700000000 + Math.floor(rand() * 20000000),
    });
  }
  await mkdir(absOut, { recursive: true });
  await writeFile(
    join(absOut, `owned-synthetic-${opts.count}.json`),
    `${JSON.stringify({ response: { game_count: games.length, games } })}\n`,
    'utf8',
  );
}

const IS_ENTRY =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (IS_ENTRY) {
  try {
    await main();
  } catch (err) {
    console.error(err instanceof Error ? err.message : String(err));
    process.exitCode = 1;
  }
}
