import Database from 'better-sqlite3';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import { renderRecapText } from '../../src/data/recapText.js';
import { renderTbtiShare } from '../../src/data/tbtiShare.js';
import { setPrefs } from '../../src/data/viewState.js';
import {
  RECAP_TEXT_PATH,
  TBTI_SHARE_TEXT_PATH,
  createServerApp,
} from '../../src/server/app.js';

/**
 * W3 — 텍스트 렌더 단일 경로(F-12: 화면 locale 쿼리·Markdown 1종) +
 * 부분 `?` 코드는 보류가 아니다(F-04·F-07: 호칭 없이 코드만, "? ?%" 없음).
 */
const WEB = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const HOST = { headers: { host: '127.0.0.1:4747' } };

function freshDb(): { dir: string; db: Database.Database } {
  const dir = mkdtempSync(join(tmpdir(), 'questail-r15paths-'));
  const journal = JSON.parse(
    readFileSync(join(WEB, 'drizzle', 'meta', '_journal.json'), 'utf8'),
  ) as { entries: { tag: string }[] };
  const setup = new Database(join(dir, 'questail.db'));
  try {
    for (const entry of journal.entries) {
      setup.exec(readFileSync(join(WEB, 'drizzle', `${entry.tag}.sql`), 'utf8'));
    }
  } finally {
    setup.close();
  }
  return { dir, db: new Database(join(dir, 'questail.db')) };
}

function appFor(dir: string, db: Database.Database): ReturnType<typeof createServerApp> {
  return createServerApp({
    exportDeps: { db, exportDir: join(tmpdir(), 'questail-r15paths-unused') },
    settingsDeps: { dataDir: dir, version: '0.0.0-test' },
  });
}

async function withApp(run: (app: ReturnType<typeof createServerApp>, db: Database.Database) => Promise<void>): Promise<void> {
  const { dir, db } = freshDb();
  try {
    await run(appFor(dir, db), db);
  } finally {
    db.close();
    rmSync(dir, { recursive: true, force: true });
  }
}

describe('텍스트 라우트 ?locale= (화면 locale 우선)', () => {
  it('Prefs ko여도 ?locale=en이면 영어', async () => {
    await withApp(async (app) => {
      const share = (await (await app.request(`${TBTI_SHARE_TEXT_PATH}?locale=en`, HOST)).json()) as { text: string };
      expect(share.text).toContain('My TBTI is ????');
      expect(share.text).not.toMatch(/[가-힣]/);
      const recap = (await (await app.request(`${RECAP_TEXT_PATH}?locale=en`, HOST)).json()) as { text: string };
      expect(recap.text).toContain('questail recap — full library');
    });
  });

  it('Prefs en이어도 ?locale=ko면 한국어', async () => {
    await withApp(async (app, db) => {
      setPrefs(db, { locale: 'en' });
      const share = (await (await app.request(`${TBTI_SHARE_TEXT_PATH}?locale=ko`, HOST)).json()) as { text: string };
      expect(share.text).toContain('내 TBTI는 ????');
    });
  });

  it('모르는 locale은 무시하고 Prefs로', async () => {
    await withApp(async (app, db) => {
      setPrefs(db, { locale: 'en' });
      const share = (await (await app.request(`${TBTI_SHARE_TEXT_PATH}?locale=fr`, HOST)).json()) as { text: string };
      expect(share.text).toContain('My TBTI is ????');
    });
  });

  it('?format=markdown — recap.md 1종(frontmatter + 본문)', async () => {
    await withApp(async (app) => {
      const response = await app.request(`${RECAP_TEXT_PATH}?locale=ko&format=markdown`, HOST);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { text: string; filename: string };
      expect(body.filename).toBe('recap.md');
      expect(body.text.startsWith('---\nkind: "recap"\n')).toBe(true);
      expect(body.text).toContain('questail recap — 전체 라이브러리');
      expect(body.text.endsWith('\n')).toBe(true);
    });
  });
});

function axis(
  axisNum: 1 | 2 | 3 | 4,
  primary: TbtiResult['axes'][number]['primary'],
  primaryPct: number | null,
): TbtiResult['axes'][number] {
  return {
    axis: axisNum,
    primary,
    primaryPct,
    secondary: null,
    secondaryPct: null,
    nInterval: null,
    chips: [],
    evidence: [],
    excludedCount: 0,
    held: primary === '?',
    heldReasonKey: primary === '?' ? 'short_sample' : null,
    caveats: [],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
  };
}

const PARTIAL: TbtiResult = {
  code: '?NAC',
  axes: [axis(1, '?', null), axis(2, 'N', 60), axis(3, 'A', 85), axis(4, 'C', 78)],
  pending: false,
  pendingHours: null,
  caveats: [{ code: 'observation_days', count: 2 }],
  gameLetters: [],
  aliasStatus: 'missing',
};

describe('부분 `?` 코드 — 보류 아님, 호칭 없이 코드만', () => {
  it('공유 ko 첫 줄 = 내 TBTI는 ?NAC, `?`축은 축 이름 + ?', () => {
    const lines = renderTbtiShare(PARTIAL, 'ko').split('\n');
    expect(lines[0]).toBe('내 TBTI는 ?NAC');
    expect(lines).toContain('플레이 결 ? · 신작 60% · 잡식 85% · 파먹기 78%');
    expect(lines.join('\n')).not.toContain('{title}');
    expect(lines.join('\n')).not.toContain('? ?%');
  });

  it('공유 en 첫 줄 = My TBTI is ?NAC', () => {
    const text = renderTbtiShare(PARTIAL, 'en');
    expect(text.split('\n')[0]).toBe('My TBTI is ?NAC');
    expect(text).not.toMatch(/[가-힣]/);
  });

  it('리캡 텍스트 TBTI 줄 = - TBTI: ?NAC (ko·en)', () => {
    const recap = {
      basis: { observedDays: 2, rangeStart: null, rangeEnd: null, firstObservedAt: 1700000000 },
      s01: { caveats: [], totalMinutes: 600, top5: [] },
      s02: { caveats: [], knownGames: 0, bars: [] },
      s03: { caveats: [], owned: 1, played: 1, buckets: [], unplayedKeys: [], missingKeys: [] },
      s04: { caveats: [], ratedCount: 0, mean: null, dist10: [], high: [], low: [] },
      s05: { caveats: [], bands: [] },
      s06: { caveats: [], years: [], comparePrevYear: false },
      tbti: { code: '?NAC', pending: false, letters: ['?', 'N', 'A', 'C'], mini: [] },
    } as unknown as LibraryRecap;
    expect(renderRecapText(recap, 'ko')).toContain('- TBTI: ?NAC');
    expect(renderRecapText(recap, 'ko')).not.toContain('????');
    expect(renderRecapText(recap, 'en')).toContain('- TBTI: ?NAC');
  });
});

describe('H주 공유 — 시리즈 반복(F-13)', () => {
  const hMain: TbtiResult = {
    ...PARTIAL,
    code: 'IHAC',
    axes: [
      axis(1, 'I', 80),
      { ...axis(2, 'H', 62), secondary: 'H', secondaryPct: 34 },
      axis(3, 'A', 85),
      axis(4, 'C', 78),
    ],
  };
  it('ko: 본진 62%(시리즈 반복 34%)', () => {
    const text = renderTbtiShare(hMain, 'ko');
    expect(text).toContain('본진 62%(시리즈 반복 34%)');
    expect(text).not.toContain('본진 비중');
  });
  it('en: 한국어 0', () => {
    expect(renderTbtiShare(hMain, 'en')).not.toMatch(/[가-힣]/);
  });
});
