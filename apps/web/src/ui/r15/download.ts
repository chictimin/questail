/**
 * R1.5 공용 텍스트 파일 내려받기 — 리캡 Markdown 내보내기·공유 시트가 쓴다.
 * MIME 리터럴 1개는 i18n 검사 예외 목록에 둔다(화면 미노출).
 */
export function downloadTextFile(
  filename: string,
  content: string,
  mime: string,
): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** Markdown 내려받기 MIME. */
export const MARKDOWN_MIME = 'text/markdown';
