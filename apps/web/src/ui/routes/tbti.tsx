/**
 * U4 TBTI — /api/tbti(상세) + /api/recap/library(공유 시트 "리캡과 함께"용) +
 * /api/library(근거 게임 이름·커버 조인표)를 읽어 TbtiView에 넘긴다.
 * 컴포넌트는 판정 출력 props로만 받는다.
 */
import { useEffect, useState } from 'react';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import type { GameFacts } from '../../data/library.js';
import { useLocale } from '../i18n/context.js';
import { TbtiView } from '../tbti/TbtiView.js';
import { getJson } from '../r15/api.js';
import { buildGameMap } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';

type Status = 'loading' | 'ready' | 'failed';

export function TbtiPage(): React.JSX.Element {
  const { text } = useLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [result, setResult] = useState<TbtiResult | null>(null);
  const [recap, setRecap] = useState<LibraryRecap | null>(null);
  const [map, setMap] = useState<GameNameMap>(new Map());
  const [tick, setTick] = useState(0);

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
        setMap(buildGameMap(factsJson as GameFacts[]));
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
  }, [tick]);

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
  return <TbtiView result={result} recap={recap} map={map} />;
}
