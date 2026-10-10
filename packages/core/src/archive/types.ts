/**
 * 읽기 계약 타입 (D-12, A 소유. 계약서 C-4·C-9·F-5·F-6).
 *
 * GameFacts 정본. 웹 data/library.ts의 조립이 이 모양을 낸다.
 * recap·TBTI(R1.5) 입력은 GameFacts[]만 쓴다.
 */
import type { CollectSource, GameKey, SourceStatus, SyncErrorCode } from '../types.js';

/** C-4 GameFacts 후속 port 원천. 필요한 분까지만 둔다. */
export interface GameFacts {
  key: GameKey;
  name: string | null;
  titleKo: string | null;
  developerRaw: string | null;
  releaseDate: number | null;
  releaseDateText: string | null;
  genres: { genreId: string; nameEn: string | null; nameKo: string | null }[];
  coverUrl: string | null;
  hidden: boolean;
  libraryAddedAt: number | null;
  confirmedMinutes: number;
  lastPlayed: number | null;
  snapshots: {
    observedAt: number;
    observedDay: string;
    totalMinutes: number;
    deltaMinutes: number | null;
    elapsedSeconds: number | null;
    isReview: boolean;
  }[];
  deltas: { observedAt: number; deltaMinutes: number; elapsedSeconds: number }[];
  coverage: {
    firstObservedAt: number | null;
    lastObservedAt: number | null;
    gapDays: string[];
    isBaseline: boolean;
  };
  ownership: {
    origin: 'observed' | 'baseline' | 'imported';
    startedAt: number | null;
    ended: boolean;
    endedAt: number | null;
    isBaseline: boolean;
    syncRunId: number | null;
  }[];
  wishlist: {
    dateAdded: number | null;
    firstObservedAt: number;
    priority: number | null;
    observedAt: number | null;
    ended: boolean;
    syncRunId: number | null;
  }[];
  tags: { tag: string; votes: number; rank: number }[];
  tagStatus: 'ready' | 'empty' | 'failed' | 'not_collected';
  achievements: { apiname: string; achieved: boolean; unlockedAt: number | null }[];
  achievementState: 'disabled' | 'failed' | 'not_collected' | 'empty' | 'ready';
  achievementSummary: { achieved: number; total: number } | null;
  latestScore: number | null;
  ratingEvents: { id: number; before: number | null; after: number | null; at: number }[];
  syncRunRefs: number[];
}

export interface ReviewObservation {
  id: number;
  key: GameKey;
  observedAt: number;
  kind: 'negative_clamped' | 'spike';
  deltaMinutes: number;
  elapsedSeconds: number;
  prevObservedAt: number | null;
  syncRunId: number | null;
}

export interface SyncRun {
  id: number;
  source: CollectSource;
  status: SourceStatus;
  startedAt: number;
  finishedAt: number | null;
  itemCount: number | null;
  observedDay: string;
  isFinalized: boolean;
  issue: { code: SyncErrorCode; params: Record<string, string | number> } | null;
}

export interface ArchiveReadPort {
  listGameFacts(): GameFacts[];
  listReviewObservations(): ReviewObservation[];
  getSyncRun(id: number): SyncRun | null;
  listWishlistSpans(): WishlistSpanFact[];
}

/** 찜 구간 낱건. NULL 의미 유지(observedAt null=찜 유지 중). */
export interface WishlistSpanFact {
  key: GameKey;
  name: string | null;
  titleKo: string | null;
  dateAdded: number | null;
  firstObservedAt: number;
  priority: number | null;
  observedAt: number | null;
  ended: boolean;
  syncRunId: number | null;
}
