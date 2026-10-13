import { describe, expect, it } from 'vitest';
import {
  judgeSeriesBundles,
  normalizeSeriesDeveloper,
  normalizeSeriesTitle,
  SERIES_MIN_BUNDLE_SIZE,
} from '@questail/core';
import type { GameFacts, SeriesAliasInput } from '@questail/core';

/**
 * T3 시리즈 판별 단위 테스트 (계약 R15-6, 동결 v1.0).
 * 합성 픽스처만 쓴다. 캡틴 실데이터를 기대값 근거로 쓰지 않는다.
 */
function fact(
  externalId: string,
  over: Partial<GameFacts> = {},
): GameFacts {
  return {
    key: { platform: 'steam', externalId },
    name: null,
    titleKo: null,
    developerRaw: null,
    releaseDate: null,
    releaseDateText: null,
    genres: [],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 0,
    lastPlayed: null,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: [],
    wishlist: [],
    tags: [],
    tagStatus: 'not_collected',
    achievements: [],
    achievementState: 'not_collected',
    achievementSummary: null,
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
    ...over,
  };
}

const BROKEN: SeriesAliasInput = { aliases: null, status: 'broken' };
const MISSING: SeriesAliasInput = { aliases: null, status: 'missing' };
const okAliases = (aliases: Record<string, string>): SeriesAliasInput => ({ aliases, status: 'ok' });

describe('정규화 파이프라인 순서 ①→②→③→④', () => {
  it('소문자·꼬리·숫자·코어 — FINAL FANTASY VII Remake', () => {
    expect(normalizeSeriesTitle('FINAL FANTASY VII Remake')).toEqual({
      normalized: 'final fantasy 7',
      core: 'final fantasy 7',
    });
  });
  it('꼬리 반복 제거 — Deluxe Edition Remastered 둘 다 제거', () => {
    expect(normalizeSeriesTitle('Foo Deluxe Edition Remastered').normalized).toBe('foo');
  });
  it('Deluxe 단독은 계약 꼬리가 아니다 — Foo Deluxe Remastered → foo deluxe', () => {
    expect(normalizeSeriesTitle('Foo Deluxe Remastered').normalized).toBe('foo deluxe');
  });
  it('꼬리만 남은 이름은 자르지 않는다 — Remake', () => {
    expect(normalizeSeriesTitle('Remake').normalized).toBe('remake');
  });
  it('대소문자 무시 후치 절단 — GAME DELUXE EDITION', () => {
    expect(normalizeSeriesTitle('GAME DELUXE EDITION').normalized).toBe('game');
  });
  it("Director's Cut 절단", () => {
    expect(normalizeSeriesTitle("Bar Director's Cut").normalized).toBe('bar');
  });
  it('로마 I~X 통일 — Dark Souls II → dark souls 2', () => {
    expect(normalizeSeriesTitle('Dark Souls II').normalized).toBe('dark souls 2');
  });
  it('로마 XI~ 통일 안 함 — Final Fantasy XI 유지', () => {
    expect(normalizeSeriesTitle('Final Fantasy XI').normalized).toBe('final fantasy xi');
  });
  it('4자리 숫자 통일 제외 — Battlefield 2042 유지', () => {
    expect(normalizeSeriesTitle('Battlefield 2042').normalized).toBe('battlefield 2042');
  });
  it('Part N·접미 N 동일 처리 — Game Part II ≡ Game 2', () => {
    expect(normalizeSeriesTitle('Game Part II').normalized).toBe('game 2');
    expect(normalizeSeriesTitle('Game 2').normalized).toBe('game 2');
  });
  it('Part 4자리 숫자는 손대지 않는다', () => {
    expect(normalizeSeriesTitle('Game Part 2042').normalized).toBe('game part 2042');
  });
  it('코어 구분자 — 콜론·하이픈·괄호·en dash (콤마는 구분자 아님)', () => {
    expect(normalizeSeriesTitle('The Witcher 3: Wild Hunt Complete Edition').core).toBe('the witcher 3');
    expect(normalizeSeriesTitle('A, B').core).toBe('a, b');
    expect(normalizeSeriesTitle('A - B').core).toBe('a');
    expect(normalizeSeriesTitle('Game (2020)').core).toBe('game');
    expect(normalizeSeriesTitle('A – B').core).toBe('a');
  });
  it('단어 내 하이픈은 구분자가 아니다 — Souls-like 유지', () => {
    expect(normalizeSeriesTitle('Souls-like Game').normalized).toBe('souls-like game');
  });
});

describe('별칭 조회 — ③ 후 전체 정확 일치, 접두 금지(C15)', () => {
  it('내장 별칭 적중 — Biohazard → resident-evil (missing)', () => {
    const r = judgeSeriesBundles({ games: [fact('1', { name: 'Biohazard' })], seriesAliases: MISSING });
    expect(r.aliasSource).toBe('builtin');
    expect(r.items[0]).toMatchObject({ normalized: 'biohazard', bundleId: 'alias:resident-evil', via: 'alias' });
    expect(r.aliasBundleCount).toBe(1);
  });
  it('접두 매칭 금지 — Monster Hunter: World는 내장 monster hunter에 걸리지 않는다', () => {
    const r = judgeSeriesBundles({ games: [fact('1', { name: 'Monster Hunter: World' })], seriesAliases: MISSING });
    expect(r.items[0]).toMatchObject({ normalized: 'monster hunter: world', core: 'monster hunter', via: 'core' });
    expect(r.items[0]?.bundleId).toBe('core:monster hunter');
    expect(r.aliasBundleCount).toBe(0);
  });
  it('broken이면 별칭 없이 정규화만 — Biohazard 단독 코어', () => {
    const r = judgeSeriesBundles({ games: [fact('1', { name: 'Biohazard' })], seriesAliases: BROKEN });
    expect(r.aliasSource).toBe('none');
    expect(r.items[0]).toMatchObject({ bundleId: 'core:biohazard', via: 'core' });
  });
  it('ok 파일 별칭 적중 — 전체 정확 일치만', () => {
    const r = judgeSeriesBundles({
      games: [fact('1', { name: 'Dark Souls II' }), fact('2', { name: 'Dark Souls III' })],
      seriesAliases: okAliases({ 'dark souls 2': 'dark-souls', 'dark souls 3': 'dark-souls' }),
    });
    expect(r.aliasSource).toBe('file');
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]).toMatchObject({ bundleId: 'alias:dark-souls', via: 'alias', size: 2 });
  });
});

describe('코어 동등 · 개발사 보조', () => {
  it('에디션 차이만 있으면 같은 묶음 — Hades ≡ Hades Complete Edition', () => {
    const r = judgeSeriesBundles({
      games: [fact('1', { name: 'Hades' }), fact('2', { name: 'Hades Complete Edition' })],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]).toMatchObject({ bundleId: 'core:hades', size: 2 });
    expect(r.bundleCount).toBe(1);
  });
  it('번호 후속작은 같은 개발사면 묶임 — dark souls 2 vs dark souls 3 (마지막 토큰만 다름)', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Dark Souls II', developerRaw: 'FromSoftware Inc.' }),
        fact('2', { name: 'Dark Souls III', developerRaw: 'FromSoftware' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]).toMatchObject({ via: 'core-dev', size: 2 });
  });
  it('번호 후속작도 개발사가 다르면 묶이지 않는다', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Dark Souls II', developerRaw: 'FromSoftware' }),
        fact('2', { name: 'Dark Souls III', developerRaw: 'Other Studio' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(2);
  });
  it('번호 후속작도 개발사가 null이면 묶이지 않는다', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Dark Souls II', developerRaw: 'FromSoftware' }),
        fact('2', { name: 'Dark Souls III' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(2);
  });
  it('앞 토큰이 다르면 묶이지 않는다 — dark souls 2 vs demon souls 2 (같은 개발사라도)', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Dark Souls II', developerRaw: 'FromSoftware' }),
        fact('2', { name: 'Demon Souls II', developerRaw: 'FromSoftware Inc.' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(2);
  });
  it('개발사 보조 — 접미 1토큰 차이만 병합 (Doom ≡ Doom Eternal, 개발사 동등)', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Doom', developerRaw: 'id Software LLC' }),
        fact('2', { name: 'Doom Eternal', developerRaw: 'id Software' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(1);
    expect(r.bundles[0]).toMatchObject({ via: 'core-dev', size: 2 });
  });
  it('개발사 다르면 접미 1토큰이어도 병합 안 함', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Doom', developerRaw: 'id Software' }),
        fact('2', { name: 'Doom Eternal', developerRaw: 'Other Studio' }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.bundles).toHaveLength(2);
  });
  it('alias 묶음은 개발사 보조로 손대지 않는다', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Biohazard', developerRaw: 'Capcom' }),
        fact('2', { name: 'Biohazard Eternal', developerRaw: 'Capcom' }),
      ],
      seriesAliases: MISSING,
    });
    const ids = r.bundles.map((b) => b.bundleId).sort();
    expect(ids).toEqual(['alias:resident-evil', 'core:biohazard eternal']);
  });
});

describe('개발사 정규화 — 단어 경계, Co 부분일치 금지', () => {
  it('접미어 제거 — FromSoftware Inc. ≡ fromsoftware', () => {
    expect(normalizeSeriesDeveloper('FromSoftware Inc.')).toBe('fromsoftware');
    expect(normalizeSeriesDeveloper('id Software LLC')).toBe('id software');
  });
  it('Co 부분일치 금지 — Acme Company 유지, Acme Co 제거', () => {
    expect(normalizeSeriesDeveloper('Acme Company')).toBe('acme company');
    expect(normalizeSeriesDeveloper('Acme Co')).toBe('acme');
  });
  it('null·빈값은 null', () => {
    expect(normalizeSeriesDeveloper(null)).toBeNull();
    expect(normalizeSeriesDeveloper('Inc.')).toBeNull();
  });
});

describe('hidden 제외(R15-2 ①) · 이름 없음 · 결정성', () => {
  it('hidden은 입력 단계 제외 + 제외 수 반환', () => {
    const r = judgeSeriesBundles({
      games: [
        fact('1', { name: 'Hades' }),
        fact('2', { name: 'Hades', hidden: true }),
        fact('3', { name: 'Other', hidden: true }),
      ],
      seriesAliases: BROKEN,
    });
    expect(r.hiddenExcluded).toBe(2);
    expect(r.items).toHaveLength(1);
    expect(r.bundles[0]).toMatchObject({ size: 1 });
  });
  it('이름 없음(null)은 서로 묶지 않는다', () => {
    const r = judgeSeriesBundles({ games: [fact('1'), fact('2')], seriesAliases: BROKEN });
    expect(r.bundles).toHaveLength(2);
  });
  it('같은 입력→같은 출력 바이트 (입력 순서 바꿔도 동일)', () => {
    const games = [
      fact('2', { name: 'Doom Eternal', developerRaw: 'id Software' }),
      fact('1', { name: 'Hades' }),
      fact('3', { name: 'Doom', developerRaw: 'id Software LLC' }),
    ];
    const a = JSON.stringify(judgeSeriesBundles({ games, seriesAliases: BROKEN }));
    const b = JSON.stringify(judgeSeriesBundles({ games: [...games].reverse(), seriesAliases: BROKEN }));
    expect(a).toBe(b);
    // items는 key 오름차순 고정
    const keys = (JSON.parse(a) as { items: { key: { externalId: string } }[] }).items.map((i) => i.key.externalId);
    expect(keys).toEqual(['1', '2', '3']);
  });
  it('입력 동결(freeze) 상태에서도 판정 가능 — 입력 변형 없음(순수 함수)', () => {
    const games = [fact('1', { name: 'Hades' })];
    Object.freeze(games);
    Object.freeze(games[0]);
    expect(() => judgeSeriesBundles({ games, seriesAliases: BROKEN })).not.toThrow();
  });
  it('SERIES_MIN_BUNDLE_SIZE = 2 — T2의 H 근거 경계와 1:1', () => {
    expect(SERIES_MIN_BUNDLE_SIZE).toBe(2);
  });
});
