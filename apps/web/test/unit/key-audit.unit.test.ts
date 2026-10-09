import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';
import { KEY_FILE_NAME } from '../../src/data/index.js';
import { LOG_SINKS } from '../../src/server/logging.js';
import { REDACTED, scrubText } from '../../src/server/redact.js';
import { EXPORT_PATH, createServerApp } from '../../src/server/app.js';

/**
 * INST-3b 감사 테스트 (QA 표면 A~E + ①②③).
 * ③ MD 내보내기는 W9 산출이 없어 항목 없음 — "W9 후 추가".
 */
/** 더미 키 상수 1개(32hex, 실키 아님). redact 단위 테스트와 같은 값. */
const DUMMY_KEY = 'abcdef0123456789abcdef0123456789';
const HOST_HEADERS = { host: '127.0.0.1:4747' };
const here = dirname(fileURLToPath(import.meta.url));

/** :param 자리 샘플 맵 — 라우트 자동 열거(①)가 통째 호출에 쓴다. */
const PARAM_SAMPLES: Record<string, string> = {
  platform: 'steam',
  externalId: '123',
  source: 'owned',
};

function samplePath(path: string): string {
  return path.replace(/:([^/]+)/g, (_, name: string) => PARAM_SAMPLES[name] ?? 'x');
}

describe('① 전 라우트 app.request → 응답 본문 키 0회', () => {
  it('app.routes 열거 + 샘플 맵 호출', async () => {
    const app = createServerApp();
    expect(app.routes.length).toBeGreaterThan(0);
    for (const route of app.routes) {
      const response = await app.request(samplePath(route.path), {
        method: route.method,
        headers: { ...HOST_HEADERS },
      });
      const text = await response.text();
      expect(text).not.toContain(DUMMY_KEY);
      expect(text).not.toContain(encodeURIComponent(DUMMY_KEY));
    }
  });
});

describe('② console 가로채기 + 강제 500 주입', () => {
  it('500 본문 고정 + 가로챈 console에 키 없음', async () => {
    const captured: unknown[][] = [];
    const spy = vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      captured.push(args);
    });
    try {
      const app = createServerApp();
      app.get('/boom', () => {
        throw new Error(`fail ${DUMMY_KEY}`);
      });
      const response = await app.request('/boom', { headers: { ...HOST_HEADERS } });
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ code: 'INTERNAL', params: {} });
      expect(JSON.stringify(captured)).not.toContain(DUMMY_KEY);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('A stderr 통째 캡처(자식 프로세스)', () => {
  it('자식 stderr에 키 없음 + canary 존재(캡처 비어 있지 않음)', () => {
    const redactPath = join(here, '..', '..', 'src', 'server', 'redact.ts');
    const dir = mkdtempSync(join(tmpdir(), 'key-audit-a-'));
    const probePath = join(dir, 'probe.ts');
    writeFileSync(
      probePath,
      `import { scrubText } from ${JSON.stringify(redactPath)};\n` +
        `const k = ${JSON.stringify(DUMMY_KEY)};\n` +
        `console.error(scrubText('leak ' + k, [k]));\n` +
        `console.error('canary-audit-a');\n`,
    );
    try {
      const result = spawnSync(process.execPath, ['--experimental-strip-types', probePath], {
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stderr).toContain('canary-audit-a');
      expect(result.stderr).not.toContain(DUMMY_KEY);
      expect(result.stderr).not.toContain(encodeURIComponent(DUMMY_KEY));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('B LOG_SINKS 자동 포함', () => {
  it('실 export 값이 빈 배열', () => {
    expect(LOG_SINKS).toEqual([]);
  });
});

function sweepDataDir(dir: string): string[] {
  const hits: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      hits.push(...sweepDataDir(full));
    } else if (entry.isFile() && entry.name !== KEY_FILE_NAME) {
      const text = readFileSync(full, 'utf8');
      if (text.includes(DUMMY_KEY) || text.includes(encodeURIComponent(DUMMY_KEY))) {
        hits.push(full);
      }
    }
  }
  return hits;
}

describe('C 데이터 디렉터리 전수(KEY_FILE_NAME 1개만 제외)', () => {
  it('키 파일 제외 상수는 data/index.ts export 값 "steam.key"', () => {
    expect(KEY_FILE_NAME).toBe('steam.key');
  });

  it('키 파일에 키가 있어도 제외 → clean, 다른 파일 검출 동작', () => {
    const dir = mkdtempSync(join(tmpdir(), 'key-audit-c-'));
    try {
      writeFileSync(join(dir, KEY_FILE_NAME), DUMMY_KEY);
      mkdirSync(join(dir, 'sub'));
      writeFileSync(join(dir, 'prefs.json'), '{"locale":"ko"}');
      expect(sweepDataDir(dir)).toEqual([]);
      writeFileSync(join(dir, 'sub', 'note.json'), `{"x":"${DUMMY_KEY}"}`);
      expect(sweepDataDir(dir)).toEqual([join(dir, 'sub', 'note.json')]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('D params·로그 URL redacted', () => {
  it('INVALID_HOST·INVALID_ORIGIN params에 원문 없음', async () => {
    const app = createServerApp();
    const badHost = await app.request('http://x/api/health', {
      headers: { host: 'evil.com' },
    });
    expect(await badHost.json()).toEqual({
      code: 'INVALID_HOST',
      params: { host: REDACTED },
    });
    const badOrigin = await app.request('http://x/api/health', {
      headers: { ...HOST_HEADERS, origin: 'http://evil.com' },
    });
    expect(await badOrigin.json()).toEqual({
      code: 'INVALID_ORIGIN',
      params: { origin: REDACTED },
    });
  });

  it('URL 속 키 치환', () => {
    expect(scrubText(`https://a/?key=${DUMMY_KEY}&x=1`, [DUMMY_KEY])).toBe(
      `https://a/?key=${REDACTED}&x=1`,
    );
  });
});

describe('E process.env·argv 덤프 grep', () => {
  it('덤프 문자열 scrub 시 키 없음(메커니즘)', () => {
    const dump = JSON.stringify({ ...process.env, QUESTAIL_AUDIT_DUMMY: DUMMY_KEY });
    const scrubbed = scrubText(`${dump} ${process.argv.join(' ')}`, [DUMMY_KEY]);
    expect(scrubbed).not.toContain(DUMMY_KEY);
  });

  it('server 소스에 process.stderr 직접 쓰기 없음', () => {
    const serverDir = join(here, '..', '..', 'src', 'server');
    const offenders: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
        } else if (entry.isFile() && entry.name.endsWith('.ts')) {
          if (readFileSync(full, 'utf8').includes('process.stderr')) {
            offenders.push(full);
          }
        }
      }
    };
    walk(serverDir);
    expect(offenders).toEqual([]);
  });
});

function sweepNeedleHits(dir: string, needles: string[]): string[] {
  const hits: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const text = readFileSync(full, 'utf8');
        if (needles.some((needle) => text.includes(needle))) {
          hits.push(full);
        }
      }
    }
  };
  walk(dir);
  return hits;
}

const KEY_NEEDLES = [DUMMY_KEY, encodeURIComponent(DUMMY_KEY)];

describe('③ MD 내보내기 산출 grep(POST /api/export 경유)', () => {
  it('실제 쓰기 → <dataDir>/export 아래 키 0회', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'key-audit-export-'));
    const dbPath = join(dir, 'questail.db');
    const webRoot = join(here, '..', '..');
    const setup = new Database(dbPath);
    try {
      const journal = JSON.parse(
        readFileSync(join(webRoot, 'drizzle', 'meta', '_journal.json'), 'utf8'),
      ) as { entries: { tag: string }[] };
      for (const entry of journal.entries) {
        setup.exec(readFileSync(join(webRoot, 'drizzle', `${entry.tag}.sql`), 'utf8'));
      }
    } finally {
      setup.close();
    }
    const db = new Database(dbPath);
    try {
      db.prepare(
        'INSERT INTO games (platform, external_id, name) VALUES (?, ?, ?)',
      ).run('steam', '990011', 'canary-export-game');
      db.prepare(
        'INSERT INTO ownership_spans (platform, external_id, origin, started_at, ended, is_baseline) VALUES (?, ?, ?, ?, ?, ?)',
      ).run('steam', '990011', 'observed', 1700000000, 0, 0);
      const exportDir = join(dir, 'export');
      const app = createServerApp({ exportDeps: { db, exportDir } });
      const response = await app.request(EXPORT_PATH, {
        method: 'POST',
        headers: { ...HOST_HEADERS, 'content-type': 'application/json' },
        body: JSON.stringify({ locale: 'ko' }),
      });
      expect(response.status).toBe(200);
      const created = readdirSync(exportDir);
      expect(created.length).toBeGreaterThan(0);
      expect(sweepNeedleHits(exportDir, KEY_NEEDLES)).toEqual([]);
      // 탐지 공백 방지 positive control: 게임명 canary는 산출물에 있어야 한다
      expect(sweepNeedleHits(exportDir, ['canary-export-game']).length).toBeGreaterThan(0);
      // 탐지 동작 확인: 키를 직접 심으면 검출된다
      const planted = join(exportDir, created[0] as string);
      writeFileSync(planted, `\nleak ${DUMMY_KEY}\n`, { flag: 'a' });
      expect(sweepNeedleHits(exportDir, KEY_NEEDLES)).toEqual([planted]);
    } finally {
      db.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
