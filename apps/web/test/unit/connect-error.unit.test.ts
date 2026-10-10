import { describe, expect, it } from 'vitest';
import { resolveConnectError } from '../../src/ui/routes/connect.js';

/**
 * U1 fixed_id 분기 단위 테스트. UI로는 도달 불가(편집 잠금)라 순수 함수로 확인한다.
 * 서버 동작은 connect.unit.test.ts 고정 ID 케이스가, d_body 문구 값은 i18n parity가 본다.
 */
describe('resolveConnectError', () => {
  it('fixed_id → connect.fixedIdError (steamId 자리)', () => {
    expect(resolveConnectError('AUTH_ID_MISMATCH', 'fixed_id')).toEqual({
      field: 'steamId',
      key: 'connect.fixedIdError',
    });
  });

  it('not_found·reason 없음 → error.AUTH_ID_MISMATCH', () => {
    expect(resolveConnectError('AUTH_ID_MISMATCH', 'not_found')).toEqual({
      field: 'steamId',
      key: 'error.AUTH_ID_MISMATCH',
    });
    expect(resolveConnectError('AUTH_ID_MISMATCH', null)).toEqual({
      field: 'steamId',
      key: 'error.AUTH_ID_MISMATCH',
    });
  });

  it('그 외 코드는 기존 자리 그대로', () => {
    expect(resolveConnectError('AUTH_INVALID_KEY', null)).toEqual({
      field: 'key',
      key: 'error.AUTH_INVALID_KEY',
    });
    expect(resolveConnectError('KEY_STORE_FAILED', null)).toEqual({
      field: 'steamId',
      key: 'error.KEY_STORE_FAILED',
    });
    expect(resolveConnectError('RATE_LIMITED', null)).toEqual({
      field: 'notice',
      key: 'error.RATE_LIMITED',
    });
  });

  it('KEY_STORE_FAILED reason 분기 → attach·shutdown은 notice, dir_conflict는 steamId 자리', () => {
    expect(resolveConnectError('KEY_STORE_FAILED', 'attach')).toMatchObject({ field: 'notice' });
    expect(resolveConnectError('KEY_STORE_FAILED', 'shutdown')).toMatchObject({ field: 'notice' });
    expect(resolveConnectError('KEY_STORE_FAILED', 'dir_conflict')).toMatchObject({
      field: 'steamId',
    });
  });
});
