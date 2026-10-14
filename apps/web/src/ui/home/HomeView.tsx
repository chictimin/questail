/**
 * 홈 6a — 디자인 확정안(`Questail R1.5.dc.html` #6a) 그대로.
 * 대응(R15-11): 큰 숫자 ← s01.totalMinutes · 상위 5 ← s01.top5 · 산 게임 중 플레이 ← s03.played/owned(+ medianMinutes) ·
 * 별점 평균 ← s04.mean · 가장 많은 장르 ← s02.bars 상위 2(미확인 제외). 새로 계산하지 않는다.
 * 판정 보류(pending)면 오른쪽 카드는 8c 축소판. 부분 `?` 코드는 보류가 아니다(F-04).
 * 새 칭호 줄은 R1.5 제외.
 */
import { Link } from 'wouter';
import { ArrowRight, Info, Star } from '@phosphor-icons/react';
import type { LibraryRecap } from '@questail/core';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import {
  formatHours,
  formatInt,
  formatRatioPct,
  formatStarAvg,
} from '../../shared/format.js';
import { useLocale } from '../i18n/context.js';
import { s01Key } from '../r15/interp.js';
import { lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import { TbtiPendingCard } from '../tbti/pending.js';
import type { PendingHours } from '../tbti/pending.js';
import logoUrl from '../../assets/logo-mark.png';
import './home.css';

/** core 리캡 02 미확인 줄 ID(계약 R15-3 Recap02). */
const UNKNOWN_GENRE = '__unknown';

const DOT = ' · ';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

function TopRows({ recap, map }: { recap: LibraryRecap; map: GameNameMap }): React.JSX.Element {
  const { text } = useLocale();
  const rows = recap.s01.top5.slice(0, 5);
  const max = Math.max(1, ...rows.map((row) => row.minutes));
  return (
    <ol className="home-top">
      {rows.map((row, index) => (
        <li key={`${row.key.platform}/${row.key.externalId}`} className="home-top-row">
          <span className="home-top-rank">{index + 1}</span>
          <span className="home-top-name">{lookupName(map, row.key)}</span>
          <span className="home-top-track" aria-hidden="true">
            <span
              className={index === 0 ? 'home-top-fill home-top-fill--top' : 'home-top-fill'}
              style={{ width: `${(row.minutes / max) * 100}%` }}
            />
          </span>
          <span className="home-top-hours">
            {formatHours(row.minutes)}
            {text('recap.unitH')}
          </span>
        </li>
      ))}
    </ol>
  );
}

function TbtiCard({
  recap,
  pendingHours,
}: {
  recap: LibraryRecap;
  pendingHours: PendingHours | null;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const summary = recap.tbti;
  if (summary.pending) {
    return <TbtiPendingCard summary={summary} pendingHours={pendingHours} compact />;
  }
  // 부분 `?` 코드(예 ?NAC)는 보류가 아니다 — 카드는 그대로, 별명·정의 자리만 비운다(R15-11, F-04).
  const entry = isTbtiCode(summary.code) ? TBTI_NAMES[summary.code] : null;
  const nickname = entry === null ? '' : locale === 'ko' ? entry.ko.title : entry.en.title;
  const definition =
    entry === null
      ? ''
      : locale === 'ko' ? entry.ko.body.definition : entry.en.body.definition;
  return (
    <section className="home-tbti" aria-label={text('tbti.myTbti')}>
      <div className="home-tbti-top">
        <span className="home-tbti-lead">{text('tbti.myTbti')}</span>
        <span className="home-tbti-code">{summary.code}</span>
      </div>
      <img className="home-tbti-symbol" src={logoUrl} alt="" />
      {nickname !== '' ? <p className="home-tbti-name">{nickname}</p> : null}
      {definition !== '' ? <p className="home-tbti-def">{definition}</p> : null}
      <span className="home-tbti-gap" />
      <Link href="/tbti" className="home-tbti-go">
        {text('tbti.detailLabel')}
        <ArrowRight size={16} aria-hidden />
      </Link>
    </section>
  );
}

export function HomeView({
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
  const total = recap.s01.totalMinutes;
  const { owned, played, medianMinutes } = recap.s03;
  const days = recap.basis.observedDays;
  // 미확인(`__unknown`)은 가장 많은 장르가 될 수 없다(F-11).
  const topGenres = recap.s02.bars.filter((bar) => bar.genreId !== UNKNOWN_GENRE).slice(0, 2);
  const genreName = (genreId: string): string => genres.get(genreId) ?? text('library.genreOther');
  const playedSub = [
    text('home.playedShareSub', { owned: formatInt(owned), played: formatInt(played) }),
    medianMinutes === null ? null : text('home.medianSub', { hours: formatHours(medianMinutes) }),
  ]
    .filter((part): part is string => part !== null)
    .join(DOT);
  return (
    <main data-route="home">
      <div className="home-head">
        <h1 className="home-title">{text('nav.home')}</h1>
        <p className="home-basis">
          <Info size={14} aria-hidden />
          {days <= 1
            ? text('home.basisZero')
            : text('home.basis', { days: formatInt(days) })}
        </p>
      </div>
      <div className="home-cols">
        <section className="home-play" aria-label={text('home.playedLead')}>
          <p className="home-play-lead">{text('home.playedLead')}</p>
          {total > 0 ? (
            <>
              <p className="home-bignum">
                <span className="home-bignum-num">{formatHours(total)}</span>
                <span className="home-bignum-unit">{text('library.unitHours')}</span>
              </p>
              <p className="home-play-sub">
                {text(s01Key(total), {
                  days: formatInt(total / 1440),
                  owned: formatInt(owned),
                  played: formatInt(played),
                })}
              </p>
              <TopRows recap={recap} map={map} />
            </>
          ) : (
            <p className="home-empty">{text('recap.emptyNote')}</p>
          )}
          <Link href="/recap" className="home-more">
            {text('home.top5Link')}
            <ArrowRight size={14} aria-hidden />
          </Link>
        </section>
        <TbtiCard recap={recap} pendingHours={pendingHours} />
      </div>
      <div className="home-trio">
        <section className="home-cell" aria-label={text('home.playedShare')}>
          <p className="home-cell-label">{text('home.playedShare')}</p>
          {owned > 0 ? (
            <>
              <p className="home-cell-num">{formatRatioPct(played / owned)}%</p>
              <p className="home-cell-sub">{playedSub}</p>
            </>
          ) : (
            <p className="home-cell-sub">{text('recap.emptyNote')}</p>
          )}
        </section>
        <section className="home-cell" aria-label={text('home.meanStars')}>
          <p className="home-cell-label">{text('home.meanStars')}</p>
          {recap.s04.mean !== null ? (
            <>
              <p className="home-cell-num">
                <Star size={26} weight="fill" aria-hidden className="home-star" />
                {formatStarAvg(recap.s04.mean)}
              </p>
              <p className="home-cell-sub">
                {text('home.meanSub', { n: formatInt(recap.s04.ratedCount) })}
              </p>
            </>
          ) : (
            <p className="home-cell-sub">{text('home.noRating')}</p>
          )}
        </section>
        <section className="home-cell" aria-label={text('home.topGenre')}>
          <p className="home-cell-label">{text('home.topGenre')}</p>
          {topGenres.length > 0 ? (
            <>
              <p className="home-cell-num home-cell-num--text">
                {topGenres.map((bar) => genreName(bar.genreId)).join(DOT)}
              </p>
              <p className="home-cell-sub">
                {text('home.genreSub', {
                  known: formatInt(recap.s02.knownGames),
                  counts: topGenres
                    .map((bar) => text('home.genreCount', { n: formatInt(bar.games) }))
                    .join(DOT),
                })}
              </p>
            </>
          ) : (
            <p className="home-cell-sub">{text('recap.emptyNote')}</p>
          )}
        </section>
      </div>
    </main>
  );
}
