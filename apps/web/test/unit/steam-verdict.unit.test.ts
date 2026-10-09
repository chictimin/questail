import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  judgeAchievementsResponse,
  judgeOwnedResponse,
  judgeWishlistResponse,
  normalizeOwnedGames,
  normalizePlayerAchievements,
  steamErrorToIssue,
} from '@questail/core';

/**
 * D-03 응답 판정·정규화 테스트. 계획 D-03 명시 응답 사례 + S7 합성 픽스처.
 * core 소스 직접 import(리드 #62564). 판정·정규화만 다루고 차분·DB는 범위 밖.
 */
const STEAM = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'steam');

function load(name: string): unknown {
  return JSON.parse(readFileSync(join(STEAM, name), 'utf8'));
}

describe('judgeOwnedResponse (COL-2)', () => {
  it('정상 응답은 확정한다', () => {
    expect(judgeOwnedResponse(load('owned-normal.json'), 3)).toEqual({ kind: 'ok' });
  });

  it('game_count 키 부재는 실패한다', () => {
    expect(judgeOwnedResponse(load('owned-missing-count.json'), 3)).toEqual({
      kind: 'failed',
      code: 'PAYLOAD_CORRUPT',
      params: { prevCount: 3 },
    });
  });

  it('game_count 비정수는 실패한다', () => {
    expect(judgeOwnedResponse({ response: { game_count: '3' } }, 3).kind).toBe('failed');
  });

  it('직전 0의 정상 0건은 유효 0으로 확정한다', () => {
    expect(judgeOwnedResponse(load('owned-zero-first.json'), 0)).toEqual({ kind: 'ok' });
  });

  it('직전 N>0의 0건은 급감 보류한다', () => {
    expect(judgeOwnedResponse(load('owned-zero-drop.json'), 3)).toEqual({
      kind: 'held',
      code: 'HELD_ZERO',
      params: { prevCount: 3 },
    });
  });

  it('game_count와 games 건수 불일치는 실패한다', () => {
    expect(
      judgeOwnedResponse({ response: { game_count: 3, games: [{ appid: 1 }] } }, 3),
    ).toEqual({
      kind: 'failed',
      code: 'PAYLOAD_CORRUPT',
      params: { prevCount: 3, count: 3, gamesLength: 1 },
    });
  });

  it('건수 >0인데 games가 없으면 실패한다', () => {
    expect(judgeOwnedResponse({ response: { game_count: 2 } }, 1).kind).toBe('failed');
  });

  it('중복 appid는 손상으로 실패한다', () => {
    expect(
      judgeOwnedResponse(
        { response: { game_count: 2, games: [{ appid: 5 }, { appid: 5 }] } },
        1,
      ),
    ).toEqual({
      kind: 'failed',
      code: 'PAYLOAD_CORRUPT',
      params: { prevCount: 1, count: 2 },
    });
  });
});

describe('normalizeOwnedGames', () => {
  it('시간 3종을 그대로 통과시킨다', () => {
    const rows = normalizeOwnedGames(load('owned-normal.json'));
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual({
      appid: 990011,
      playtimeForever: 9000,
      lastPlayed: 1728000000,
      playtime2weeks: 320,
    });
  });

  it('전건 0 응답은 0 행을 낸다', () => {
    const rows = normalizeOwnedGames(load('owned-time-zero.json'));
    expect(rows).toHaveLength(3);
    expect(rows.every((row) => row.playtimeForever === 0)).toBe(true);
  });

  it('appid 비정수 행은 건너뛰고 중복은 첫 행만 둔다', () => {
    const rows = normalizeOwnedGames({
      response: {
        game_count: 3,
        games: [{ appid: 'x' }, { appid: 5, playtime_forever: 7 }, { appid: 5, playtime_forever: 9 }],
      },
    });
    expect(rows).toEqual([
      { appid: 5, playtimeForever: 7, lastPlayed: null, playtime2weeks: null },
    ]);
  });
});

describe('judgeWishlistResponse', () => {
  it('items 키 부재는 실패한다', () => {
    expect(judgeWishlistResponse({ response: {} }).kind).toBe('failed');
  });

  it('빈 배열은 유효 0건으로 확정한다', () => {
    expect(judgeWishlistResponse({ response: { items: [] } })).toEqual({ kind: 'ok', items: [] });
  });

  it('date_added·priority를 보존하고 값 없음은 null이다', () => {
    expect(
      judgeWishlistResponse({
        response: {
          items: [
            { appid: 10, date_added: 1700000000, priority: 1 },
            { appid: 20 },
            { appid: 'x' },
          ],
        },
      }),
    ).toEqual({
      kind: 'ok',
      items: [
        { appid: 10, dateAdded: 1700000000, priority: 1 },
        { appid: 20, dateAdded: null, priority: null },
      ],
    });
  });

  it('중복 appid는 손상으로 실패한다', () => {
    expect(
      judgeWishlistResponse({
        response: { items: [{ appid: 10, priority: 1 }, { appid: 10, priority: 2 }] },
      }).kind,
    ).toBe('failed');
  });
});

describe('achievements', () => {
  it('403은 계정 단위 실패로 분리한다', () => {
    expect(judgeAchievementsResponse(403, {}, 990011)).toEqual({
      kind: 'failSource',
      code: 'ACCESS_PRIVATE',
      params: { appid: 990011, status: 403 },
    });
  });

  it('success 거짓·업적 없음은 게임 단위 건너뜀이다', () => {
    expect(judgeAchievementsResponse(200, { playerstats: { success: false } }, 1).kind).toBe(
      'skipGame',
    );
    expect(judgeAchievementsResponse(200, { playerstats: { success: true } }, 1).kind).toBe(
      'skipGame',
    );
  });

  it('apiname을 보존하고 미달성을 포함한다', () => {
    expect(
      normalizePlayerAchievements({
        playerstats: {
          success: true,
          achievements: [
            { apiname: 'WIN_ONE', achieved: 1, unlocktime: 1700000000 },
            { apiname: 'WIN_TWO', achieved: 0, unlocktime: 0 },
            { apiname: 7 },
          ],
        },
      }),
    ).toEqual([
      { apiname: 'WIN_ONE', achieved: true, unlockedAt: 1700000000 },
      { apiname: 'WIN_TWO', achieved: false, unlockedAt: null },
    ]);
  });
});

describe('steamErrorToIssue', () => {
  it('상태를 코드로 매핑하고 문장을 내지 않는다', () => {
    const mk = (status: number) =>
      steamErrorToIssue(Object.assign(new Error('x'), { status }), 'GetOwnedGames');
    expect(mk(401).code).toBe('AUTH_INVALID_KEY');
    expect(mk(403).code).toBe('ACCESS_PRIVATE');
    expect(mk(429).code).toBe('RATE_LIMITED');
    expect(mk(500).code).toBe('NETWORK');
    for (const code of [mk(401), mk(403), mk(429), mk(500)]) {
      expect(JSON.stringify(code)).not.toMatch(/[가-힣]/);
    }
  });
});
