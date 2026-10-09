/**
 * W4 키 0노출 — 치환 전담. 판정·치환 모두 knownSecrets 기준으로 자체 수행한다.
 * apps/web/src/data/connection.ts는 import하지 않는다
 * (키 경로 ctx를 웹 redact가 만들면 안 됨 — fome 승인 보정 ①).
 * 키 string을 반환하지 않는다. 치환 결과만 낸다.
 */

/** 원문 대신 싣는 표식. hostCheck 거부 params도 이 값을 쓴다. */
export const REDACTED = '[redacted]';

/** 제품 검사 정책 32hex — 공식 규격이 아니라 관행+조기 탈락용(P-3). 경계 없이 치환한다(URL 쿼리·인접값 포함). */
const HEX32_PATTERN = /[0-9a-fA-F]{32}/g;

function replaceAll(haystack: string, needle: string): string {
  if (needle === '') {
    return haystack;
  }
  return haystack.split(needle).join(REDACTED);
}

/**
 * 치환 — knownSecrets의 정확값·trim형·URL 인코딩형 + 32hex 패턴을 전부 표식으로 바꾼다.
 * knownSecrets 미지정 시 32hex 패턴만 치환한다.
 */
export function scrubText(text: string, knownSecrets: readonly string[] = []): string {
  let out = text;
  for (const secret of knownSecrets) {
    out = replaceAll(out, secret);
    const trimmed = secret.trim();
    out = replaceAll(out, trimmed);
    out = replaceAll(out, encodeURIComponent(trimmed));
  }
  out = out.replace(HEX32_PATTERN, REDACTED);
  return out;
}
