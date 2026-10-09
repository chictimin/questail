/**
 * U4-P 수집 상태 공용 구독 — 셸 요약 pill·수집 상태 화면이 같은 구독을 소비한다.
 * 마운트 1회 fetch 후 running 있을 때만 2초 폴링, 없으면 정지.
 */
import { createContext, useCallback, useContext, useEffect, useState } from 'react';
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
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      void reload();
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
