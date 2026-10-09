import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * D-16 시나리오 실행 가능 형식 테스트. 순서·필수분·별점 이벤트를 확인한다.
 * expected facts/oracle은 범위 밖(PRE2 QA 소유).
 */
const STEAM = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'steam');

interface Step {
  at: string;
  day: string;
  timezone: string;
  owned?: string;
  wishlist?: string;
  meta?: string;
  achievements?: string;
  steamspy?: string;
  user?: { type: string; appid: number; score?: number }[];
}

interface Scenario {
  id: string;
  title: string;
  repro: string;
  steps: Step[];
}

/** 해석기 필요분: 파싱 + 시간 순서 + 참조 파일 존재 + at/day 일치. */
function loadScenarios(): Scenario[] {
  const manifest = JSON.parse(readFileSync(join(STEAM, 'scenarios.json'), 'utf8')) as {
    version: number;
    scenarios: Scenario[];
  };
  expect(manifest.version).toBe(2);
  const dayInZone = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  for (const scenario of manifest.scenarios) {
    expect(scenario.repro.length).toBeGreaterThan(0);
    let prev = '';
    for (const step of scenario.steps) {
      expect(step.at > prev).toBe(true);
      prev = step.at;
      expect(step.day.length).toBe(10);
      expect(dayInZone.format(new Date(step.at))).toBe(step.day);
      for (const key of ['owned', 'wishlist', 'meta', 'achievements', 'steamspy'] as const) {
        const file = step[key];
        if (file !== undefined) {
          expect(existsSync(join(STEAM, file))).toBe(true);
        }
      }
    }
  }
  return manifest.scenarios;
}

describe('scenarios', () => {
  it('7시나리오가 순서대로 실행 가능하다', () => {
    const scenarios = loadScenarios();
    expect(scenarios.map((s) => s.id)).toEqual([
      'baseline-first-month',
      'replay',
      'month-boundary-gap',
      'reown',
      'rewish',
      'rating-edit',
      'offline-gap',
    ]);
  });

  it('첫 달 기준선은 ready·empty 태그 응답을 연결한다', () => {
    const scenarios = loadScenarios();
    const baseline = scenarios.find((s) => s.id === 'baseline-first-month');
    const files = (baseline?.steps ?? [])
      .map((step) => step.steamspy)
      .filter((file): file is string => file !== undefined);
    expect(files.length).toBeGreaterThan(0);
    let ready = 0;
    let empty = 0;
    for (const file of files) {
      const body = JSON.parse(readFileSync(join(STEAM, file), 'utf8')) as Record<string, unknown[]>;
      for (const tags of Object.values(body)) {
        if (tags.length > 0) ready += 1;
        else empty += 1;
      }
    }
    expect(ready).toBeGreaterThan(0);
    expect(empty).toBeGreaterThan(0);
  });

  it('rating-edit에 별점 이벤트가 있다', () => {
    const scenarios = loadScenarios();
    const rating = scenarios.find((s) => s.id === 'rating-edit');
    const types = (rating?.steps ?? []).flatMap((step) => (step.user ?? []).map((e) => e.type));
    expect(types).toContain('rate');
    expect(types).toContain('cancel');
  });

  it('참조 파일이 전부 존재한다', () => {
    const files = new Set(readdirSync(STEAM));
    for (const name of [
      'owned-normal.json',
      'owned-reown.json',
      'wishlist.json',
      'wishlist-narrow.json',
      'appdetails.json',
    ]) {
      expect(files.has(name)).toBe(true);
    }
  });
});
