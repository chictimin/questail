/** U3a statusMap 단위 9건 — 상태별 픽스처 → pill·본문·재수집 자리. E2E는 U3b. */
import { describe, expect, it } from 'vitest';
import { appAlertFor, rowDisplay } from '../../src/ui/sync/statusMap.js';

describe('rowDisplay', () => {
  it('a 수집 중 → run pill + 진행 막대', () => {
    expect(rowDisplay('info', { code: null, running: true })).toEqual({
      pill: 'run',
      body: { kind: 'progress' },
      retry: false,
    });
  });

  it('b 보유 실패(코드 없음) → fail pill + 보유 원인 + 재수집', () => {
    expect(rowDisplay('owned', { code: null, failed: true })).toEqual({
      pill: 'fail',
      body: { kind: 'cause', key: 'sync.causeOwned' },
      retry: true,
    });
  });

  it('c HELD_ZERO → hold pill + 0건 원인 + 재수집', () => {
    expect(
      rowDisplay('owned', { code: 'HELD_ZERO', params: { prev: '1,284' } }),
    ).toEqual({
      pill: 'hold',
      body: { kind: 'cause', key: 'sync.causeHeldZero', params: { prev: '1,284' } },
      retry: true,
    });
  });

  it('d HELD_TIME_ZERO → hold pill + 플레이타임 원인 + 재수집', () => {
    expect(rowDisplay('owned', { code: 'HELD_TIME_ZERO', params: { n: 3 } })).toEqual({
      pill: 'hold',
      body: { kind: 'cause', key: 'sync.causeHeldTime', params: { n: 3 } },
      retry: true,
    });
  });

  it('e 찜 실패(코드 없음) → fail pill + 찜 원인 + 재수집', () => {
    expect(rowDisplay('wish', { code: null, failed: true })).toEqual({
      pill: 'fail',
      body: { kind: 'cause', key: 'sync.causeWish' },
      retry: true,
    });
  });

  it('f 문구 키 sync.causeInfoPart는 {n} 치환', async () => {
    const { t } = await import('../../src/ui/i18n/index.js');
    expect(t('ko', 'sync.causeInfoPart', { n: 37 })).toContain('37개');
    expect(t('en', 'sync.causeInfoPart', { n: 37 })).toContain('37 games');
  });

  it('g ACCESS_PRIVATE → fail pill + 업적 원인 + 재수집', () => {
    expect(rowDisplay('ach', { code: 'ACCESS_PRIVATE' })).toEqual({
      pill: 'fail',
      body: { kind: 'cause', key: 'sync.causeAch' },
      retry: true,
    });
  });

  it('h AUTH_INVALID_KEY → 전행 fail + 상단 Alert(행 원인 없음)', () => {
    expect(rowDisplay('owned', { code: 'AUTH_INVALID_KEY' })).toEqual({
      pill: 'fail',
      body: { kind: 'none' },
      retry: false,
    });
    expect(appAlertFor('AUTH_INVALID_KEY')).toBe('sync.alertKey');
    expect(appAlertFor(null)).toBe(null);
  });

  it('i RATE_LIMITED → hold pill + 429 원인 + 재수집', () => {
    expect(rowDisplay('info', { code: 'RATE_LIMITED' })).toEqual({
      pill: 'hold',
      body: { kind: 'cause', key: 'sync.causeLimited' },
      retry: true,
    });
  });
});
