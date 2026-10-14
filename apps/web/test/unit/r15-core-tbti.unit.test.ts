import { describe, expect, it } from 'vitest';
import {
  judgeTbti,
  TBTI_IR_TAGS_I,
  TBTI_IR_TAGS_R,
} from '@questail/core';
import type { GameFacts, SeriesAliasInput, TbtiJudgeInput } from '@questail/core';

/**
 * T2 TBTI 판정 단위 테스트 (계약 R15-5·R15-4, v1.1: F-05·F-15·F-27·F-30·F-39·F-43 + metrics·gameLetters·aliasStatus).
 * 합성 픽스처만 쓴다. 실 Steam·실키 호출 없음. 캡틴 실데이터를 기대값 근거로 쓰지 않는다.
 */
const NOW = Math.floor(Date.UTC(2026, 9, 13, 0, 0, 0) / 1000);
const DAY = 86400;
const dayOf = (year: number, month = 0, day = 1): number =>
  Math.floor(Date.UTC(year, month, day) / 1000);

const BROKEN: SeriesAliasInput = { aliases: null, status: 'broken' };
const MISSING: SeriesAliasInput = { aliases: null, status: 'missing' };

const keyOf = (id: string): GameFacts['key'] => ({ platform: 'steam', externalId: id });

function makeFacts(id: string, over: Partial<GameFacts> = {}): GameFacts {
  return {
    key: keyOf(id),
    name: `Game ${id}`,
    titleKo: null,
    developerRaw: null,
    releaseDate: dayOf(2020),
    releaseDateText: null,
    genres: [{ genreId: 'Action', nameEn: 'Action', nameKo: null }],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: null,
    confirmedMinutes: 600,
    lastPlayed: dayOf(2020) + 7200,
    snapshots: [],
    deltas: [],
    coverage: { firstObservedAt: null, lastObservedAt: null, gapDays: [], isBaseline: false },
    ownership: [],
    wishlist: [],
    tags: [{ tag: 'Story Rich', votes: 10, rank: 1 }],
    tagStatus: 'ready',
    achievements: [{ apiname: 'ach_1', achieved: true, unlockedAt: dayOf(2020) + 3600 }],
    achievementState: 'ready',
    achievementSummary: { achieved: 8, total: 10 },
    latestScore: null,
    ratingEvents: [],
    syncRunRefs: [],
    ...over,
  };
}

function inputOf(games: GameFacts[], over: Partial<TbtiJudgeInput> = {}): TbtiJudgeInput {
  return { games, wishlistEnabled: true, now: NOW, seriesAliases: BROKEN, ownedObservedDays: [], ...over };
}

const tagGame = (id: string, tags: string[]): GameFacts =>
  makeFacts(id, { tags: tags.map((tag) => ({ tag, votes: 10, rank: 1 })) });

describe('r15-core-tbti: 상수 pin', () => {
  it('부록 B 태그 사전 전문 — I 33·R 23', () => {
    expect(TBTI_IR_TAGS_I).toHaveLength(33);
    expect(TBTI_IR_TAGS_R).toHaveLength(23);
    expect(TBTI_IR_TAGS_I).toContain('Open World Survival Craft');
  });
});

describe('r15-core-tbti: 전체 보류', () => {
  it('합 < 300분 → pending, code ????, 4축 ?, pendingHours', () => {
    const result = judgeTbti(inputOf([makeFacts('a', { confirmedMinutes: 299 })]));
    expect(result.pending).toBe(true);
    expect(result.code).toBe('????');
    expect(result.pendingHours).toEqual({ have: 299, need: 300 });
    for (const axis of result.axes) {
      expect(axis.primary).toBe('?');
      expect(axis.primaryPct).toBeNull();
      expect(axis.nInterval).toBeNull();
      expect(axis.held).toBe(true);
    }
  });

  it('합 정확히 300분 → 판정 (보류 아님, pendingHours null)', () => {
    const result = judgeTbti(inputOf([makeFacts('a', { confirmedMinutes: 300 })]));
    expect(result.pending).toBe(false);
    expect(result.pendingHours).toBeNull();
  });
});

describe('r15-core-tbti: ① I/R', () => {
  it('I 우세 → I, similar 없음(차이 큼)', () => {
    const games = [
      tagGame('i1', ['Story Rich']),
      tagGame('i2', ['story rich']),
      tagGame('i3', ['Exploration']),
      tagGame('r1', ['Puzzle']),
    ];
    const result = judgeTbti(inputOf(games));
    const axis = result.axes[0];
    expect(axis.primary).toBe('I');
    expect(axis.primaryPct).toBeCloseTo(75, 12);
    expect(axis.secondary).toBe('R');
    expect(axis.secondaryPct).toBeCloseTo(25, 12);
    expect(axis.chips).not.toContain('similar');
    expect(axis.held).toBe(false);
  });

  it('대소문자 무시 정확 일치 · 부분일치 금지', () => {
    // 'story rich' 소문자는 적중, 'Open Worl'·'Open World Survival'은 어느 사전 항목과도 정확 일치하지 않아 제외.
    const games = [
      tagGame('a', ['story rich']),
      tagGame('b', ['Open Worl']),
      tagGame('c', ['Open World Survival']),
      tagGame('d', ['Puzzle']),
      tagGame('e', ['Puzzle']),
    ];
    const result = judgeTbti(inputOf(games));
    const axis = result.axes[0];
    // 판정 편 = a(I 1) + d,e(R 각 1) = 3편 → 표본 충족. b,c는 제외.
    expect(axis.excludedCount).toBe(2);
    expect(axis.primary).toBe('R');
    expect(axis.primaryPct).toBeCloseTo((2 / 3) * 100, 12);
  });

  it('둘 다 → 양쪽 0.5편', () => {
    const games = [
      tagGame('a', ['Story Rich', 'Puzzle']),
      tagGame('b', ['Story Rich']),
      tagGame('c', ['Puzzle']),
    ];
    const result = judgeTbti(inputOf(games));
    const axis = result.axes[0];
    // I = 1.5, R = 1.5 → 50/50 → 동률 I, similar.
    expect(axis.primary).toBe('I');
    expect(axis.primaryPct).toBeCloseTo(50, 12);
    expect(axis.chips).toContain('similar');
  });

  it('차이 정확히 10 → similar · 초과 → 없음', () => {
    const similarGames = [
      tagGame('i1', ['Story Rich']),
      tagGame('i2', ['Story Rich']),
      tagGame('i3', ['Story Rich']),
      tagGame('i4', ['Story Rich']),
      tagGame('i5', ['Story Rich']),
      tagGame('b1', ['Story Rich', 'Puzzle']),
      tagGame('r1', ['Puzzle']),
      tagGame('r2', ['Puzzle']),
      tagGame('r3', ['Puzzle']),
      tagGame('r4', ['Puzzle']),
    ];
    const similar = judgeTbti(inputOf(similarGames)).axes[0];
    // I = 5.5, R = 4.5 → I 55%, 차이 10 → similar.
    expect(similar.primaryPct).toBeCloseTo(55, 12);
    expect(similar.chips).toContain('similar');

    const farGames = [
      tagGame('i1', ['Story Rich']),
      tagGame('i2', ['Story Rich']),
      tagGame('i3', ['Story Rich']),
      tagGame('i4', ['Story Rich']),
      tagGame('i5', ['Story Rich']),
      tagGame('i6', ['Story Rich']),
      tagGame('r1', ['Puzzle']),
      tagGame('r2', ['Puzzle']),
      tagGame('r3', ['Puzzle']),
      tagGame('r4', ['Puzzle']),
    ];
    const far = judgeTbti(inputOf(farGames)).axes[0];
    // I 60 / R 40 → 차이 20 → similar 없음.
    expect(far.chips).not.toContain('similar');
  });

  it('tagStatus failed 보존 태그는 제외 · 2편이면 ? short_sample', () => {
    const games = [
      tagGame('a', ['Story Rich']),
      tagGame('b', ['Story Rich']),
      makeFacts('c', {
        tags: [{ tag: 'Story Rich', votes: 10, rank: 1 }],
        tagStatus: 'failed',
      }),
    ];
    const result = judgeTbti(inputOf(games));
    const axis = result.axes[0];
    expect(axis.primary).toBe('?');
    expect(axis.held).toBe(true);
    expect(axis.heldReasonKey).toBe('short_sample');
    expect(axis.excludedCount).toBe(1);
    expect(axis.caveats).toContainEqual({ code: 'tag_uncollected', count: 1 });
  });

  it('evidence는 상위 5행 · piece 내림차순 · 동률 key 오름차순', () => {
    const games = [
      tagGame('g7', ['Story Rich']),
      tagGame('g6', ['Story Rich']),
      tagGame('g5', ['Story Rich']),
      tagGame('g4', ['Story Rich']),
      tagGame('g3', ['Story Rich']),
      tagGame('g2', ['Story Rich', 'Puzzle']),
      tagGame('g1', ['Story Rich', 'Puzzle']),
    ];
    const axis = judgeTbti(inputOf(games)).axes[0];
    expect(axis.evidence).toHaveLength(5);
    expect(axis.evidence.map((row) => row.key.externalId)).toEqual([
      'g3',
      'g4',
      'g5',
      'g6',
      'g7',
    ]);
    expect(axis.evidence[0].metric).toEqual({ value: 1, unit: 'count' });
  });
});

describe('r15-core-tbti: ② N/H', () => {
  const cutoffOf = (release: number): number => release + 365 * DAY;

  function lateGame(id: string, release: number): GameFacts {
    // min unlocked_at > 출시+W → 늦음. lastPlayed NULL(단독 늦음 근거 금지 회피용이 아니라 증거 없음 폴백 확인).
    return makeFacts(id, {
      releaseDate: release,
      achievements: [{ apiname: 'a', achieved: true, unlockedAt: cutoffOf(release) + 100 }],
      lastPlayed: null,
      wishlist: [],
    });
  }

  function noEvidenceGame(id: string, release: number): GameFacts {
    return makeFacts(id, {
      releaseDate: release,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
    });
  }

  it('N 확정 → N, nInterval, secondary H 병기', () => {
    const games = [makeFacts('a'), makeFacts('b'), makeFacts('c')];
    const axis = judgeTbti(inputOf(games)).axes[1];
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
    expect(axis.nInterval).toEqual({ min: 100, max: 100 });
    expect(axis.secondary).toBe('H');
    expect(axis.secondaryPct).toBeCloseTo(0, 12);
    expect(axis.held).toBe(false);
  });

  it('N_min 정확히 50 → N', () => {
    const release = dayOf(2024);
    const games = [makeFacts('a'), makeFacts('b'), lateGame('c', release), lateGame('d', release)];
    const axis = judgeTbti(inputOf(games)).axes[1];
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(50, 12);
  });

  it('N 아님 → H, primaryPct 100−N_max, secondary H', () => {
    const release = dayOf(2024);
    const games = [
      makeFacts('h1', { name: 'Hollow Knight' }),
      makeFacts('h2', { name: 'Hollow Knight: Silksong' }),
      lateGame('c', release),
      { ...noEvidenceGame('d', release) },
    ];
    // h1·h2도 늦음 분류가 되도록 잠금 해제 시점을 늦춘다(기본 픽스처는 확정).
    games[0] = lateGame('h1', release);
    games[0].name = 'Hollow Knight';
    games[1] = lateGame('h2', release);
    games[1].name = 'Hollow Knight: Silksong';
    const axis = judgeTbti(inputOf(games)).axes[1];
    // 확정 0 · 증거 없음 600/2400=25% → N_max 25 < 50 → H 75%.
    expect(axis.primary).toBe('H');
    expect(axis.primaryPct).toBeCloseTo(75, 12);
    expect(axis.secondary).toBe('H');
    expect(axis.secondaryPct).toBeCloseTo(50, 12);
    expect(axis.nInterval).toEqual({ min: 0, max: 25 });
  });

  it('구간 걸침 → ? interval_cross · H≥30이면 secondary H 병기', () => {
    const release = dayOf(2024);
    const early = makeFacts('a', { confirmedMinutes: 1200 });
    const late = lateGame('b', release);
    const none = noEvidenceGame('c', release);
    const late2 = lateGame('d', release);
    late2.name = 'Hollow Knight';
    const axis = judgeTbti(
      inputOf([
        early,
        late,
        none,
        { ...late2, name: 'Hollow Knight' },
        { ...makeFacts('e', { confirmedMinutes: 600, name: 'Hollow Knight: Silksong' }),
          achievements: [{ apiname: 'a', achieved: true, unlockedAt: cutoffOf(release) + 50 }],
          lastPlayed: null,
          wishlist: [],
        },
      ]),
    ).axes[1];
    // 확정 1200/3600=33.3% · 없음 600/3600=16.7% → N_max 50 → 걸침.
    // F-15: 구간 걸침 보류 ②축도 nInterval을 싣는다(short_sample·pending은 null 유지).
    expect(axis.primary).toBe('?');
    expect(axis.heldReasonKey).toBe('interval_cross');
    expect(axis.nInterval?.min).toBeCloseTo((1200 / 3600) * 100, 12);
    expect(axis.nInterval?.max).toBeCloseTo(50, 12);
  });

  it('H≥30 걸침이면 secondary H · H<30 걸침이면 secondary null', () => {
    const release = dayOf(2024);
    // 확정 40% · 없음 20% → 걸침. H 묶음 1800/3000=60%.
    const base = [
      makeFacts('a', { confirmedMinutes: 1200 }),
      lateGame('b', release),
      noEvidenceGame('c', release),
      lateGame('d', release),
    ];
    base[0].name = 'Hollow Knight';
    base[1].name = 'Hollow Knight: Silksong';
    base[3].name = 'Hollow Knight: Voidheart';
    const high = judgeTbti(inputOf(base)).axes[1];
    // H 묶음: Hollow Knight 3작(1200+600+600=2400)/3000=80% ≥ 30.
    expect(high.primary).toBe('?');
    expect(high.secondary).toBe('H');
    expect(high.secondaryPct).toBeCloseTo(80, 12);

    const low = judgeTbti(
      inputOf([
        makeFacts('a', { confirmedMinutes: 1200 }),
        lateGame('b', release),
        noEvidenceGame('c', release),
        lateGame('d', release),
      ]),
    ).axes[1];
    expect(low.primary).toBe('?');
    expect(low.secondary).toBeNull();
    expect(low.secondaryPct).toBeNull();
  });

  it('②축은 similar 없음 · both_strong은 N·H 각 경계 이상일 때만', () => {
    const games = [
      makeFacts('h1', { name: 'Hollow Knight' }),
      makeFacts('h2', { name: 'Hollow Knight: Silksong' }),
      makeFacts('a'),
      makeFacts('b'),
    ];
    // 전부 확정 → N_min 100. H = 1200/2400 = 50% ≥ 30 → both_strong, similar은 절대 없음.
    const axis = judgeTbti(inputOf(games)).axes[1];
    expect(axis.primary).toBe('N');
    expect(axis.chips).toContain('both_strong');
    expect(axis.chips).not.toContain('similar');
  });

  it('H 정확히 30 → both_strong 후보 · 29 → 칩 없음', () => {
    const pair = (minutes: number): GameFacts[] => [
      makeFacts('h1', { name: 'Hollow Knight', confirmedMinutes: minutes }),
      makeFacts('h2', { name: 'Hollow Knight: Silksong', confirmedMinutes: minutes }),
      makeFacts('a', { confirmedMinutes: 3000 - minutes * 2 > 0 ? 3000 - minutes * 2 : 600 }),
    ];
    const at30 = judgeTbti(inputOf(pair(450))).axes[1];
    expect(at30.secondaryPct).toBeCloseTo(30, 12);
    expect(at30.chips).toContain('both_strong');

    const below = judgeTbti(inputOf(pair(435))).axes[1];
    expect(below.secondaryPct).toBeCloseTo(29, 12);
    expect(below.chips).not.toContain('both_strong');
  });

  it('출시 전 찜: on이면 확정 재분류 · off면 증거 없음 + wishlist_toggle_off', () => {
    const release = dayOf(2024);
    const wished = makeFacts('w', {
      releaseDate: release,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [
        {
          dateAdded: release - 10 * DAY,
          firstObservedAt: release - 10 * DAY,
          priority: null,
          observedAt: null,
          ended: false,
          syncRunId: null,
        },
      ],
    });
    const games = [makeFacts('a'), makeFacts('b'), wished];
    const on = judgeTbti(inputOf(games, { wishlistEnabled: true })).axes[1];
    expect(on.primaryPct).toBeCloseTo(100, 12);
    expect(on.caveats.some((caveat) => caveat.code === 'wishlist_toggle_off')).toBe(false);

    const off = judgeTbti(inputOf(games, { wishlistEnabled: false })).axes[1];
    expect(off.primaryPct).toBeCloseTo((1200 / 1800) * 100, 12);
    expect(off.caveats).toContainEqual({ code: 'wishlist_toggle_off', count: null });
  });

  it('관측 스냅샷 확정 시간: 기준선 total 전액 + W 이내 deltas', () => {
    const release = dayOf(2024);
    const cutoff = cutoffOf(release);
    const game = makeFacts('s', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: release + DAY, lastObservedAt: release + 2 * DAY, gapDays: [], isBaseline: true },
      snapshots: [
        {
          observedAt: release + DAY,
          observedDay: '2024-01-02',
          totalMinutes: 400,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [{ observedAt: cutoff - DAY, deltaMinutes: 200, elapsedSeconds: 12000 }],
    });
    const axis = judgeTbti(inputOf([game, makeFacts('a'), makeFacts('b')])).axes[1];
    // 400 + 200 = 600 전액 확정 → N_min 100%.
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
    expect(axis.evidence.find((row) => row.key.externalId === 's')?.reasonKey).toBe(
      'tbti.reason.nh.confirmed_snapshot',
    );
  });

  it('D-14형: 첫 스냅샷이 W 이후면 기준선 total 전액 미확정 · 확정 기여 0(v1.1)', () => {
    const release = dayOf(2020);
    const cutoff = cutoffOf(release);
    const firstObserved = cutoff + DAY;
    const d14 = makeFacts('d14', {
      releaseDate: release,
      confirmedMinutes: 800,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: firstObserved, lastObservedAt: firstObserved + DAY, gapDays: [], isBaseline: true },
      snapshots: [
        {
          observedAt: firstObserved,
          observedDay: '2021-01-02',
          totalMinutes: 5000,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [
        { observedAt: cutoff - DAY, deltaMinutes: 300, elapsedSeconds: 18000 },
        { observedAt: cutoff + DAY, deltaMinutes: 700, elapsedSeconds: 42000 },
      ],
    });
    const axis = judgeTbti(inputOf([d14, makeFacts('a'), makeFacts('b')])).axes[1];
    // v1.1: 첫 스냅샷이 W 밖이면 deltas 무관 전액 미확정 → d14 확정 0, 증거 없음 버킷.
    const row = axis.evidence.find((entry) => entry.key.externalId === 'd14');
    expect(row?.reasonKey).toBe('tbti.reason.nh.no_evidence');
    // N_min = (600 + 600 + 0) / 2000 = 60 → N.
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(60, 12);
  });

  it('F-05: isBaseline=false 신작도 첫 스냅샷이 W 안이면 전액 확정(기준선 여부 무관)', () => {
    const release = dayOf(2024);
    const cutoff = cutoffOf(release);
    const fresh = makeFacts('fresh', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: release + DAY, lastObservedAt: release + 2 * DAY, gapDays: [], isBaseline: false },
      snapshots: [
        {
          observedAt: release + DAY,
          observedDay: '2024-01-02',
          totalMinutes: 100,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [],
    });
    const axis = judgeTbti(inputOf([fresh, makeFacts('a'), makeFacts('b')])).axes[1];
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
    expect(axis.evidence.find((row) => row.key.externalId === 'fresh')?.reasonKey).toBe(
      'tbti.reason.nh.confirmed_snapshot',
    );
  });

  it('F-43: lastPlayed 0은 NULL 취급 — ③ 증거에서 확정되지 않는다', () => {
    const release = dayOf(2024);
    const zero = makeFacts('zero', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: 0,
      wishlist: [],
    });
    const axis = judgeTbti(inputOf([zero, makeFacts('a'), makeFacts('b')])).axes[1];
    // 0을 W 안으로 보면 lastplayed 확정이 되지만, NULL 취급이면 증거 없음이다.
    expect(axis.evidence.find((row) => row.key.externalId === 'zero')?.reasonKey).toBe(
      'tbti.reason.nh.no_evidence',
    );
  });

  it('D-14형 late 변형: W 이후 첫 스냅샷 + min unlocked_at > W → late', () => {
    const release = dayOf(2020);
    const cutoff = cutoffOf(release);
    const firstObserved = cutoff + DAY;
    const d14late = makeFacts('d14late', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [{ apiname: 'a', achieved: true, unlockedAt: cutoff + 100 }],
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: firstObserved, lastObservedAt: firstObserved + DAY, gapDays: [], isBaseline: true },
      snapshots: [
        {
          observedAt: firstObserved,
          observedDay: '2021-01-02',
          totalMinutes: 500,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [],
    });
    const axis = judgeTbti(inputOf([d14late, makeFacts('a'), makeFacts('b')])).axes[1];
    expect(axis.evidence.find((row) => row.key.externalId === 'd14late')?.reasonKey).toBe(
      'tbti.reason.nh.late',
    );
  });

  it('경계: 첫 스냅샷 observedAt == 출시+W 정확히 → 전액 확정', () => {
    const release = dayOf(2024);
    const cutoff = cutoffOf(release);
    const game = makeFacts('edge', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: cutoff, lastObservedAt: cutoff + DAY, gapDays: [], isBaseline: true },
      snapshots: [
        {
          observedAt: cutoff,
          observedDay: '2025-01-01',
          totalMinutes: 400,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [{ observedAt: cutoff, deltaMinutes: 200, elapsedSeconds: 12000 }],
    });
    const axis = judgeTbti(inputOf([game, makeFacts('a'), makeFacts('b')])).axes[1];
    expect(axis.primary).toBe('N');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
    expect(axis.evidence.find((row) => row.key.externalId === 'edge')?.reasonKey).toBe(
      'tbti.reason.nh.confirmed_snapshot',
    );
  });

  it('확정 경로별 reasonKey 4키: snapshot·unlock·lastplayed·wishlist (신뢰도 순서)', () => {
    const release = dayOf(2024);
    const cutoff = cutoffOf(release);
    const preWish = [
      {
        dateAdded: release - 10 * DAY,
        firstObservedAt: release - 10 * DAY,
        priority: null,
        observedAt: null,
        ended: false,
        syncRunId: null,
      },
    ];
    const snapshotGame = makeFacts('s-snap', {
      releaseDate: release,
      confirmedMinutes: 600,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: [],
      coverage: { firstObservedAt: release + DAY, lastObservedAt: release + 2 * DAY, gapDays: [], isBaseline: true },
      snapshots: [
        {
          observedAt: release + DAY,
          observedDay: '2024-01-02',
          totalMinutes: 400,
          deltaMinutes: null,
          elapsedSeconds: null,
          isReview: false,
        },
      ],
      deltas: [{ observedAt: cutoff - DAY, deltaMinutes: 200, elapsedSeconds: 12000 }],
    });
    // unlock + lastPlayed + 찜이 겹쳐도 신뢰도 1순위 unlock을 기록한다.
    const unlockGame = makeFacts('u-unlock', {
      releaseDate: release,
      achievements: [{ apiname: 'a', achieved: true, unlockedAt: release + 3600 }],
      lastPlayed: release + 7200,
      wishlist: preWish,
    });
    // lastPlayed + 찜이 겹쳐도 lastplayed를 기록한다.
    const lastGame = makeFacts('l-last', {
      releaseDate: release,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: release + 7200,
      wishlist: preWish,
    });
    const wishGame = makeFacts('w-wish', {
      releaseDate: release,
      achievements: [],
      achievementState: 'not_collected',
      achievementSummary: null,
      lastPlayed: null,
      wishlist: preWish,
    });
    const axis = judgeTbti(inputOf([snapshotGame, unlockGame, lastGame, wishGame])).axes[1];
    const byId = (id: string): string | undefined =>
      axis.evidence.find((row) => row.key.externalId === id)?.reasonKey;
    expect(byId('s-snap')).toBe('tbti.reason.nh.confirmed_snapshot');
    expect(byId('u-unlock')).toBe('tbti.reason.nh.confirmed_unlock');
    expect(byId('l-last')).toBe('tbti.reason.nh.confirmed_lastplayed');
    expect(byId('w-wish')).toBe('tbti.reason.nh.confirmed_wishlist');
  });

  it('late·no_evidence reasonKey는 그대로', () => {
    const release = dayOf(2024);
    const axis = judgeTbti(
      inputOf([lateGame('late1', release), noEvidenceGame('none1', release), makeFacts('c')]),
    ).axes[1];
    const byId = (id: string): string | undefined =>
      axis.evidence.find((row) => row.key.externalId === id)?.reasonKey;
    expect(byId('late1')).toBe('tbti.reason.nh.late');
    expect(byId('none1')).toBe('tbti.reason.nh.no_evidence');
    expect(byId('c')).toBe('tbti.reason.nh.confirmed_unlock');
  });

  it('출시일 미확인 게임 수 = excludedCount · caveat release_unknown', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b'),
      makeFacts('c', { releaseDate: null }),
      makeFacts('d'),
    ];
    const axis = judgeTbti(inputOf(games)).axes[1];
    expect(axis.excludedCount).toBe(1);
    expect(axis.caveats).toContainEqual({ code: 'release_unknown', count: 1 });
  });

  it('출시일 확인 2편 → ? short_sample', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b'),
      makeFacts('c', { releaseDate: null }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[1];
    expect(axis.primary).toBe('?');
    expect(axis.heldReasonKey).toBe('short_sample');
    expect(axis.nInterval).toBeNull();
  });

  it('별칭 묶음 수 = h_alias_file (missing이면 부록 A)', () => {
    const games = [
      makeFacts('a', { name: 'Dark Souls' }),
      makeFacts('b', { name: 'DARK SOULS' }),
      makeFacts('c'),
    ];
    const axis = judgeTbti(inputOf(games, { seriesAliases: MISSING })).axes[1];
    expect(axis.caveats).toContainEqual({ code: 'h_alias_file', count: 1 });
  });
});

describe('r15-core-tbti: ③ O/A', () => {
  const genre = (genreId: string): GameFacts['genres'][number] => ({
    genreId,
    nameEn: genreId,
    nameKo: null,
  });

  it('단일 장르(G=1) → A=0 → O 100', () => {
    const games = [makeFacts('a'), makeFacts('b'), makeFacts('c')];
    const axis = judgeTbti(inputOf(games)).axes[2];
    expect(axis.primary).toBe('O');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
  });

  it('6:1 배정 → O 51대 similar', () => {
    const games = [
      makeFacts('x1', { genres: [genre('X')] }),
      makeFacts('x2', { genres: [genre('X')] }),
      makeFacts('x3', { genres: [genre('X')] }),
      makeFacts('x4', { genres: [genre('X')] }),
      makeFacts('x5', { genres: [genre('X')] }),
      makeFacts('x6', { genres: [genre('X')] }),
      makeFacts('y1', { genres: [genre('Y')] }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[2];
    expect(axis.primary).toBe('O');
    expect(axis.primaryPct).toBeCloseTo(51.02, 1);
    expect(axis.chips).toContain('similar');
  });

  it('장르 확인 2편 → ? short_sample · excludedCount는 미확인 수', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b'),
      makeFacts('c', { genres: [] }),
      makeFacts('d', { genres: [] }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[2];
    expect(axis.primary).toBe('?');
    expect(axis.heldReasonKey).toBe('short_sample');
    expect(axis.excludedCount).toBe(2);
    expect(axis.caveats).toContainEqual({ code: 'genre_unknown', count: 2 });
    // F-30: genre_tag_unknown 방출 제거 — genre_unknown 1코드로만.
    expect(axis.caveats.map((caveat) => caveat.code)).not.toContain('genre_tag_unknown');
  });
});

describe('r15-core-tbti: ④ C/L', () => {
  it('그만둠 경계: 119분+91일 전만 그만둠', () => {
    const quit = makeFacts('q', {
      confirmedMinutes: 119,
      lastPlayed: NOW - 91 * DAY,
      achievementState: 'ready',
      achievementSummary: { achieved: 0, total: 10 },
    });
    const notByMinutes = makeFacts('m', {
      confirmedMinutes: 120,
      lastPlayed: NOW - 91 * DAY,
      achievementState: 'ready',
      achievementSummary: { achieved: 0, total: 10 },
    });
    const notByRecency = makeFacts('r', {
      confirmedMinutes: 119,
      lastPlayed: NOW - 89 * DAY,
      achievementState: 'ready',
      achievementSummary: { achieved: 0, total: 10 },
    });
    const notByNull = makeFacts('n', {
      confirmedMinutes: 119,
      lastPlayed: null,
      achievementState: 'ready',
      achievementSummary: { achieved: 0, total: 10 },
    });
    const full = makeFacts('f', {
      confirmedMinutes: 600,
      achievementState: 'ready',
      achievementSummary: { achieved: 0, total: 10 },
    });
    const withQuit = judgeTbti(inputOf([quit, notByMinutes, notByRecency, notByNull, full])).axes[3];
    const withoutQuit = judgeTbti(
      inputOf([
        { ...quit, lastPlayed: NOW - 89 * DAY },
        notByMinutes,
        notByRecency,
        notByNull,
        full,
      ]),
    ).axes[3];
    // 그만둠 1/5 ↔ 0/5 → (c) 20점 차이 → 종합 20/3점 차이. 점수가 낮아질수록 L pct는 올라간다.
    expect(withQuit.primaryPct as number).toBeCloseTo(
      (withoutQuit.primaryPct as number) + 20 / 3,
      10,
    );
  });

  it('중앙값 CAP 500h: 500h 중앙값이면 (a) 100점', () => {
    const games = ['a', 'b', 'c'].map((id) =>
      makeFacts(id, {
        confirmedMinutes: 30000,
        achievementState: 'ready',
        achievementSummary: { achieved: 10, total: 10 },
      }),
    );
    const axis = judgeTbti(inputOf(games)).axes[3];
    expect(axis.primary).toBe('C');
    expect(axis.primaryPct).toBeCloseTo(100, 12);
  });

  it('업적 미반영이면 (a·c) 평균 + ach_not_reflected + baseline 생략', () => {
    const games = ['a', 'b', 'c'].map((id) =>
      makeFacts(id, { achievementState: 'disabled' }),
    );
    const axis = judgeTbti(inputOf(games)).axes[3];
    expect(axis.chips).toContain('ach_not_reflected');
    expect(axis.chips).not.toContain('ach_partial');
    expect(axis.baselineKey).toBeNull();
    expect(axis.baselineTextKey).toBeNull();
    expect(axis.caveats).toContainEqual({ code: 'ach_not_reflected', count: null });
    expect(axis.achReflected).toBeUndefined();
  });

  it('일부 ready면 ach_partial + achReflected{got, of}', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b'),
      makeFacts('c'),
      makeFacts('d', { achievementState: 'not_collected', achievementSummary: null, achievements: [] }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[3];
    expect(axis.chips).toContain('ach_partial');
    expect(axis.achReflected).toEqual({ got: 3, of: 4 });
    expect(axis.baselineKey).toBe('tbti.baseline.imc2016');
    expect(axis.caveats).toContainEqual({ code: 'ach_partial', count: 3 });
  });

  it('F-39: ready 1편이면 (b) 없이 2재료 평균 + ach_partial + achMean null', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b', { achievementState: 'disabled' }),
      makeFacts('c', { achievementState: 'not_collected', achievementSummary: null, achievements: [] }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[3];
    // target 3편 → 표본 충족. ready 1편 < 2 → (b) 미사용.
    expect(axis.held).toBe(false);
    expect(axis.chips).toContain('ach_partial');
    expect(axis.achReflected).toEqual({ got: 1, of: 3 });
    expect(axis.caveats).toContainEqual({ code: 'ach_partial', count: 1 });
    if (axis.metrics === null || axis.metrics.kind !== 'cl') throw new Error('④ metrics 없음');
    expect(axis.metrics.achMean).toBeNull();
  });

  it('F-27: of는 >0분·achievementState empty 아님만 — 0분·empty는 제외', () => {
    const games = [
      makeFacts('a'),
      makeFacts('b'),
      makeFacts('c', { achievementState: 'empty', achievementSummary: null, achievements: [] }),
      makeFacts('d', { confirmedMinutes: 0, achievementState: 'ready' }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[3];
    // target = a,b,c(d 0분 제외). of = a,b(c empty 제외) = 2, got = 2 → 전부 반영, 칩 없음.
    expect(axis.excludedCount).toBe(1);
    expect(axis.chips).not.toContain('ach_partial');
    expect(axis.chips).not.toContain('ach_not_reflected');
    expect(axis.achReflected).toBeUndefined();
  });

  it('전부 ready면 칩 없음 + baseline 표시', () => {
    const axis = judgeTbti(inputOf([makeFacts('a'), makeFacts('b'), makeFacts('c')])).axes[3];
    expect(axis.chips).not.toContain('ach_not_reflected');
    expect(axis.chips).not.toContain('ach_partial');
    expect(axis.baselineKey).toBe('tbti.baseline.imc2016');
  });

  it('대상 2편·ready 0이면 ? short_sample', () => {
    const games = [
      makeFacts('a', { confirmedMinutes: 600, achievementState: 'not_collected', achievementSummary: null, achievements: [] }),
      makeFacts('b', { confirmedMinutes: 600, achievementState: 'not_collected', achievementSummary: null, achievements: [] }),
      makeFacts('c', { confirmedMinutes: 0 }),
    ];
    const axis = judgeTbti(inputOf(games)).axes[3];
    expect(axis.primary).toBe('?');
    expect(axis.heldReasonKey).toBe('short_sample');
    expect(axis.excludedCount).toBe(1);
  });
});

describe('r15-core-tbti: 합성·결정성', () => {
  function richGames(): GameFacts[] {
    return [
      makeFacts('h1', { name: 'Hollow Knight' }),
      makeFacts('h2', { name: 'Hollow Knight: Silksong' }),
      makeFacts('a'),
      makeFacts('b'),
    ];
  }

  it('숨김은 전 축·결과에서 제외, hidden_excluded 동일값', () => {
    const games = [...richGames(), makeFacts('x', { hidden: true, confirmedMinutes: 99999 })];
    const result = judgeTbti(inputOf(games));
    expect(result.pending).toBe(false);
    expect(result.code).toBe('INOC');
    for (const axis of result.axes) {
      expect(axis.caveats).toContainEqual({ code: 'hidden_excluded', count: 1 });
    }
    expect(result.caveats).toContainEqual({ code: 'hidden_excluded', count: 1 });
    expect(result.caveats).toContainEqual({ code: 'observation_days', count: 0 });
  });

  it('observation_days count = ownedObservedDays.length · 스냅샷 distinct 무시(v1.0.2 델타)', () => {
    // 스냅샷 observedDay 2종이 있어도 ownedObservedDays(3종) 길이를 쓴다.
    const withSnapshots = makeFacts('s', {
      snapshots: [
        { observedAt: NOW, observedDay: '2026-10-01', totalMinutes: 600, deltaMinutes: null, elapsedSeconds: null, isReview: false },
        { observedAt: NOW, observedDay: '2026-10-02', totalMinutes: 600, deltaMinutes: null, elapsedSeconds: null, isReview: false },
      ],
    });
    const result = judgeTbti(
      inputOf([withSnapshots, makeFacts('a'), makeFacts('b')], {
        ownedObservedDays: ['2026-10-01', '2026-10-02', '2026-10-03'],
      }),
    );
    expect(result.caveats).toContainEqual({ code: 'observation_days', count: 3 });
    // 공통 4종만 — 리캡 섹션 01~06 코드 없음.
    expect(result.caveats.map((caveat) => caveat.code)).toEqual([
      'observation_days',
      'hidden_excluded',
      'outside_steam_missing',
      'server_record_basis',
    ]);
  });

  it('code는 4축 primary 연결', () => {
    const result = judgeTbti(inputOf(richGames()));
    expect(result.code).toBe(result.axes.map((axis) => axis.primary).join(''));
    expect(result.code).toBe('INOC');
  });

  it('같은 입력은 같은 출력이다', () => {
    expect(judgeTbti(inputOf(richGames()))).toEqual(judgeTbti(inputOf(richGames())));
  });

  it('② evidence 동률은 key 오름차순', () => {
    const axis = judgeTbti(inputOf(richGames())).axes[1];
    expect(axis.evidence.map((row) => row.key.externalId)).toEqual(['a', 'b', 'h1', 'h2']);
  });

  it('v1.1: metrics 4축 원값', () => {
    const result = judgeTbti(inputOf(richGames()));
    const [a1, a2, a3, a4] = result.axes;
    expect(a1.metrics).toEqual({ kind: 'ir', iGames: 4, rGames: 0, judgedGames: 4 });
    expect(a2.metrics).toEqual({
      kind: 'nh',
      bundles: [{ id: 'core:hollow knight', games: 2, minutes: 1200 }],
      nMin: 100,
      nMax: 100,
    });
    expect(a3.metrics).toEqual({ kind: 'oa', hhi: 1, g: 1 });
    expect(a4.metrics).toEqual({ kind: 'cl', medianHours: 10, achMean: 80, quitCount: 0, quitDenom: 4 });
  });

  it('v1.1: gameLetters 근거행 귀속(제안 규칙) + aliasStatus 입력 그대로', () => {
    const result = judgeTbti(inputOf(richGames()));
    expect(result.aliasStatus).toBe('broken');
    expect(result.gameLetters.map((row) => row.key.externalId)).toEqual(['a', 'b', 'h1', 'h2']);
    // ① 태그 I · ② 확정 N · ③④ 귀속 규칙 미정이라 null(PM 확정).
    for (const row of result.gameLetters) {
      expect(row.letters).toEqual(['I', 'N', null, null]);
    }
    expect(judgeTbti(inputOf(richGames(), { seriesAliases: MISSING })).aliasStatus).toBe('missing');
  });
});
