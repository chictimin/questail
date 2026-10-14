/**
 * 한국어 조사 선택 — 끝 글자 받침 기준. 화면 해석 템플릿과 서버 텍스트 렌더가 함께 쓴다.
 * 끝 글자가 한글이 아니면(영문·숫자) 받침 없음으로 본다("RPG가" — 알피지).
 * node·DOM import 0.
 */
function hasBatchim(word: string): boolean {
  const last = word.charCodeAt(word.length - 1);
  return last >= 0xac00 && last <= 0xd7a3 && (last - 0xac00) % 28 !== 0;
}

/** 주격 이/가. */
export function josaIGa(word: string): string {
  return hasBatchim(word) ? '이' : '가';
}

/** 접속 과/와. */
export function josaGwaWa(word: string): string {
  return hasBatchim(word) ? '과' : '와';
}
