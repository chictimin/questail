/**
 * U4 TBTI — /api/tbti(상세) + /api/recap/library(공유 시트 "리캡과 함께"용) +
 * /api/library(근거 게임 이름·커버 조인표)를 읽어 TbtiView에 넘긴다.
 * 컴포넌트는 판정 출력 props로만 받는다.
 */
import { useEffect, useState } from 'react';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import type { GameFacts } from '../../data/library.js';
import { useLocale } from '../i18n/context.js';
import { useSyncStatus } from '../sync/statusContext.js';
import { TbtiView } from '../tbti/TbtiView.js';
import { getJson } from '../r15/api.js';
import { buildGameMap } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';

type Status = 'loading' | 'ready' | 'failed';

export function TbtiPage(): React.JSX.Element {
  const { locale, text } = useLocale();
  const { entries } = useSyncStatus();
  const [status, setStatus] = useState<Status>('loading');
  const [result, setResult] = useState<TbtiResult | null>(null);
  const [recap, setRecap] = useState<LibraryRecap | null>(null);
  const [map, setMap] = useState<GameNameMap>(new Map());
  const [achEnabled, setAchEnabled] = useState(true);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function loadAch(): Promise<void> {
      try {
        const response = await fetch('/api/settings/achievements');
        if (!response.ok) {
          return;
        }
        const body = (await response.json()) as { enabled: boolean };
        if (!cancelled) {
          setAchEnabled(body.enabled);
        }
      } catch {
        // 조회 실패면 켜짐 가정 — AchNotice는 잔여 분기로 기존 off 처리를 둔다.
      }
    }
    void loadAch();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [resultJson, recapJson, factsJson] = await Promise.all([
          getJson('/api/tbti'),
          getJson('/api/recap/library'),
          getJson('/api/library?includeEnded=true'),
        ]);
        if (cancelled) {
          return;
        }
        setResult(resultJson as TbtiResult);
        setRecap(recapJson as LibraryRecap);
        setMap(buildGameMap(factsJson as GameFacts[], locale));
        setStatus('ready');
      } catch {
        if (!cancelled) {
          setStatus('failed');
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [locale, tick]);

  if (status === 'failed' || (status === 'ready' && result === null)) {
    return (
      <main data-route="tbti">
        <div className="lib-fail">
          <p className="lib-fail-text">{text('tbti.loadFailed')}</p>
          <button
            type="button"
            className="lib-fail-btn"
            onClick={() => {
              setStatus('loading');
              setTick((value) => value + 1);
            }}
          >
            {text('library.reload')}
          </button>
        </div>
      </main>
    );
  }
  if (status === 'loading' || result === null) {
    return (
      <main data-route="tbti" aria-busy="true">
        <div className="lib-skel">
          <div className="lib-skel-row" />
          <div className="lib-skel-row" />
          <div className="lib-skel-row" />
        </div>
      </main>
    );
  }
  // priv 판별 출처 = GET /api/sync/status의 업적 소스 issue.code.
  const achPrivSource =
    entries?.find(
      (entry) =>
        entry.source === 'achievements' &&
        entry.issue?.code === 'ACCESS_PRIVATE',
    )?.source ?? null;
  return (
    <TbtiView
      result={result}
      recap={recap}
      map={map}
      achEnabled={achEnabled}
      achPrivSource={achPrivSource}
    />
  );
}
