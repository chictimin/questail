/**
 * U3 리캡 — /api/recap/library + /api/tbti(보류 진행률) + /api/library(이름·커버·
 * 장르 조인표)를 읽어 RecapView에 넘긴다. 컴포넌트는 판정 출력 props로만 받는다.
 */
import { useEffect, useState } from 'react';
import type { LibraryRecap, TbtiResult } from '@questail/core';
import type { GameFacts } from '../../data/library.js';
import { useLocale } from '../i18n/context.js';
import { RecapView } from '../recap/RecapView.js';
import { getJson } from '../r15/api.js';
import { buildGameMap, buildGenreMap } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import type { PendingHours } from '../tbti/pending.js';

type Status = 'loading' | 'ready' | 'failed';

export function RecapPage(): React.JSX.Element {
  const { locale, text } = useLocale();
  const [status, setStatus] = useState<Status>('loading');
  const [recap, setRecap] = useState<LibraryRecap | null>(null);
  const [map, setMap] = useState<GameNameMap>(new Map());
  const [genres, setGenres] = useState<Map<string, string>>(new Map());
  const [pendingHours, setPendingHours] = useState<PendingHours | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      try {
        const [recapJson, tbtiJson, factsJson] = await Promise.all([
          getJson('/api/recap/library'),
          getJson('/api/tbti'),
          getJson('/api/library?includeEnded=true'),
        ]);
        if (cancelled) {
          return;
        }
        const facts = factsJson as GameFacts[];
        setRecap(recapJson as LibraryRecap);
        setPendingHours((tbtiJson as TbtiResult).pendingHours);
        setMap(buildGameMap(facts, locale));
        setGenres(buildGenreMap(facts, locale));
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

  if (status === 'failed' || (status === 'ready' && recap === null)) {
    return (
      <main data-route="recap">
        <div className="lib-fail">
          <p className="lib-fail-text">{text('recap.loadFailed')}</p>
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
  if (status === 'loading' || recap === null) {
    return (
      <main data-route="recap" aria-busy="true">
        <div className="lib-skel">
          <div className="lib-skel-row" />
          <div className="lib-skel-row" />
          <div className="lib-skel-row" />
        </div>
      </main>
    );
  }
  return <RecapView recap={recap} map={map} genres={genres} pendingHours={pendingHours} />;
}
