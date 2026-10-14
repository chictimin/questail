/**
 * 리캡 7a — 디자인 확정안(`Questail R1.5.dc.html` #7a) 그대로: 집계 기준 띠(sticky) →
 * 제목 → 07 TBTI 카드 → 01~06 섹션(번호·제목·해석 한 줄·차트·각주) → 하단 고정 바.
 * 해석 문장은 i18n 템플릿(계약 v1.1.2 R15-11 대응표 — 사전 키 `recap.interpS0n` = 계약 `recap.interp.s0n`,
 * t()가 점을 한 번만 나누므로 낙타 표기로 둔다). 값은 core 출력 그대로, 새로 집계하지 않는다.
 * 선정 규칙(확정): 04 최빈 동률 = 높은 점수(M2) · 06 봉우리 = games 1·2위, 동률 최근 연도, 인접(±1년)이면 다음(M3).
 */
import { useEffect, useState } from 'react';
import { Link } from 'wouter';
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CaretDown,
  CheckCircle,
  Copy,
  FileMd,
  Info,
  Star,
} from '@phosphor-icons/react';
import type {
  AxisLetter,
  Caveat,
  GameKey,
  LibraryRecap,
  Recap03,
  Recap04,
  Recap05,
  TbtiCardSummary,
} from '@questail/core';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import {
  formatCaveatCount,
  formatHours,
  formatInt,
  formatRatioPct,
  formatStar,
  formatStarAvg,
  formatStarDev,
} from '../../shared/format.js';
import { josaGwaWa, josaIGa } from '../../shared/josa.js';
import { useLocale } from '../i18n/context.js';
import type { Locale } from '../i18n/index.js';
import { pickPeaks, s01Key } from '../r15/interp.js';
import { lookupCover, lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import { MARKDOWN_MIME, downloadTextFile } from '../r15/download.js';
import { fetchRecapMarkdown, fetchRecapText } from '../r15/text.js';
import { TbtiPendingCard } from '../tbti/pending.js';
import type { PendingHours } from '../tbti/pending.js';
import logoUrl from '../../assets/logo-mark.png';
import './recap.css';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

type TextKey = Parameters<ReturnType<typeof useLocale>['text']>[0];
type TextFn = ReturnType<typeof useLocale>['text'];

/** core 리캡 02 미확인 줄 ID(계약 R15-3 Recap02). */
const UNKNOWN_GENRE = '__unknown';

/** 상위 5 화면 행 수(R17 — 동점은 잔여 수 한 줄). */
const TOP_ROWS = 5;

/** 안 켠 게임 칩 접힘 상태 개수(디자인 7a 03 — 5개 + 나머지 개수 한 줄). */
const UNPLAYED_PREVIEW = 5;

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

// 섹션 원소 타입 — 인덱스 접근 대신 infer로 꺼낸다(정적 문자열 스캐너 대상 밖).
type Bucket = Recap03 extends { buckets: (infer B)[] } ? B : never;
type BucketCode = Bucket extends { code: infer C } ? C : never;
type DeviantRows = Recap04 extends { high: infer H } ? H : never;
type Band = Recap05 extends { bands: (infer B)[] } ? B : never;

const BUCKET_KEYS: Record<BucketCode, TextKey> = {
  lt2h: 'recap.bucketLt2h',
  h2_10: 'recap.bucketH2to10',
  h10_30: 'recap.bucketH10to30',
  h30_100: 'recap.bucketH30to100',
  gte100h: 'recap.bucketGte100h',
};

const MINI_LEFT: AxisLetter[] = ['I', 'N', 'O', 'C'];
const MINI_RIGHT: AxisLetter[] = ['R', 'H', 'A', 'L'];

/** 해석 문장 이어 붙이기 — 빈 문장은 뺀다. */
function sentences(...parts: (string | null)[]): string {
  return parts.filter((part): part is string => part !== null && part !== '').join(' ');
}

const DASH = '—';

function keyOf(key: Pick<GameKey, 'platform' | 'externalId'>): string {
  return `${key.platform}/${key.externalId}`;
}

// 관측일 범위 YYYY-MM-DD 2개 → ko 같은 달이면 끝 달 생략, en 같은 달이면 끝 달 생략. 같은 날이면 하루만.
function formatDayRange(locale: Locale, start: string, end: string): string {
  const parse = (value: string): Date => new Date(`${value}T00:00:00Z`);
  const a = parse(start);
  const b = parse(end);
  const sameMonth =
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();
  if (locale === 'ko') {
    const head = `${a.getUTCMonth() + 1}월 ${a.getUTCDate()}일`;
    if (start === end) return head;
    return sameMonth
      ? `${head}~${b.getUTCDate()}일`
      : `${head}~${b.getUTCMonth() + 1}월 ${b.getUTCDate()}일`;
  }
  const month = (d: Date): string =>
    new Intl.DateTimeFormat('en', { month: 'short', timeZone: 'UTC' }).format(d);
  const head = `${month(a)} ${a.getUTCDate()}`;
  if (start === end) return head;
  return sameMonth
    ? `${head}–${b.getUTCDate()}`
    : `${head} – ${month(b)} ${b.getUTCDate()}`;
}

/** 섹션 하단 정보 줄(디자인: 위 1px 선 + info 아이콘 + 12/18). */
function InfoLine({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <p className="recap-info">
      <Info size={14} aria-hidden />
      <span>{children}</span>
    </p>
  );
}

// 출처 줄(recap.sourceLine) — 접힘. 펼치면 caveat 코드+개수.
function SourceLine({
  list,
  summary,
  note,
}: {
  list: Caveat[];
  summary: string | null;
  /** 섹션 각주 — 있으면 출처 줄 자리에 각주를 쓰고 같은 줄이 펼침 단추가 된다(디자인: 섹션 끝 한 줄). */
  note: string | null;
}): React.JSX.Element | null {
  const { text } = useLocale();
  const [open, setOpen] = useState(false);
  if (list.length === 0) {
    return note === null ? null : <InfoLine>{note}</InfoLine>;
  }
  return (
    <div className="recap-source">
      <button
        type="button"
        className="recap-source-btn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={14} aria-hidden />
        <span className="recap-source-label">
          {note ?? (summary === null ? text('recap.sourceLine') : sentences(text('recap.sourceLine'), DASH, summary))}
        </span>
        <CaretDown size={14} aria-hidden className="recap-caret" />
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
  title,
  aside,
  caveats,
  sourceSummary = null,
  note = null,
  children,
}: {
  num: string;
  title: string;
  aside?: React.ReactNode;
  caveats: Caveat[];
  sourceSummary?: string | null;
  note?: string | null;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <section className="recap-sec" aria-label={`${num} ${title}`}>
      <div className="recap-sec-head">
        <span className="recap-secnum">{num}</span>
        <h2 className="recap-sec-title">{title}</h2>
        {aside !== undefined ? <span className="recap-sec-aside">{aside}</span> : null}
      </div>
      {children}
      <SourceLine list={caveats} summary={sourceSummary} note={note} />
    </section>
  );
}

/** 07 미니 막대 1줄 — 장식(수치 미표시). 우세 쪽 글자 1·짙은 막대, 반대쪽 0.4. `?`는 줄무늬. */
function MiniRow({
  index,
  letter,
  pct,
}: {
  index: number;
  letter: AxisLetter;
  pct: number | null;
}): React.JSX.Element {
  const left = MINI_LEFT[index] ?? 'I';
  const right = MINI_RIGHT[index] ?? 'R';
  const unknown = letter === '?' || pct === null;
  // ②축 mini는 N_min(왼쪽 값), ①③④는 우세 글자의 primaryPct(계약 R16).
  const leftPct = unknown ? 0 : index === 1 || letter === left ? pct : 100 - pct;
  const leftStrong = !unknown && letter === left;
  const rightStrong = !unknown && letter === right;
  return (
    <div className="recap-mini">
      <span className={leftStrong ? 'recap-mini-l' : 'recap-mini-l recap-mini--weak'}>{left}</span>
      <span className={unknown ? 'recap-mini-track recap-mini-track--unknown' : 'recap-mini-track'}>
        {unknown ? null : (
          <>
            <span
              className={leftStrong ? 'recap-mini-a recap-mini--on' : 'recap-mini-a'}
              style={{ width: `${leftPct}%` }}
            />
            <span
              className={rightStrong ? 'recap-mini-b recap-mini--on' : 'recap-mini-b'}
              style={{ width: `${100 - leftPct}%` }}
            />
          </>
        )}
      </span>
      <span className={rightStrong ? 'recap-mini-r' : 'recap-mini-r recap-mini--weak'}>{right}</span>
    </div>
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
  // 부분 `?` 코드는 보류가 아니다 — 분기는 pending 플래그로만, 별명·정의 자리만 비운다(R15-11, F-04).
  const entry = isTbtiCode(summary.code) ? TBTI_NAMES[summary.code] : null;
  const nickname = entry === null ? '' : locale === 'ko' ? entry.ko.title : entry.en.title;
  const definition =
    entry === null
      ? ''
      : locale === 'ko' ? entry.ko.body.definition : entry.en.body.definition;
  return (
    <section className="recap-tbti" aria-label={text('tbti.myTbti')}>
      <div className="recap-tbti-main">
        <span className="recap-tbti-kicker">{text('recap.tbtiKicker')}</span>
        <div className="recap-tbti-id">
          <img className="recap-tbti-symbol" src={logoUrl} alt="" />
          <div className="recap-tbti-names">
            {nickname !== '' ? <span className="recap-tbti-name">{nickname}</span> : null}
            <span className={nickname !== '' ? 'recap-tbti-code' : 'recap-tbti-code recap-tbti-code--solo'}>
              {summary.code}
            </span>
          </div>
        </div>
        {definition !== '' ? <p className="recap-tbti-def">{definition}</p> : null}
        <Link href="/tbti" className="recap-tbti-go">
          {text('tbti.detailLabel')}
          <ArrowRight size={16} aria-hidden />
        </Link>
      </div>
      <div className="recap-tbti-minis" aria-hidden="true">
        {summary.letters.map((letter, index) => (
          <MiniRow
            key={MINI_LEFT[index]}
            index={index}
            letter={letter}
            pct={summary.mini[index]?.pct ?? null}
          />
        ))}
      </div>
    </section>
  );
}

function Sec01({ recap, map }: { recap: LibraryRecap; map: GameNameMap }): React.JSX.Element {
  const { text } = useLocale();
  const rows = recap.s01.top5;
  const shown = rows.slice(0, TOP_ROWS);
  const ties = rows.length - shown.length;
  const max = Math.max(1, ...shown.map((row) => row.minutes));
  const sharePct = formatRatioPct(shown.reduce((sum, row) => sum + row.share, 0));
  const total = recap.s01.totalMinutes;
  const shareNote =
    shown.length === TOP_ROWS
      ? text('recap.top5Share', { pct: sharePct })
      : text('recap.top5ShareN', { n: shown.length, pct: sharePct });
  const tieNote = ties > 0 ? text('recap.top5Ties', { n: formatInt(ties) }) : null;
  return (
    <Section
      num="01"
      title={text('recap.s01Title')}
      caveats={recap.s01.caveats}
      sourceSummary={text('recap.sourceSummary01', { n: formatInt(recap.s03.owned) })}
    >
      {total > 0 ? (
        <>
          <p className="recap-big">
            <span className="recap-big-num">{formatHours(total)}</span>
            <span className="recap-big-unit">{text('library.unitHours')}</span>
          </p>
          <p className="recap-lead">
            {text(s01Key(total), {
              days: formatInt(total / 1440),
              owned: formatInt(recap.s03.owned),
              played: formatInt(recap.s03.played),
            })}
          </p>
        </>
      ) : (
        <p className="recap-empty">{text('recap.emptyNote')}</p>
      )}
      {shown.length > 0 ? (
        <>
          <ol className="recap-top">
            {shown.map((row, index) => (
              <li key={keyOf(row.key)} className="recap-top-row">
                <span className="recap-top-rank">{index + 1}</span>
                <span className="recap-top-name">{lookupName(map, row.key)}</span>
                <span className="recap-track" aria-hidden="true">
                  <span
                    className={index === 0 ? 'recap-fill recap-fill--top' : 'recap-fill'}
                    style={{ width: `${(row.minutes / max) * 100}%` }}
                  />
                </span>
                <span className="recap-num">
                  {formatHours(row.minutes)}
                  {text('recap.unitH')}
                </span>
                <span className="recap-num recap-num--dim">{formatRatioPct(row.share)}%</span>
              </li>
            ))}
          </ol>
          <p className="recap-sub">{sentences(shareNote, tieNote)}</p>
        </>
      ) : null}
    </Section>
  );
}

function Sec02({
  recap,
  genres,
}: {
  recap: LibraryRecap;
  genres: Map<string, string>;
}): React.JSX.Element {
  const { text } = useLocale();
  // 미확인(`__unknown`)은 상위 8줄에 섞지 않고 끝 줄무늬 줄로만 둔다(F-11).
  const bars = recap.s02.bars.filter((bar) => bar.genreId !== UNKNOWN_GENRE).slice(0, 8);
  const unknown = recap.s02.bars.find((bar) => bar.genreId === UNKNOWN_GENRE);
  const unknownGames = unknown?.games ?? 0;
  const max = Math.max(1, ...bars.map((bar) => bar.games), unknownGames);
  const known = recap.s02.knownGames;
  const nameOf = (genreId: string): string => genres.get(genreId) ?? text('library.genreOther');
  const first = bars[0];
  const second = bars[1];
  let lead: string | null = null;
  if (first !== undefined && second !== undefined) {
    const a = nameOf(first.genreId);
    const b = nameOf(second.genreId);
    lead = text('recap.interpS02Two', { a, wa: josaGwaWa(a), b, ga: josaIGa(b) });
  } else if (first !== undefined) {
    const a = nameOf(first.genreId);
    lead = text('recap.interpS02One', { a, ga: josaIGa(a) });
  }
  return (
    <Section
      num="02"
      title={text('recap.s02Title')}
      caveats={recap.s02.caveats}
      note={
        unknownGames > 0
          ? text('recap.genreNote', { n: formatInt(unknownGames) })
          : text('recap.genreNoteAll')
      }
    >
      {lead !== null ? <p className="recap-lead">{lead}</p> : null}
      {bars.length === 0 && unknownGames === 0 ? (
        <p className="recap-empty">{text('recap.emptyNote')}</p>
      ) : (
        <ol className="recap-bars">
          {bars.map((bar, index) => (
            <li key={bar.genreId} className="recap-bar-row">
              <span className="recap-bar-name">{nameOf(bar.genreId)}</span>
              <span className="recap-track" aria-hidden="true">
                <span
                  className={index < 2 ? 'recap-fill recap-fill--top' : 'recap-fill'}
                  style={{ width: `${(bar.games / max) * 100}%` }}
                />
              </span>
              <span className="recap-num">{formatInt(bar.games)}</span>
              <span className="recap-num recap-num--dim">
                {known > 0 ? `${formatRatioPct(bar.games / known)}%` : ''}
              </span>
            </li>
          ))}
          {unknownGames > 0 ? (
            <li className="recap-bar-row recap-bar-row--unknown">
              <span className="recap-bar-name">{text('recap.unknownRow')}</span>
              <span className="recap-track recap-track--bare" aria-hidden="true">
                <span
                  className="recap-fill recap-fill--unknown"
                  style={{ width: `${(unknownGames / max) * 100}%` }}
                />
              </span>
              <span className="recap-num">{formatInt(unknownGames)}</span>
              <span className="recap-num" />
            </li>
          ) : null}
        </ol>
      )}
    </Section>
  );
}

function Sec03({ recap, map }: { recap: LibraryRecap; map: GameNameMap }): React.JSX.Element {
  const { text } = useLocale();
  const [open, setOpen] = useState(false);
  const { owned, played, buckets, unplayedKeys, missingKeys, medianMinutes } = recap.s03;
  const max = Math.max(1, ...buckets.map((bucket) => bucket.games));
  const chips = open ? unplayedKeys : unplayedKeys.slice(0, UNPLAYED_PREVIEW);
  const rest = unplayedKeys.length - chips.length;
  const playedNote = text('recap.interpS03', { owned: formatInt(owned), played: formatInt(played) });
  const medianNote =
    medianMinutes === null
      ? null
      : text('recap.interpS03Median', { hours: formatHours(medianMinutes) });
  return (
    <Section num="03" title={text('recap.s03Title')} caveats={recap.s03.caveats}>
      <div className="recap-03">
        <div className="recap-03-left">
          {owned > 0 ? (
            <>
              <p className="recap-big recap-big--56">
                <span className="recap-big-num">{formatRatioPct(played / owned)}%</span>
              </p>
              <p className="recap-lead">{sentences(playedNote, medianNote)}</p>
            </>
          ) : (
            <p className="recap-empty">{text('recap.emptyNote')}</p>
          )}
        </div>
        <div className="recap-03-chart" aria-hidden="true">
          <div className="recap-cols">
            {buckets.map((bucket) => (
              <span key={bucket.code} className="recap-col">
                <span className="recap-col-num">{formatInt(bucket.games)}</span>
                <span
                  className={
                    bucket.games === max && bucket.games > 0
                      ? 'recap-col-fill recap-col-fill--top'
                      : 'recap-col-fill'
                  }
                  style={{ height: `${(bucket.games / max) * 100}%` }}
                />
              </span>
            ))}
          </div>
          <div className="recap-col-labels">
            {buckets.map((bucket) => (
              <span key={bucket.code}>{text(BUCKET_KEYS[bucket.code])}</span>
            ))}
          </div>
        </div>
      </div>
      <div className="recap-split">
        <div className="recap-panel">
          <button
            type="button"
            className="recap-panel-btn"
            aria-expanded={open}
            disabled={unplayedKeys.length <= UNPLAYED_PREVIEW}
            onClick={() => setOpen((value) => !value)}
          >
            <span>{text('recap.unplayed', { n: formatInt(unplayedKeys.length) })}</span>
            {unplayedKeys.length > UNPLAYED_PREVIEW ? (
              <CaretDown size={14} aria-hidden className="recap-caret" />
            ) : null}
          </button>
          {chips.length > 0 ? (
            <ul className="recap-chips">
              {chips.map((key) => (
                <li key={keyOf(key)} className="recap-chip">
                  {lookupName(map, key)}
                </li>
              ))}
              {rest > 0 ? (
                <li className="recap-chip-more">{text('recap.unplayedMore', { n: formatInt(rest) })}</li>
              ) : null}
            </ul>
          ) : null}
        </div>
        {missingKeys.length === 0 ? (
          <div className="recap-panel recap-panel--row">
            <CheckCircle size={18} aria-hidden className="recap-ok" />
            <div>
              <p className="recap-panel-title">{text('recap.missingNone')}</p>
              <p className="recap-panel-sub">{text('recap.missingNoneSub')}</p>
            </div>
          </div>
        ) : (
          <div className="recap-panel">
            <p className="recap-panel-title">
              {text('recap.missingSome', { n: formatInt(missingKeys.length) })}
            </p>
            <p className="recap-panel-sub">{text('recap.missingSomeSub')}</p>
            <ul className="recap-chips">
              {missingKeys.map((key) => (
                <li key={keyOf(key)} className="recap-chip">
                  {lookupName(map, key)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </Section>
  );
}

function DeviantPanel({
  rows,
  high,
  map,
}: {
  rows: DeviantRows;
  high: boolean;
  map: GameNameMap;
}): React.JSX.Element {
  const { text } = useLocale();
  const label = text(high ? 'recap.highLabel' : 'recap.lowLabel');
  return (
    <section className="recap-deviant" aria-label={label}>
      <p className="recap-deviant-label">
        {high ? (
          <ArrowUp size={14} aria-hidden className="recap-ok" />
        ) : (
          <ArrowDown size={14} aria-hidden className="recap-bad" />
        )}
        {label}
      </p>
      {rows.length === 0 ? (
        <p className="recap-deviant-none">{text('recap.deviantNone')}</p>
      ) : (
        <ul className="recap-deviant-rows">
          {rows.map((row) => {
            const cover = lookupCover(map, row.key);
            return (
              <li key={keyOf(row.key)} className="recap-deviant-row">
                {cover !== null ? (
                  <img className="recap-cover" src={cover} alt="" />
                ) : (
                  <span className="recap-cover recap-cover--empty" aria-hidden="true" />
                )}
                <span className="recap-deviant-main">
                  <span className="recap-deviant-name">{lookupName(map, row.key)}</span>
                  <span className="recap-deviant-score">
                    <Star size={12} weight="fill" aria-hidden className="recap-star" />
                    {formatStar(row.score)}
                  </span>
                </span>
                <span className={high ? 'recap-deviant-dev recap-ok' : 'recap-deviant-dev recap-bad'}>
                  {formatStarDev(row.dev)}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function Sec04({ recap, map }: { recap: LibraryRecap; map: GameNameMap }): React.JSX.Element {
  const { text } = useLocale();
  const { ratedCount, mean, dist10, high, low } = recap.s04;
  const max = Math.max(1, ...dist10);
  // 최빈 — 동률이면 높은 점수(M2).
  let modeIndex = -1;
  dist10.forEach((count, index) => {
    const best = modeIndex === -1 ? 0 : (dist10[modeIndex] ?? 0);
    if (count !== 0 && count >= best) {
      modeIndex = index;
    }
  });
  if (ratedCount === 0 || mean === null) {
    return (
      <Section num="04" title={text('recap.s04Title')} caveats={recap.s04.caveats}>
        <div>
          <p className="recap-empty">{text('recap.noRating')}</p>
          <Link href="/library" className="recap-go">
            {text('recap.rateGo')}
          </Link>
        </div>
      </Section>
    );
  }
  return (
    <Section
      num="04"
      title={text('recap.s04Title')}
      aside={text('recap.meanHead', { mean: formatStarAvg(mean), n: formatInt(ratedCount) })}
      caveats={recap.s04.caveats}
      note={text('recap.ratingNote')}
    >
      {modeIndex >= 0 ? (
        <p className="recap-lead recap-lead--strong">
          {text('recap.interpS04', { score: formatStar(0.5 * (modeIndex + 1)) })}
        </p>
      ) : null}
      <div className="recap-deviants">
        <DeviantPanel rows={high} high map={map} />
        <DeviantPanel rows={low} high={false} map={map} />
      </div>
      <div className="recap-dist" aria-hidden="true">
        <div className="recap-dist-cols">
          {dist10.map((count, index) => (
            <span
              key={0.5 * (index + 1)}
              className={index === modeIndex ? 'recap-dist-fill recap-dist-fill--top' : 'recap-dist-fill'}
              style={{ height: `${(count / max) * 100}%` }}
            />
          ))}
        </div>
        <div className="recap-dist-labels">
          {dist10.map((_, index) => (
            <span key={0.5 * (index + 1)}>{formatStar(0.5 * (index + 1))}</span>
          ))}
        </div>
      </div>
    </Section>
  );
}

function bandRange(text: TextFn, band: Band): string {
  if (band.code === 'new') {
    return text('recap.rangeNew', { year: String(band.fromYear ?? band.toYear ?? '') });
  }
  if (band.code === 'classic' || band.fromYear === null) {
    return text('recap.rangeClassic', { to: String((band.toYear ?? 0) + 1) });
  }
  return text('recap.rangeRecent', { from: String(band.fromYear), to: String(band.toYear ?? '') });
}

const BAND_ORDER: Record<string, number> = { classic: 0, recent: 1, new: 2 };

function Sec05({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { text } = useLocale();
  // 왼쪽 오래된 것 → 오른쪽 신작(디자인 7a 05).
  const bands = [...recap.s05.bands].sort(
    (a, b) => (BAND_ORDER[a.code] ?? 0) - (BAND_ORDER[b.code] ?? 0),
  );
  const total = bands.reduce((sum, band) => sum + band.games, 0);
  const releaseUnknown =
    recap.s05.caveats.find((caveat) => caveat.code === 'release_unknown')?.count ?? 0;
  const top = [...bands].sort((a, b) => b.games - a.games)[0];
  const fresh = bands.find((band) => band.code === 'new');
  const topNote = top === undefined ? null : text('recap.interpS05', { band: bandRange(text, top) });
  const freshNote =
    fresh !== undefined && top !== undefined && fresh.games !== 0 && fresh.code !== top.code
      ? text('recap.interpS05New', { n: formatInt(fresh.games) })
      : null;
  return (
    <Section
      num="05"
      title={text('recap.s05Title')}
      caveats={recap.s05.caveats}
      note={releaseUnknown > 0 ? text('recap.releaseUnknown', { n: formatInt(releaseUnknown) }) : null}
    >
      {total === 0 || top === undefined ? (
        <p className="recap-empty">{text('recap.emptyNote')}</p>
      ) : (
        <>
          <p className="recap-lead">{sentences(topNote, freshNote)}</p>
          <div className="recap-stack" aria-hidden="true">
            {bands.map((band) =>
              band.games > 0 ? (
                <span
                  key={band.code}
                  className={`recap-stack-seg recap-stack-seg--${band.code}`}
                  style={{ flex: band.games }}
                >
                  {formatRatioPct(band.games / total)}%
                </span>
              ) : null,
            )}
          </div>
          <div className="recap-stack-labels">
            {bands.map((band) =>
              band.games > 0 ? (
                <span key={band.code} style={{ flex: band.games }}>
                  {text('recap.eraCount', { range: bandRange(text, band), n: formatInt(band.games) })}
                </span>
              ) : null,
            )}
          </div>
        </>
      )}
    </Section>
  );
}

function Sec06({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { text } = useLocale();
  const known = recap.s06.years;
  const fresh = recap.s05.bands.find((band) => band.code === 'new')?.games ?? 0;
  if (known.length === 0) {
    return (
      <Section num="06" title={text('recap.s06TitleEmpty')} caveats={recap.s06.caveats}>
        <p className="recap-empty">{text('recap.emptyNote')}</p>
      </Section>
    );
  }
  const from = Math.min(...known.map((entry) => entry.year));
  const to = Math.max(...known.map((entry) => entry.year));
  const byYear = new Map(known.map((entry) => [entry.year, entry.games]));
  const years = Array.from({ length: to - from + 1 }, (_, index) => ({
    year: from + index,
    games: byYear.get(from + index) ?? 0,
  }));
  const max = Math.max(1, ...years.map((entry) => entry.games));
  const peaks = pickPeaks(years);
  // 칸이 많으면 연도 라벨을 건너뛴다(라벨 겹침 방지, 봉우리는 늘 표시).
  const step = Math.max(1, Math.ceil(years.length / 18));
  const [p1, p2] = peaks;
  const peakText =
    p1 === undefined
      ? null
      : p2 === undefined
        ? text('recap.interpS06Peak', { a: String(p1) })
        : text('recap.interpS06Peaks', { a: String(Math.min(p1, p2)), b: String(Math.max(p1, p2)) });
  const columns = { gridTemplateColumns: `repeat(${years.length}, minmax(0, 1fr))` };
  return (
    <Section
      num="06"
      title={text('recap.s06Title', { from: String(from), to: String(to) })}
      caveats={recap.s06.caveats}
      note={
        recap.s06.comparePrevYear
          ? text('recap.s06NoteCompare', { n: formatInt(fresh) })
          : text('recap.s06Note', { n: formatInt(fresh) })
      }
    >
      <p className="recap-lead">
        {sentences(text('recap.interpS06', { span: formatInt(to - from + 1) }), peakText)}
      </p>
      <div className="recap-years" aria-hidden="true" style={columns}>
        {years.map((entry) => (
          <span key={entry.year} className="recap-year">
            <span className="recap-year-count">
              {peaks.includes(entry.year) ? text('recap.yearCount', { n: formatInt(entry.games) }) : ''}
            </span>
            <span
              className={peaks.includes(entry.year) ? 'recap-year-fill recap-year-fill--peak' : 'recap-year-fill'}
              style={{ height: `${(entry.games / max) * 100}%` }}
            />
          </span>
        ))}
      </div>
      <div className="recap-year-labels" aria-hidden="true" style={columns}>
        {years.map((entry, index) => (
          <span key={entry.year}>
            {index % step === 0 || peaks.includes(entry.year) ? String(entry.year).slice(-2) : ''}
          </span>
        ))}
      </div>
    </Section>
  );
}

/**
 * 하단 고정 바 — 복사·Markdown 모두 서버 렌더(R15-9, F-12). 복사 텍스트는 미리 받아 두어
 * 클릭 제스처 안에서 바로 클립보드에 쓴다(받기 전·실패 시엔 클릭 때 받는다).
 * 좁은 폭은 아이콘 + 짧은 라벨(디자인 「반응형」).
 */
function BottomBar({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { locale, text } = useLocale();
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const [prefetched, setPrefetched] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    setPrefetched(null);
    fetchRecapText(locale)
      .then((value) => {
        if (!cancelled) {
          setPrefetched(value);
        }
      })
      .catch(() => {
        // 클릭 때 다시 받는다.
      });
    return () => {
      cancelled = true;
    };
  }, [locale, recap]);
  const copy = async (): Promise<void> => {
    setFailed(false);
    try {
      await navigator.clipboard.writeText(prefetched ?? (await fetchRecapText(locale)));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setFailed(true);
    }
  };
  const download = async (): Promise<void> => {
    setFailed(false);
    try {
      const file = await fetchRecapMarkdown(locale);
      downloadTextFile(file.filename, file.text, MARKDOWN_MIME);
    } catch {
      setFailed(true);
    }
  };
  const copyLabel = copied ? text('recap.copied') : text('recap.copyText');
  const CopyIcon = copied ? CheckCircle : Copy;
  return (
    <div className="recap-bar">
      <div className="recap-bar-inner">
        {failed ? (
          <p className="recap-bar-lead recap-bar-error" role="alert">
            {text('recap.textFailed')}
          </p>
        ) : (
          <p className="recap-bar-lead">{text('recap.barLead')}</p>
        )}
        <button
          type="button"
          className="recap-bar-secondary"
          aria-label={text('recap.exportMd')}
          onClick={() => void download()}
        >
          <FileMd size={16} aria-hidden />
          <span className="recap-bar-long">{text('recap.exportMd')}</span>
          <span className="recap-bar-short">{text('recap.exportMdShort')}</span>
        </button>
        <button
          type="button"
          className="recap-bar-primary"
          aria-label={copyLabel}
          onClick={() => void copy()}
        >
          <CopyIcon size={16} aria-hidden />
          <span className="recap-bar-long">{copyLabel}</span>
          <span className="recap-bar-short">
            {copied ? text('recap.copied') : text('recap.copyTextShort')}
          </span>
        </button>
      </div>
    </div>
  );
}

// 집계 기준 띠 — 범위 = 관측일 min~max(F-19). observedDays ≤ 1이면 recap.bandZero 문구(R15-11).
function Band({ recap }: { recap: LibraryRecap }): React.JSX.Element {
  const { locale, text } = useLocale();
  const [open, setOpen] = useState(false);
  const { observedDays, rangeStart, rangeEnd } = recap.basis;
  const zero = observedDays <= 1 || rangeStart === null || rangeEnd === null;
  const full = zero
    ? text('recap.bandZero')
    : text('recap.band', {
        days: formatInt(observedDays),
        range: formatDayRange(locale, rangeStart, rangeEnd),
      });
  return (
    <div className="recap-band">
      <Info size={14} aria-hidden />
      {zero ? (
        <span>{full}</span>
      ) : (
        <>
          <span className="recap-band-wide">{full}</span>
          <button
            type="button"
            className="recap-band-narrow"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open ? full : text('recap.bandShort', { days: formatInt(observedDays) })}
          </button>
        </>
      )}
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
  const { text } = useLocale();
  return (
    <main data-route="recap">
      <Band recap={recap} />
      <div className="recap-body">
        <h1 className="recap-title">{text('recap.pageTitle')}</h1>
        <Card07 summary={recap.tbti} pendingHours={pendingHours} />
        <Sec01 recap={recap} map={map} />
        <Sec02 recap={recap} genres={genres} />
        <Sec03 recap={recap} map={map} />
        <Sec04 recap={recap} map={map} />
        <Sec05 recap={recap} />
        <Sec06 recap={recap} />
      </div>
      <BottomBar recap={recap} />
    </main>
  );
}
