/**
 * W4 — 로거 신규 도입 없음. console 래퍼 + scrub만 둔다.
 * 표준 에러 스트림 직접 기록 금지 — console.* 경유만 한다.
 */
import { scrubText } from './redact.js';

/** 파일 로그 없음 선언 (QA 감사 표면 B가 자동 포함으로 읽는다). */
export const LOG_SINKS: readonly string[] = [];

export type LogFn = (message: string, ...args: unknown[]) => void;

function wrap(
  fn: (...args: unknown[]) => void,
  knownSecrets: readonly string[],
): LogFn {
  return (message: string, ...args: unknown[]) => {
    fn(
      scrubText(message, knownSecrets),
      ...args.map((arg) =>
        typeof arg === 'string' ? scrubText(arg, knownSecrets) : arg,
      ),
    );
  };
}

/**
 * console 래퍼 — 출력 전 scrub. knownSecrets 미지정 시 32hex 패턴만 치환한다.
 * 문자열 인자만 치환하고, 그 외 인자는 그대로 넘긴다.
 */
export function createLogger(knownSecrets: readonly string[] = []): {
  info: LogFn;
  warn: LogFn;
  error: LogFn;
} {
  return {
    info: wrap(console.info.bind(console), knownSecrets),
    warn: wrap(console.warn.bind(console), knownSecrets),
    error: wrap(console.error.bind(console), knownSecrets),
  };
}
