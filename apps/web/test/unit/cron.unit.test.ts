/** W-cron-1 scheduleCron 래퍼 단위 — 실제 대기 없이 형태·throw·stop만. */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { scheduleCron } from '../../src/server/cron.js';

const stops: { stop: () => void | Promise<void> }[] = [];
afterEach(() => {
  while (stops.length > 0) {
    const handle = stops.pop() as { stop: () => void | Promise<void> };
    void handle.stop();
  }
});

describe('scheduleCron', () => {
  it('invalid expression → eager throw', () => {
    expect(() => scheduleCron('not-a-cron', () => {})).toThrow();
  });

  it('{stop} 반환 + stop 후 미실행', async () => {
    const spy = vi.fn();
    const handle = scheduleCron('* * * * * *', spy);
    stops.push(handle);
    expect(typeof handle.stop).toBe('function');
    await handle.stop();
    expect(spy).not.toHaveBeenCalled();
  });
});
