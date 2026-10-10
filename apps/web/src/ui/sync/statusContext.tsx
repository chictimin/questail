/**
 * U4-P 수집 상태 공용 구독 — 셸 요약 pill·수집 상태 화면이 같은 구독을 소비한다.
 * 마운트 1회 fetch 후 running일 때만 2초 폴링(PM 결정 W6 폴링: 정착 시 중지, idle 상시 폴링 없음).
 * hidden 중에는 fetch하지 않고 visible 복귀·window focus 때 1회 reload(같은 결정 + PM #90721).
 * 라우트 이동 때도 1회 reload — /sync 진입(a) + 연동 성공 후 /library 이동(b).
 * reload 결과가 running이면 2초 폴링이 이어진다(#4).
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import type { SyncStatusEntry } from '../../data/sync.js';

interface SyncStatusValue {
  entries: SyncStatusEntry[] | null;
  failed: boolean;
  reload(): Promise<void>;
}

const SyncStatusContext = createContext<SyncStatusValue | null>(null);

async function fetchStatus(): Promise<SyncStatusEntry[] | null> {
  try {
    const response = await fetch('/api/sync/status');
    if (!response.ok) {
      return null;
    }
    const body = (await response.json()) as unknown;
    return Array.isArray(body) ? (body as SyncStatusEntry[]) : null;
  } catch {
    return null;
  }
}

export function SyncStatusProvider({
  children,
}: {
  children: React.ReactNode;
}): React.JSX.Element {
  const [entries, setEntries] = useState<SyncStatusEntry[] | null>(null);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(async () => {
    const next = await fetchStatus();
    if (next !== null) {
      setEntries(next);
      setFailed(false);
    } else {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const first = async (): Promise<void> => {
      const next = await fetchStatus();
      if (!cancelled && next !== null) {
        setEntries(next);
      }
    };
    void first();
    return () => {
      cancelled = true;
    };
  }, []);

  const running = entries?.some((entry) => entry.state === 'running') ?? false;

  useEffect(() => {
    const onReturn = (): void => {
      void reload();
    };
    const onVisibility = (): void => {
      if (document.visibilityState === 'visible') {
        onReturn();
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('focus', onReturn);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('focus', onReturn);
    };
  }, [reload]);

  // 라우트 이동 1회 reload — /sync 진입(a) + 연동 성공 후 /library 이동(b, AUTO-SYNC POST 뒤).
  // reload 결과가 running이면 아래 2초 폴링이 이어진다. connect.tsx는 건드리지 않는다.
  const [path] = useLocation();
  const firstPath = useRef(true);
  useEffect(() => {
    if (firstPath.current) {
      firstPath.current = false;
      return;
    }
    void reload();
  }, [path, reload]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      if (!document.hidden) {
        void reload();
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [running, reload]);

  return (
    <SyncStatusContext.Provider value={{ entries, failed, reload }}>
      {children}
    </SyncStatusContext.Provider>
  );
}

export function useSyncStatus(): SyncStatusValue {
  const value = useContext(SyncStatusContext);
  if (value === null) {
    throw new Error('useSyncStatus는 SyncStatusProvider 안에서만 쓴다');
  }
  return value;
}
