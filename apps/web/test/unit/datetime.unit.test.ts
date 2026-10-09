import { describe, expect, it } from 'vitest';
import { formatDateTime } from '../../src/shared/datetime.js';

// 타임존 고정 — 로컬 시각 단언용.
process.env.TZ = 'Asia/Seoul';

describe('formatDateTime', () => {
  it('ko·en 동일 고정형 "YYYY-MM-DD HH:mm"', () => {
    expect(formatDateTime(1791463200, 'ko')).toBe('2026-10-08 21:40');
    expect(formatDateTime(1791463200, 'en')).toBe('2026-10-08 21:40');
  });
});
