/**
 * R1.5 텍스트 렌더 3종 읽기 — 화면은 텍스트를 직접 만들지 않고 서버 렌더를 쓴다(계약 R15-9, F-12).
 * locale은 화면 locale을 쿼리로 넘긴다. 실패는 throw(호출 측이 상태로 둔다).
 * 서버 라우트 상수는 server/app.ts가 정본이다(UI는 서버 모듈을 import하지 않는다).
 */
import type { Locale } from '../i18n/index.js';
import { getJson } from './api.js';

const RECAP_TEXT = '/api/recap/library/text';
const TBTI_SHARE_TEXT = '/api/tbti/share-text';

export interface TextFile {
  text: string;
  filename: string;
}

function textOf(body: unknown): string {
  const text = (body as { text?: unknown }).text;
  if (typeof text !== 'string') {
    throw new Error(`[web] text 응답 형식 오류: ${typeof text}`);
  }
  return text;
}

/** 리캡 복사 텍스트(A-8 + 장르 줄 + TBTI 줄). */
export async function fetchRecapText(locale: Locale): Promise<string> {
  return textOf(await getJson(`${RECAP_TEXT}?locale=${locale}`));
}

/** Markdown 내보내기 recap.md 1종(frontmatter 포함). */
export async function fetchRecapMarkdown(locale: Locale): Promise<TextFile> {
  const body = await getJson(`${RECAP_TEXT}?locale=${locale}&format=markdown`);
  const filename = (body as { filename?: unknown }).filename;
  if (typeof filename !== 'string') {
    throw new Error(`[web] filename 응답 형식 오류: ${typeof filename}`);
  }
  return { text: textOf(body), filename };
}

/** TBTI 공유 텍스트(10a 미리보기 = 복사 텍스트). */
export async function fetchTbtiShareText(locale: Locale): Promise<string> {
  return textOf(await getJson(`${TBTI_SHARE_TEXT}?locale=${locale}`));
}
