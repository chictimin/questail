/**
 * W-cron-1 node-cron 래퍼 — jobs/scheduler.ts가 받는 scheduleCron 형태 그대로.
 * jobs/는 데이터 소유라 server/에 둔다. timezone 미전달(로컬 TZ).
 * invalid expression은 eager throw 그대로 통과(fail-fast).
 */
import cron from 'node-cron';

export function scheduleCron(
  expression: string,
  task: () => void,
): {
  stop: () => void | Promise<void>;
} {
  const scheduled = cron.schedule(expression, task);
  return {
    stop: () => scheduled.stop(),
  };
}
