import { describe, expect, it } from 'vitest';
import { judgeAchievementsResponse } from '@questail/core';

/**
 * U2 #13A judgeAchievementsResponse 400·200 판정 테스트. 합성 본문만 쓴다. 실호출 없음.
 * 캡처 실응답(10-10, appid 1049590): {"playerstats":{"error":"Requested app has no stats","success":false}} HTTP 400.
 */
const APPID = 1049590;
const CAPTURE = { playerstats: { error: 'Requested app has no stats', success: false } };

describe('judgeAchievementsResponse 400', () => {
  it('캡처 본문 그대로 → skipGame', () => {
    expect(judgeAchievementsResponse(400, CAPTURE, APPID)).toEqual({ kind: 'skipGame' });
  });

  it('대소문자·앞뒤 공백·연속 공백 변형 → skipGame', () => {
    expect(
      judgeAchievementsResponse(
        400,
        { playerstats: { error: '  REQUESTED   App\tHas\nNo  Stats  ', success: false } },
        APPID,
      ),
    ).toEqual({ kind: 'skipGame' });
  });

  it('success:false + 다른 error 문자열 → failSource NETWORK appid', () => {
    expect(
      judgeAchievementsResponse(
        400,
        { playerstats: { error: 'Invalid request', success: false } },
        APPID,
      ),
    ).toEqual({ kind: 'failSource', code: 'NETWORK', params: { appid: APPID, status: 400 } });
  });

  it('body null → failSource NETWORK appid', () => {
    expect(judgeAchievementsResponse(400, null, APPID)).toEqual({
      kind: 'failSource',
      code: 'NETWORK',
      params: { appid: APPID, status: 400 },
    });
  });

  it('playerstats 부재 → failSource NETWORK appid', () => {
    expect(judgeAchievementsResponse(400, {}, APPID)).toEqual({
      kind: 'failSource',
      code: 'NETWORK',
      params: { appid: APPID, status: 400 },
    });
    expect(judgeAchievementsResponse(400, { playerstats: { success: false } }, APPID)).toEqual({
      kind: 'failSource',
      code: 'NETWORK',
      params: { appid: APPID, status: 400 },
    });
  });
});

describe('judgeAchievementsResponse 200·기존 코드', () => {
  it('200 achievements 빈 배열 → skipGame', () => {
    expect(
      judgeAchievementsResponse(200, { playerstats: { success: true, achievements: [] } }, APPID),
    ).toEqual({ kind: 'skipGame' });
  });

  it('403·429 기존 유지', () => {
    expect(judgeAchievementsResponse(403, {}, APPID)).toEqual({
      kind: 'failSource',
      code: 'ACCESS_PRIVATE',
      params: { appid: APPID, status: 403 },
    });
    expect(judgeAchievementsResponse(429, {}, APPID)).toEqual({
      kind: 'failSource',
      code: 'RATE_LIMITED',
      params: { appid: APPID, status: 429 },
    });
  });
});
