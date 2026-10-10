/**
 * W3 진입점 — SIGINT/SIGTERM → shutdown 배선 + boot 호출. import 시 실행 없음.
 * 실제 A deps 연결·프로세스 실행은 W3 본구현에서 한다(스텁 단계는 배선까지만).
 */
import { boot, type BootDeps, type BootedServer } from './boot.js';

export type Unwire = () => void;

/** 종료 전체 상한(ms) — 정리가 이 안에 끝나지 않으면 프로세스를 강제 종료한다(P-12 [종료]). */
export const SHUTDOWN_EXIT_CAP_MS = 15_000;
/** 정리 완료 종료 코드. */
export const EXIT_CLEAN = 0;
/** 상한 도달·정리 실패·두 번째 신호 시 종료 코드(정리 미완료). */
export const EXIT_FORCED = 1;

export type ExitOptions = {
  /** 전체 상한 오버라이드(테스트 시간 주입). */
  capMs?: number;
  /** 프로세스 종료 함수 — 제품은 process.exit. */
  exit: (code: number) => void;
};

/**
 * 신호 2종에 shutdown을 건다. 해제는 반환 함수로.
 * exit 옵션이 있으면 정리 완료(0) 또는 상한 도달(1) 중 먼저 오는 시점에 프로세스를 끝낸다.
 * 두 번째 신호는 기다리지 않고 같은 종료 경로(정리 미완료면 1)로 즉시 끝낸다.
 */
export function wireShutdown(
  shutdown: () => Promise<void>,
  options?: ExitOptions,
): Unwire {
  let signals = 0;
  let cleaned = false;
  const onSignal = (): void => {
    signals += 1;
    const run = shutdown();
    if (options === undefined) {
      void run;
      return;
    }
    if (signals >= 2) {
      options.exit(cleaned ? EXIT_CLEAN : EXIT_FORCED);
      return;
    }
    const timer = setTimeout(() => {
      console.error('[web] shutdown: shutdown cap reached — forcing process exit');
      options.exit(EXIT_FORCED);
    }, options.capMs ?? SHUTDOWN_EXIT_CAP_MS);
    run.then(
      () => {
        cleaned = true;
        clearTimeout(timer);
        options.exit(EXIT_CLEAN);
      },
      () => {
        clearTimeout(timer);
        options.exit(EXIT_FORCED);
      },
    );
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  return () => {
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  };
}

export type MainOptions = {
  /** 종료 상한 오버라이드(ms), 테스트용. */
  shutdownCapMs?: number;
};

/** 기동 + 배선. background 실패는 stderr에 남기고 서빙은 유지한다. */
export async function main(
  deps: BootDeps,
  options: MainOptions = {},
): Promise<BootedServer> {
  const booted = await boot(deps);
  wireShutdown(booted.shutdown, {
    capMs: options.shutdownCapMs,
    exit: (code) => process.exit(code),
  });
  booted.background.catch((error: unknown) => {
    console.error(
      '[web] background failed:',
      error instanceof Error ? error.message : error,
    );
  });
  return booted;
}
