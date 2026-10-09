/**
 * W5-UI SteamID 입력 파싱 — 순수 함수. 숫자·/profiles/<숫자>는 추출,
 * /id/ 커스텀은 차단(P-7 전 요청 없음), 그 외는 원문 그대로 서버 판정에 맡긴다.
 * 문자열 구분자 없이 불리언 형태로 답한다(UI 하드코딩 스캔 대응).
 */
export type ParsedSteamId =
  | { blocked: true; steamId: string; vanity: string | null }
  | { blocked: false; steamId: string; vanity: null };

/**
 * /id/ 형태에서 vanity 단일 이름 추출(P-7 연결용).
 * trim 외 변형 금지(소문자화·URL 디코딩 없음). 빈 값이면 null(화면에서 거부).
 */
export function extractVanityName(input: string): string | null {
  const match = input.match(/\/id\/([^/?#]+)/);
  if (match?.[1] === undefined) {
    return null;
  }
  const name = match[1].trim();
  return name === '' ? null : name;
}

export function parseSteamIdInput(input: string): ParsedSteamId {
  const trimmed = input.trim();
  if (/^\d+$/.test(trimmed)) {
    return { blocked: false, steamId: trimmed, vanity: null };
  }
  const profiles = trimmed.match(/\/profiles\/(\d+)/);
  if (profiles?.[1] !== undefined) {
    return { blocked: false, steamId: profiles[1], vanity: null };
  }
  if (/\/id\//.test(trimmed)) {
    return { blocked: true, steamId: '', vanity: extractVanityName(trimmed) };
  }
  return { blocked: false, steamId: trimmed, vanity: null };
}
