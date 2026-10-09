/**
 * W3 진입점 — SIGINT/SIGTERM → shutdown 배선 + boot 호출. import 시 실행 없음.
 * 실제 A deps 연결·프로세스 실행은 W3 본구현에서 한다(스텁 단계는 배선까지만).
 */
import { boot, type BootDeps, type BootedServer } from './boot.js';

export type Unwire = () => void;

/** 신호 2종에 shutdown을 건다. 해제는 반환 함수로. */
export function wireShutdown(shutdown: () => Promise<void>): Unwire {
  const onSignal = (): void => {
    void shutdown();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
}

/** 기동 + 배선. background 실패는 stderr에 남기고 서빙은 유지한다. */
export async function main(deps: BootDeps): Promise<BootedServer> {
  const booted = await boot(deps);
  wireShutdown(booted.shutdown);
  booted.background.catch((error: unknown) => {
    console.error(
      '[web] background failed:',
      error instanceof Error ? error.message : error,
    );
  });
  return booted;
}
