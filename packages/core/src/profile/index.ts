/**
 * 취향 프로필 — export 지점 스텁 (Phase 0).
 * 실제 구현(postie personalize.ts 일반화)은 Phase 2 W-prof 담당.
 * Phase 1의 메타(W-steam)·인덱스(W-store) 산출물에 의존하므로 병렬 불가.
 *
 * analyze(M2 리포트)와 postie(뉴스레터)가 이 프로필을 공유 입력으로 쓴다.
 */

import type { LibraryIndex, TasteProfile } from '../types.js';

export function buildTasteProfile(library: LibraryIndex): TasteProfile {
  throw new Error('not implemented — W-prof (Phase 2)');
}
