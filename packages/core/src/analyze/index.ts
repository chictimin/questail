/**
 * 취향 분석 리포트 — export 지점 스텁 (Phase 0).
 * 실제 구현은 Phase 3 W-anal 담당.
 *
 * 선형 파이프라인, 그래프 없음. 정량 리포트가 먼저 서고 LLM 정성 해석을
 * 그 위에 얹는다(D3 폴백 경계) — LLM 불가 시에도 summary 없이 stats만으로 완결돼야 한다.
 */

import type { LlmOptions, TasteProfile } from '../types.js';

export interface AnalysisReport {
  /** LLM 정성 해석 — 무LLM 폴백 시 undefined (빈 문자열 아님) */
  summary?: string;
  /** 정량 지표 — LLM 유무와 무관하게 항상 채워짐 */
  stats: Record<string, unknown>;
}

export async function analyzeLibrary(profile: TasteProfile, options?: LlmOptions): Promise<AnalysisReport> {
  throw new Error('not implemented — W-anal (Phase 3)');
}
