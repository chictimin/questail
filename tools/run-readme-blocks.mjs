#!/usr/bin/env node
/**
 * tools/run-readme-blocks.mjs — README ci:run bash 블록 추출·실행 (INST-1).
 * node 내장 모듈만 쓴다. 새 의존성 0.
 *
 * 사용: node tools/run-readme-blocks.mjs [--root <dir>]
 * - README.md·README.ko.md에서 `<!-- ci:run -->` 바로 다음 ```bash 블록만 추출한다.
 * - `git clone`·단독 `cd` 행은 건너뛴다. CI는 테스트 대상 커밋을 이미 체크아웃했고,
 *   클론은 다른 ref를 가져와 충실도를 해친다.
 * - `pnpm start` 포함 절은 백그라운드(detached 새 그룹) + 임시 PORT/DATA_DIR +
 *   GET /api/health 200 폴링(120초 상한) + 자기 그룹만 종료 + 임시 정리한다.
 * - 그 외 행은 순서대로 실행한다. 실패하면 즉시 exit 1.
 */
import { execFileSync, spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const HEALTH_TIMEOUT_MS = 120000;
const HEALTH_INTERVAL_MS = 1000;
const KILL_TIMEOUT_MS = 10000;

function usageFail(message) {
  console.error(`[readme-blocks] ${message}`);
  process.exit(2);
}

/** ci:run 표식 바로 다음 bash 블록들을 순서대로 돌려준다. */
export function extractBlocks(readmePath) {
  const lines = readFileSync(readmePath, 'utf8').split('\n');
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== '<!-- ci:run -->') continue;
    let j = i + 1;
    while (j < lines.length && lines[j].trim() === '') j++;
    if (j >= lines.length || !lines[j].startsWith('```bash')) {
      throw new Error(`${readmePath}:${i + 1}: ci:run 다음 bash 블록 없음`);
    }
    const body = [];
    j++;
    while (j < lines.length && !lines[j].startsWith('```')) {
      body.push(lines[j]);
      j++;
    }
    if (j >= lines.length) {
      throw new Error(`${readmePath}:${i + 1}: bash 블록 미종료`);
    }
    blocks.push({ file: readmePath, startLine: i + 1, lines: body });
  }
  return blocks;
}

function isSkipped(line) {
  const trimmed = line.trim();
  return (
    trimmed === '' ||
    trimmed.startsWith('git clone') ||
    /^cd(\s|;|$)/.test(trimmed)
  );
}

function runForeground(line, cwd) {
  console.log(`[readme-blocks] run: ${line}`);
  execFileSync(line, { cwd, stdio: 'inherit', shell: true });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  for (;;) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (response.status === 200) return;
    } catch {
      // 아직 안 뜸
    }
    if (Date.now() >= deadline) {
      throw new Error(`GET /api/health 200 없음(${HEALTH_TIMEOUT_MS}ms)`);
    }
    await sleep(HEALTH_INTERVAL_MS);
  }
}

async function waitForDown(port) {
  const deadline = Date.now() + KILL_TIMEOUT_MS;
  for (;;) {
    try {
      await fetch(`http://127.0.0.1:${port}/api/health`);
    } catch {
      return;
    }
    if (Date.now() >= deadline) {
      throw new Error('서버가 내려가지 않음(health 응답 지속)');
    }
    await sleep(500);
  }
}

/** 비어 있는 로컬 포트를 하나 잡는다( tiny race 감수 — 폴링이 검증한다). */
async function freePort() {
  const { default: net } = await import('node:net');
  return await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address !== null ? address.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function killGroup(child) {
  if (process.platform === 'win32') {
    execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'inherit' });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch (error) {
    if (error.code !== 'ESRCH') throw error;
  }
}

async function runStartBackground(cwd, port, dataDir) {
  console.log(`[readme-blocks] start background: pnpm start (port=${port})`);
  const child = spawn('pnpm', ['start'], {
    cwd,
    env: {
      ...process.env,
      QUESTAIL_PORT: String(port),
      QUESTAIL_DATA_DIR: dataDir,
    },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout?.on('data', (chunk) => {
    output += String(chunk);
  });
  child.stderr?.on('data', (chunk) => {
    output += String(chunk);
  });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  try {
    await waitForHealth(port);
    console.log('[readme-blocks] health 200');
  } catch (error) {
    killGroup(child);
    console.error(output);
    throw error;
  }
  killGroup(child);
  const timeout = setTimeout(() => {
    try {
      if (process.platform === 'win32') {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F']);
      } else {
        process.kill(-child.pid, 'SIGKILL');
      }
    } catch {
      // 이미 종료
    }
  }, KILL_TIMEOUT_MS);
  await exited;
  clearTimeout(timeout);
  await waitForDown(port);
  console.log('[readme-blocks] group down, health down');
}

async function runBlock(block, cwd) {
  for (const rawLine of block.lines) {
    if (isSkipped(rawLine)) {
      console.log(`[readme-blocks] skip: ${rawLine.trim()}`);
      continue;
    }
    const segments = rawLine.split('&&').map((part) => part.trim()).filter((part) => part !== '');
    for (const segment of segments) {
      if (segment.includes('pnpm start')) {
        const port = await freePort();
        const dataDir = mkdtempSync(join(tmpdir(), 'questail-readme-data-'));
        try {
          await runStartBackground(cwd, port, dataDir);
        } finally {
          rmSync(dataDir, { recursive: true, force: true });
        }
      } else {
        runForeground(segment, cwd);
      }
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const rootIndex = args.indexOf('--root');
  const root = resolve(rootIndex === -1 ? process.cwd() : (args[rootIndex + 1] ?? usageFail('--root 값 없음')));
  const readmes = [join(root, 'README.md'), join(root, 'README.ko.md')];
  for (const readme of readmes) {
    for (const block of extractBlocks(readme)) {
      console.log(`[readme-blocks] block: ${readme}:${block.startLine} (${block.lines.length}행)`);
      await runBlock(block, root);
    }
  }
  console.log('[readme-blocks] OK');
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]).endsWith('run-readme-blocks.mjs');
if (invokedDirectly) {
  main().catch((error) => {
    console.error(`[readme-blocks] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  });
}
