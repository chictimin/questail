/**
 * 공유 타입 계약 — M2 Phase 0에서 고정.
 *
 * 워커는 이 파일을 수정하지 않는다. 계약 변경이 필요하면 오케스트레이터에게 먼저 알린다.
 * 근거: obsidian vault ai/sessions/2026-09-16-1146-handoff.md
 */

// ─── 게임 원장 (객관 데이터) ─────────────────────────────────

export type GameSource = 'auto' | 'manual';
export type Platform = 'steam' | 'psn' | 'xbox' | 'manual';

export interface NormalizedGame {
  /** 플랫폼 내 식별자 (e.g. Steam appId) */
  id: string;
  /** 플랫폼 식별자 */
  platform: Platform;
  /** 게임 제목 */
  title: string;
  /** 데이터 출처 */
  source: GameSource;
  /** 총 플레이타임 (분) */
  playtimeMinutes: number;
  /** 업적 달성률 (0–100) */
  achievementPercent?: number;
  /** 마지막 플레이 일시 (Unix timestamp) */
  lastPlayedAt?: number;
  /** 게임 커버 이미지 URL */
  imageUrl?: string;
  /** 장르 태그 목록 */
  genres?: string[];
  /** 개발사 (D5: appdetails 승격) */
  developers?: string[];
  /** 퍼블리셔 (D5: appdetails 승격) */
  publishers?: string[];
  /** 출시일 (D5: appdetails 승격, 문자열 그대로 보존) */
  releaseDate?: string;
  /** 위시리스트 여부 (postie IWishlistService 승격) */
  wishlisted?: boolean;
}

/** appdetails 등 메타 소스에서 가져오는 원본 보강 데이터 (D5) */
export interface GameMeta {
  appId: string;
  genres?: string[];
  developers?: string[];
  publishers?: string[];
  releaseDate?: string;
  headerImage?: string;
  keywords?: string[];
}

/**
 * games/*.md 노트에만 존재하는 주관 필드 (D1 필드 단위 보존 규칙).
 * library.md(객관 정본)에는 실리지 않는다.
 */
export interface SubjectiveGameFields {
  /** 0.5 단위 5점(10단계). 수기 전용, 입력은 M3 웹 UI 책임 */
  rating?: number;
  /** 한줄평 */
  note?: string;
  /** 기피 사유 */
  dislikeReasons?: string[];
  status?: 'playing' | 'completed' | 'dropped' | 'wishlist';
}

/** library.md 1개 — 객관 데이터 정본 (D1) */
export interface LibraryIndex {
  generatedAt: number;
  games: NormalizedGame[];
}

/** history.jsonl 한 줄 — 스냅샷 로그 (D1-a, 정본 아님·재생성 불가) */
export interface HistoryRecord {
  ts: number;
  gameId: string;
  platform: Platform;
  playtimeMinutes: number;
}

// ─── 취향 프로필 (profile/) ─────────────────────────────────

/** 라이브러리·위시·플레이타임 → 취향 프로필. analyze와 postie의 공유 입력 */
export interface TasteProfile {
  topGenres: { genre: string; weight: number }[];
  dislikedGenres?: string[];
  playtimeDistribution: { min: number; q1: number; median: number; q3: number; max: number };
  wishlistAppIds?: string[];
  /** 플레이타임(간접 신호)과 별점(직접 신호)의 갭 — 강렬했던 게임 / 습관적으로 붙잡은 게임 판별 */
  ratingPlaytimeGaps?: { gameId: string; gap: number }[];
}

// ─── LLM (D3: 단일 엔드포인트 + 무LLM 폴백) ─────────────────

export interface LlmOptions {
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeoutMs?: number;
}
