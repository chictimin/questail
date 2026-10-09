import { describe, expect, it, vi } from 'vitest';
import { createLogger, LOG_SINKS } from '../../src/server/logging.js';
import { REDACTED, scrubText } from '../../src/server/redact.js';

/** 더미 키 상수 1개(32hex, 실키 아님). */
const DUMMY_KEY = 'abcdef0123456789abcdef0123456789';

describe('scrubText', () => {
  it('32hex 패턴 치환', () => {
    expect(scrubText(`key=${DUMMY_KEY}`, [])).toBe(`key=${REDACTED}`);
  });

  it('알려진 비밀값 정확값 치환', () => {
    expect(scrubText(`Authorization ${DUMMY_KEY} end`, [DUMMY_KEY])).toBe(
      `Authorization ${REDACTED} end`,
    );
  });

  it('알려진 비밀값 URL 인코딩형 치환', () => {
    const encoded = encodeURIComponent(DUMMY_KEY);
    expect(scrubText(`?key=${encoded}`, [DUMMY_KEY])).toBe(`?key=${REDACTED}`);
  });

  it('인접값(부분 포함) 치환 — 앞뒤 문자는 보존', () => {
    expect(scrubText(`xx${DUMMY_KEY}yy`, [DUMMY_KEY])).toBe(`xx${REDACTED}yy`);
  });

  it('키 없음 → 원문 유지', () => {
    expect(scrubText('plain text', [])).toBe('plain text');
  });
});

describe('logging', () => {
  it('LOG_SINKS 빈 배열(파일 로그 없음 선언)', () => {
    expect(LOG_SINKS).toEqual([]);
  });

  it('래퍼가 32hex 치환 후 console에 전달', () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {});
    try {
      createLogger().info(`key=${DUMMY_KEY}`);
      expect(info).toHaveBeenCalledWith(`key=${REDACTED}`);
    } finally {
      info.mockRestore();
    }
  });
});
