import { describe, expect, it } from 'vitest';
import { rootRedirect } from '../../src/ui/rootRedirect.js';

describe('rootRedirect', () => {
  it('연동됨 "/" → /library, replace', () => {
    expect(rootRedirect('/', true)).toEqual({ to: '/library', replace: true });
  });
  it('미연동 "/" → /connect, replace', () => {
    expect(rootRedirect('/', false)).toEqual({ to: '/connect', replace: true });
  });
  it('상태 미확인(null)이면 이동하지 않는다', () => {
    expect(rootRedirect('/', null)).toBeNull();
  });
  it('"/"가 아닌 경로는 건드리지 않는다', () => {
    expect(rootRedirect('/library', true)).toBeNull();
    expect(rootRedirect('/connect', false)).toBeNull();
  });
});
