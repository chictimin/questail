/**
 * U3 리캡 7a — 판정 출력 props로 받는다. 데이터 읽기는 routes/recap.tsx가 맡는다.
 * 순서(R15-11): 07 TBTI 카드 맨 위 → 01 → 02 → 03 → 04 → 05 → 06, 번호 유지.
 * 숨긴 게임 제외 등 집계 규칙은 core 출력에 들어 있다. 새로 계산하지 않는다.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import type { Caveat, LibraryRecap, TbtiCardSummary } from '@questail/core';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import { renderRecapExportFile, renderRecapText } from '../../data/recapText.js';
import { useLocale } from '../i18n/context.js';
import type { Locale } from '../i18n/index.js';
import {
  formatCaveatCount,
  formatHours,
  formatInt,
  formatRatioPct,
  formatStar,
  formatStarAvg,
  formatStarDev,
} from '../../shared/format.js';
import { lookupCover, lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import { MARKDOWN_MIME, downloadTextFile } from '../r15/download.js';
import { TbtiPendingCard } from '../tbti/pending.js';
import type { PendingHours } from '../tbti/pending.js';
import './recap.css';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

function formatDay(locale: Locale, epochSeconds: number): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    day: 'numeric',
  }).format(new Date(epochSeconds * 1000));
}

type TextKey = Parameters<ReturnType<typeof useLocale>['text']>[0];

const CAVEAT_KEYS: Record<Caveat['code'], TextKey> = {
  observation_days: 'recap.caveatObservationDays',
  hidden_excluded: 'recap.caveatHiddenExcluded',
  outside_steam_missing: 'recap.caveatOutsideSteamMissing',
  server_record_basis: 'recap.caveatServerRecordBasis',
  genre_unknown: 'recap.caveatGenreUnknown',
  genre_multi_overlap: 'recap.caveatGenreMultiOverlap',
  timepoint_unknown: 'recap.caveatTimepointUnknown',
  rated_only: 'recap.caveatRatedOnly',
  release_unknown: 'recap.caveatReleaseUnknown',
  release_not_purchase: 'recap.caveatReleaseNotPurchase',
  tag_uncollected: 'recap.caveatTagUncollected',
  n_covered_ratio: 'recap.caveatNCoveredRatio',
  n_achievements_off: 'recap.caveatNAchievementsOff',
  h_alias_file: 'recap.caveatHAliasFile',
  ach_not_reflected: 'recap.caveatAchNotReflected',
  ach_partial: 'recap.caveatAchPartial',
  wishlist_toggle_off: 'recap.caveatWishlistToggleOff',
};

function Caveats({ list }: { list: Caveat[] }): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const [open, setOpen] = useState(false);
  if (list.length === 0) {
    return null;
  }
  return (
    <div className="recap-source">
      <button
        type="button"
        className="recap-source-btn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {text('recap.sourceLine')}
      </button>
      {open ? (
        <ul className="recap-caveats">
          {list.map((caveat) => (
            <li key={caveat.code} className="recap-caveat">
              {text(CAVEAT_KEYS[caveat.code])}
              {caveat.count !== null ? (
                <span className="recap-caveat-num">
                  {formatCaveatCount(caveat.code, caveat.count)}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Section({
  num,
  caveats,
  children,
}: {
  num: string;
  caveats: Caveat[];
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="recap-sec">
      <p className="recap-secnum">{num}</p>
      {children}
      <Caveats list={caveats} />
    </section>
  );
}

function Card07({
  summary,
  pendingHours,
}: {
  summary: TbtiCardSummary;
  pendingHours: PendingHours | null;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  if (summary.pending) {
    return <TbtiPendingCard summary={summary} pendingHours={pendingHours} compact={false} />;
  }
  if (!isTbtiCode(summary.code)) {
    return <TbtiPendingCard summary={summary} pendingHours={pendingHours} compact={false} />;
  }
  const entry = TBTI_NAMES[summary.code];
  const nickname = locale === 'ko' ? entry.ko.title : entry.en.title;
  const definition =
    locale === 'ko' ? entry.ko.body.definition : entry.en.body.definition;
  return (
    <section className="recap-tbti" aria-label={text('tbti.myTbti')}>
      <div className="recap-tbti-main">
        {nickname !== '' ? (
          <p className="recap-tbti-name">{nickname}</p>
        ) : null}
        <p className="recap-tbti-code">{summary.code}</p>
        {definition !== '' ? (
          <p className="recap-tbti-def">{definition}</p>
        ) : null}
        <Link href="/tbti" className="recap-tbti-go">
          {text('tbti.detail')}
        </Link>
      </div>
      <div className="recap-tbti-minis" aria-hidden="true">
        {summary.mini.map((bar) => (
          <span key={bar.axis} className="recap-tbti-mini">
            <span
              className={
                bar.pct === null
                  ? 'recap-tbti-minifill recap-tbti-minifill--unknown'
                  : 'recap-tbti-minifill'
              }
              style={{ width: bar.pct === null ? '100%' : `${bar.pct}%` }}
            />
          </span>
        ))}
      </div>
    </section>
  );
}

function Rows01({
  recap,
  map,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const rows = recap.s01.top5;
  if (rows.length === 0) {
    return <p className="recap-empty">{text('recap.emptyNote')}</p>;
  }
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  const totalShare = Math.round(
    rows.reduce((sum, row) => sum + row.share, 0) * 100,
  );
  return (
    <div>
      <ol className="recap-top">
        {rows.map((row, index) => (
          <li
            key={`${row.key.platform}/${row.key.externalId}`}
            className="recap-top-row"
          >
            <span className="recap-top-rank">{formatInt(index + 1)}</span>
            <span className="recap-top-name">{lookupName(map, row.key)}</span>
            <span className="recap-top-track" aria-hidden="true">
              <span
                className="recap-top-fill"
                style={{ width: `${(row.minutes / max) * 100}%` }}
              />
            </span>
            <span className="recap-top-hours">
              {formatHours(row.minutes)}
              {text('library.unitHours')}
            </span>
            <span className="recap-top-share">
              {formatRatioPct(row.share)}%
            </span>
          </li>
        ))}
      </ol>
      <p className="recap-note">
        {text('recap.top5Share', { pct: formatInt(totalShare) })}
      </p>
    </div>
  );
}

function Bars02({
  recap,
  genres,
}: {
  recap: LibraryRecap;
  genres: Map<string, string>;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const bars = recap.s02.bars.slice(0, 8);
  const unknown = recap.s02.bars.find((bar) => bar.genreId === '__unknown');
  const max = Math.max(1, ...recap.s02.bars.map((bar) => bar.games));
  if (bars.length === 0 && unknown === undefined) {
    return <p className="recap-empty">{text('recap.emptyNote')}</p>;
  }
  return (
    <div>
      <ol className="recap-bars">
        {bars.map((bar) => (
          <li key={bar.genreId} className="recap-bar-row">
            <span className="recap-bar-name">
              {genres.get(bar.genreId) ?? bar.genreId}
            </span>
            <span className="recap-bar-track" aria-hidden="true">
              <span
                className="recap-bar-fill"
                style={{ width: `${(bar.games / max) * 100}%` }}
              />
            </span>
            <span className="recap-bar-num">{formatInt(bar.games)}</span>
          </li>
        ))}
        {unknown !== undefined && unknown.games > 0 ? (
          <li className="recap-bar-row">
            <span className="recap-bar-name">
              {text('recap.unknownRow', { n: formatInt(unknown.games) })}
            </span>
            <span className="recap-bar-track" aria-hidden="true">
              <span
                className="recap-bar-fill recap-bar-fill--unknown"
                style={{ width: `${(unknown.games / max) * 100}%` }}
              />
            </span>
            <span className="recap-bar-num">
              {formatInt(unknown.games)}
            </span>
          </li>
        ) : null}
      </ol>
      <p className="recap-note">
        {text(
          'recap.genreNote',
          { n: formatInt(unknown !== undefined ? unknown.games : 0) },
        )}
      </p>
    </div>
  );
}

function Buckets03({
  recap,
  map,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [open, setOpen] = useState(true);
  const buckets = recap.s03.buckets;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.games));
  const ratio =
    recap.s03.owned > 0
      ? `${Math.round((recap.s03.played / recap.s03.owned) * 100)}%`
      : null;
  return (
    <div>
      <p className="recap-bignum">
        {ratio !== null ? (
          <span className="recap-bignum-num">{ratio}</span>
        ) : (
          <span className="recap-empty">{text('recap.emptyNote')}</span>
        )}
      </p>
      <div className="recap-cols" aria-hidden="true">
        {buckets.map((bucket) => (
          <span key={bucket.code} className="recap-col">
            <span className="recap-col-track">
              <span
                className={
                  bucket.games === max && max > 0
                    ? 'recap-col-fill recap-col-fill--top'
                    : 'recap-col-fill'
                }
                style={{ height: `${(bucket.games / max) * 100}%` }}
              />
            </span>
            <span className="recap-col-num">
              {formatInt(bucket.games)}
            </span>
          </span>
        ))}
      </div>
      <div className="recap-split">
        <div className="recap-panel">
          <button
            type="button"
            className="recap-panel-btn"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {text('recap.unplayed', {
              n: formatInt(recap.s03.unplayedKeys.length),
            })}
          </button>
          {open && recap.s03.unplayedKeys.length > 0 ? (
            <ul className="recap-chips">
              {recap.s03.unplayedKeys.map((key) => (
                <li
                  key={`${key.platform}/${key.externalId}`}
                  className="recap-chip"
                >
                  {lookupName(map, key)}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="recap-panel">
          <p className="recap-missing">{text('recap.missingNone')}</p>
        </div>
      </div>
    </div>
  );
}

function Stars04({
  recap,
  map,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  if (recap.s04.ratedCount === 0 || recap.s04.mean === null) {
    return (
      <div>
        <p className="recap-empty">{text('recap.noRating')}</p>
        <Link href="/library" className="recap-go">
          {text('recap.rateGo')}
        </Link>
      </div>
    );
  }
  const max = Math.max(1, ...recap.s04.dist10);
  return (
    <div>
      <p className="recap-mean">
        {text('recap.meanLine', {
          mean: formatStarAvg(recap.s04.mean),
          n: formatInt(recap.s04.ratedCount),
        })}
      </p>
      <div className="recap-deviants">
        <section className="recap-deviant" aria-label={text('recap.highLabel')}>
          <p className="recap-deviant-label">{text('recap.highLabel')}</p>
          <ul className="recap-deviant-rows">
            {recap.s04.high.map((row) => (
              <DeviantRow
                key={`${row.key.platform}/${row.key.externalId}`}
                gameKey={row.key}
                score={row.score}
                dev={row.dev}
                map={map}
              />
            ))}
          </ul>
        </section>
        <section className="recap-deviant" aria-label={text('recap.lowLabel')}>
          <p className="recap-deviant-label">{text('recap.lowLabel')}</p>
          <ul className="recap-deviant-rows">
            {recap.s04.low.map((row) => (
              <DeviantRow
                key={`${row.key.platform}/${row.key.externalId}`}
                gameKey={row.key}
                score={row.score}
                dev={row.dev}
                map={map}
              />
            ))}
          </ul>
        </section>
      </div>
      <div className="recap-dist" aria-hidden="true">
        {recap.s04.dist10.map((count, index) => (
          <span key={0.5 * (index + 1)} className="recap-dist-col">
            <span className="recap-dist-track">
              <span
                className="recap-dist-fill"
                style={{ height: `${(count / max) * 100}%` }}
              />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function DeviantRow({
  gameKey,
  score,
  dev,
  map,
}: {
  gameKey: { platform: string; externalId: string };
  score: number;
  dev: number;
  map: GameNameMap;
}): React.JSX.Element {
  const cover = lookupCover(map, gameKey);
  return (
    <li className="recap-deviant-row">
      {cover !== null ? (
        <img className="recap-cover" src={cover} alt="" />
      ) : (
        <span className="game-cover game-cover--empty" aria-hidden="true" />
      )}
      <span className="recap-deviant-name">{lookupName(map, gameKey)}</span>
      <span className="recap-deviant-score">★{formatStar(score)}</span>
      <span className="recap-deviant-dev">{formatStarDev(dev)}</span>
    </li>
  );
}

function Eras05({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { locale, text } = useLocale();
  const labels: Record<string, TextKey> = {
    new: 'recap.bandNew',
    recent: 'recap.bandRecent',
    classic: 'recap.bandClassic',
  };
  const total = Math.max(
    1,
    ...recap.s05.bands.map((band) => band.games),
  );
  const releaseUnknown =
    recap.s05.caveats.find((caveat) => caveat.code === 'release_unknown')
      ?.count ?? 0;
  return (
    <div>
      <div className="recap-stack" aria-hidden="true">
        {recap.s05.bands.map((band) => (
          <span
            key={band.code}
            className={
              band.code === 'new'
                ? 'recap-stack-seg recap-stack-seg--new'
                : 'recap-stack-seg'
            }
            style={{ width: `${(band.games / total) * 100}%` }}
          />
        ))}
      </div>
      <ul className="recap-eras">
        {recap.s05.bands.map((band) => (
          <li key={band.code} className="recap-era">
            <span className="recap-era-name">{text(labels[band.code] ?? 'recap.bandRecent')}</span>
            <span className="recap-era-range">
              {band.fromYear !== null ? String(band.fromYear) : '…'}
              –
              {band.toYear !== null ? String(band.toYear) : '…'}
            </span>
            <span className="recap-era-num">{formatInt(band.games)}</span>
          </li>
        ))}
      </ul>
      {releaseUnknown > 0 ? (
        <p className="recap-note">
          {text('recap.releaseUnknown', { n: formatInt(releaseUnknown) })}
        </p>
      ) : null}
    </div>
  );
}

function Years06({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { text } = useLocale();
  const years = recap.s06.years;
  if (years.length === 0) {
    return <p className="recap-empty">{text('recap.emptyNote')}</p>;
  }
  const max = Math.max(1, ...years.map((entry) => entry.games));
  const ranked = [...years].sort((a, b) => b.games - a.games).slice(0, 2);
  const peaks = new Set(ranked.map((entry) => entry.year));
  return (
    <div className="recap-years" aria-hidden="true">
      {years.map((entry) => (
        <span key={entry.year} className="recap-year">
          <span className="recap-year-track">
            <span
              className={
                peaks.has(entry.year)
                  ? 'recap-year-fill recap-year-fill--peak'
                  : 'recap-year-fill'
              }
              style={{ height: `${(entry.games / max) * 100}%` }}
            />
          </span>
          <span className="recap-year-label">
            {peaks.has(entry.year) ? entry.year : ''}
          </span>
        </span>
      ))}
    </div>
  );
}

function BottomBar({
  recap,
  map,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [copied, setCopied] = useState(false);
  const names = new Map<string, string>();
  for (const [key, entry] of map) {
    if (entry.name !== null) {
      names.set(key, entry.name);
    }
  }
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(renderRecapText(recap, locale, names));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // 클립보드 거부 — 조용히 둔다(다음 눌림에 다시 시도).
    }
  };
  const download = (): void => {
    const file = renderRecapExportFile(recap, locale, names);
    downloadTextFile(file.filename, file.content, MARKDOWN_MIME);
  };
  return (
    <div className="recap-bar">
      <p className="recap-bar-lead">{text('recap.barLead')}</p>
      <div className="recap-bar-actions">
        <button type="button" className="recap-bar-secondary" onClick={download}>
          {text('recap.exportMd')}
        </button>
        <button type="button" className="recap-bar-primary" onClick={copy}>
          {copied ? text('recap.copied') : text('recap.copyText')}
        </button>
      </div>
    </div>
  );
}

export function RecapView({
  recap,
  map,
  genres,
  pendingHours,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
  genres: Map<string, string>;
  pendingHours: PendingHours | null;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [bandOpen, setBandOpen] = useState(false);
  const days = recap.basis.observedDays;
  const first = recap.basis.firstObservedAt;
  const today = formatDay(locale, Math.floor(Date.now() / 1000));
  const bandFull =
    first === null
      ? null
      : text('recap.band', {
          days: formatInt(days),
          range: `${formatDay(locale, first)}~${today}`,
        });
  const showZero = days === 0 || bandFull === null;
  return (
    <main data-route="recap">
      <div className="recap-head">
        <h1 className="recap-title">{text('recap.pageTitle')}</h1>
      </div>
      <div className="recap-band">
        {showZero || bandFull === null ? (
          <p className="recap-band-text">{text('recap.bandZero')}</p>
        ) : (
          <div>
            <p className="recap-band-wide">{bandFull}</p>
            <button
              type="button"
              className="recap-band-narrow"
              aria-expanded={bandOpen}
              onClick={() => setBandOpen((value) => !value)}
            >
              {bandOpen
                ? bandFull
                : text('recap.bandShort', { days: formatInt(days) })}
            </button>
          </div>
        )}
      </div>
      <div className="recap-body">
        <Card07 summary={recap.tbti} pendingHours={pendingHours} />
        <Section num="01" caveats={recap.s01.caveats}>
          <Rows01 recap={recap} map={map} />
        </Section>
        <Section num="02" caveats={recap.s02.caveats}>
          <Bars02 recap={recap} genres={genres} />
        </Section>
        <Section num="03" caveats={recap.s03.caveats}>
          <Buckets03 recap={recap} map={map} />
        </Section>
        <Section num="04" caveats={recap.s04.caveats}>
          <Stars04 recap={recap} map={map} />
        </Section>
        <Section num="05" caveats={recap.s05.caveats}>
          <Eras05 recap={recap} />
        </Section>
        <Section num="06" caveats={recap.s06.caveats}>
          <Years06 recap={recap} />
        </Section>
      </div>
      <BottomBar recap={recap} map={map} />
    </main>
  );
}
