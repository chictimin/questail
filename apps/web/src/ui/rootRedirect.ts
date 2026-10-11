/**
 * 루트 "/" 진입 분기 — 연동됨 → /library, 미연동 → /connect.
 * replace로 보내 히스토리에 "/"를 남기지 않는다. 연동 상태 미확인(null)이면 null(대기·fail-open).
 */
export function rootRedirect(
  path: string,
  connected: boolean | null,
): { to: '/library' | '/connect'; replace: true } | null {
  if (path !== '/' || connected === null) {
    return null;
  }
  return { to: connected ? '/library' : '/connect', replace: true };
}
