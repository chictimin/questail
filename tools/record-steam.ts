/**
 * tools/record-steam.ts — 캡틴 실응답 녹화 도구 골격 (S7, 워커 A 소유).
 *
 * 캡틴이 로컬에서 실응답을 녹화할 때만 쓴다. 녹화물은 gitignore 경로
 * `apps/web/test/fixtures/local/` 아래에만 쓰고, 저장소에 올리지 않는다.
 * 녹화 파일에 키·SteamID·요청 URL을 넣지 않는다(응답 본문 + 수집 시각만).
 *
 * S7 범위: 골격만. 실제 호출(fetchApi)은 미구현이라 throw한다. 실녹화 금지.
 *
 * 실행:
 *   pnpm tsx tools/record-steam.ts --key-file <경로> --steam-id <id> --out-dir apps/web/test/fixtures/local --kind owned
 *
 * 이 파일을 직접 실행했을 때만 돈다. import만으로는 돌지 않는다.
 */

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(join(dirname(fileURLToPath(import.meta.url)), '..'));
const LOCAL_DIR = join('apps', 'web', 'test', 'fixtures', 'local');

type Kind = 'owned';

interface Options {
  keyFile: string;
  steamId: string;
  outDir: string;
  kind: Kind;
}

function parseArgs(argv: string[]): Options {
  const get = (name: string): string => {
    const ix = argv.indexOf(name);
    if (ix < 0 || ix + 1 >= argv.length || argv[ix + 1].startsWith('--')) {
      throw new Error(`필수 인자 없음: ${name}`);
    }
    return argv[ix + 1];
  };
  const kind = get('--kind');
  if (kind !== 'owned') {
    throw new Error(`지원하지 않는 kind: ${kind}`);
  }
  return { keyFile: get('--key-file'), steamId: get('--steam-id'), outDir: get('--out-dir'), kind };
}

function assertLocalOutDir(outDir: string): string {
  const abs = resolve(REPO_ROOT, outDir);
  const rel = relative(REPO_ROOT, abs);
  if (rel === '' || rel === '..' || rel.startsWith(`..${sep}`)) {
    throw new Error('out-dir는 저장소 안이어야 한다');
  }
  const localAbs = resolve(REPO_ROOT, LOCAL_DIR);
  if (abs !== localAbs && !abs.startsWith(localAbs + sep)) {
    throw new Error(`out-dir는 ${LOCAL_DIR} 아래여야 한다(녹화물 커밋 금지)`);
  }
  return abs;
}

async function fetchOwnedGames(_key: string, _steamId: string): Promise<never> {
  throw new Error('미구현(S7 골격): 실녹화 금지 기간에는 호출하지 않는다');
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  const absOut = assertLocalOutDir(opts.outDir);
  const key = (await readFile(resolve(REPO_ROOT, opts.keyFile), 'utf8')).trim();
  if (key.length === 0) {
    throw new Error('키 파일이 비어 있다');
  }
  if (!/^\d{17}$/.test(opts.steamId)) {
    throw new Error('steam-id 형식이 아니다(17자리 숫자)');
  }
  const body = await fetchOwnedGames(key, opts.steamId);
  await mkdir(absOut, { recursive: true });
  const record = {
    kind: opts.kind,
    recordedAt: new Date().toISOString(),
    body,
  };
  await writeFile(join(absOut, `${opts.kind}.json`), `${JSON.stringify(record)}\n`, 'utf8');
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
