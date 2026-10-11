/** U3a 수집 상태 표시 매핑 — 순수 함수. 서버 배선·폴링은 U3b. */
import type { SyncErrorCode } from '@questail/core';

export type CollectSource = 'owned' | 'info' | 'wish' | 'tags' | 'ach';
export type SyncPill = 'wait' | 'run' | 'done' | 'hold' | 'fail' | 'off';

export type TextKey = `sync.${string}` | `error.${string}` | `nav.${string}`;

/** 행 본문 — 진행 막대 / 원인 문장 / 없음(U3b 데이터가 채움). */
export type RowBody =
  | { kind: 'progress' }
  | {
      kind: 'cause';
      key: TextKey;
      params?: Record<string, string | number>;
      /** U3b [2]: 업적 비공개 행의 공개 설정 링크 자리. */
      link?: { href: string; label: TextKey };
    }
  | { kind: 'none' };

export interface RowDisplay {
  pill: SyncPill;
  body: RowBody;
  /** 실패·보류면 pill 대신 재수집 버튼 자리(U3b 배선 전까지 disabled 표시만). */
  retry: boolean;
}

export interface RowInput {
  code: SyncErrorCode | null;
  /** 코드 없는 소스 실패(b·e 일반 원인). */
  failed?: boolean;
  running?: boolean;
  done?: boolean;
  /** ok 본문 수치 — total null이면 메모리 소실로 보고 본문 없음. */
  total?: number | null;
  count?: number;
  /** 원인 문장 자리표시(causeHeldZero.prev · causeHeldTime.n · causeInfoPart.n · causeTagsPart.n · causeAchievementsPart.n). */
  params?: Record<string, string | number>;
}

/**
 * 코드 확정분만 코드로 매핑(c HELD_ZERO · d HELD_TIME_ZERO · g ACCESS_PRIVATE ·
 * h AUTH_INVALID_KEY · i RATE_LIMITED · NETWORK · PAYLOAD_CORRUPT ·
 * AUTH_ID_MISMATCH · HELD_DEPENDENCY · TAG_FAILED · TAG_EMPTY).
 * b·e는 "해당 소스 실패 + 특정 코드 아님" 일반 원인으로 묶는다.
 * f(부분 실패 {n})는 문구 키(sync.causeInfoPart·sync.causeTagsPart·sync.causeAchievementsPart)만 두고 매핑은 U3b.
 */
export function rowDisplay(source: CollectSource, input: RowInput): RowDisplay {
  const { code, failed = false, running = false, done = false, total = null, count, params } = input;
  if (code === 'HELD_ZERO') {
    return {
      pill: 'hold',
      body: { kind: 'cause', key: 'sync.causeHeldZero', params },
      retry: true,
    };
  }
  if (code === 'HELD_TIME_ZERO') {
    return {
      pill: 'hold',
      body: { kind: 'cause', key: 'sync.causeHeldTime', params },
      retry: true,
    };
  }
  if (code === 'ACCESS_PRIVATE') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeAch' }, retry: true };
  }
  if (code === 'AUTH_INVALID_KEY') {
    // h: 전 소스 pill 실패 + 상단 Alert(행에 원인 반복 없음).
    return { pill: 'fail', body: { kind: 'none' }, retry: false };
  }
  if (code === 'RATE_LIMITED') {
    return { pill: 'hold', body: { kind: 'cause', key: 'sync.causeLimited' }, retry: true };
  }
  if (code === 'NETWORK') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeNetwork' }, retry: true };
  }
  if (code === 'PAYLOAD_CORRUPT') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causePayload' }, retry: true };
  }
  if (code === 'AUTH_ID_MISMATCH') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeIdMismatch' }, retry: true };
  }
  if (code === 'HELD_DEPENDENCY') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeHeldDep' }, retry: true };
  }
  if (code === 'TAG_FAILED') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeTagFailed' }, retry: true };
  }
  if (code === 'TAG_EMPTY') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeTagEmpty' }, retry: true };
  }
  if (failed && source === 'owned') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeOwned' }, retry: true };
  }
  if (failed && source === 'wish') {
    return { pill: 'fail', body: { kind: 'cause', key: 'sync.causeWish' }, retry: true };
  }
  if (failed) {
    // tags·info·ach의 코드 없는 실패 — 원인 문장 없이 pill+재수집 자리만.
    return { pill: 'fail', body: { kind: 'none' }, retry: true };
  }
  if (running) {
    return { pill: 'run', body: { kind: 'progress' }, retry: false };
  }
  if (done) {
    // progress는 메모리라 total null이면 소실 — 본문 없이 pill+시각만.
    if (
      (source === 'owned' || source === 'wish') &&
      total !== null &&
      count !== undefined
    ) {
      return {
        pill: 'done',
        body: {
          kind: 'cause',
          key: source === 'owned' ? 'sync.doneOwned' : 'sync.doneWish',
          params: { n: count },
        },
        retry: false,
      };
    }
    return { pill: 'done', body: { kind: 'none' }, retry: false };
  }
  return { pill: 'wait', body: { kind: 'none' }, retry: false };
}

/** 상단 Alert — h(AUTH_INVALID_KEY)만. */
export function appAlertFor(code: SyncErrorCode | null): TextKey | null {
  if (code === 'AUTH_INVALID_KEY') {
    return 'sync.alertKey';
  }
  return null;
}
