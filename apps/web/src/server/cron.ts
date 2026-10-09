/**
 * W-cron-1 node-cron 래퍼 — jobs/scheduler.ts가 받는 scheduleCron 형태 그대로.
 * jobs/는 데이터 소유라 server/에 둔다.
 * timezone 선택 인자(W-cron-2) — 없으면 로컬 TZ. run.ts의 같은 timeZone을 준다.
 * invalid expression은 eager throw 그대로 통과(fail-fast).
 */
import cron from 'node-cron';

/** 일일 스냅샷 cron — 매일 04:00 로컬 (PM #82807, D-09). */
export const SNAPSHOT_CRON_EXPRESSION = '0 4 * * *';

export function scheduleCron(
  expression: string,
  task: () => void,
  timezone?: string,
): {
  stop: () => void | Promise<void>;
} {
  const scheduled =
    timezone === undefined
      ? cron.schedule(expression, task)
      : cron.schedule(expression, task, { timezone });
  return {
    stop: () => scheduled.stop(),
  };
}
