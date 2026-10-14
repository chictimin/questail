/**
 * U2 홈 6a — 판정 출력 props로 받는다. 데이터 읽기는 routes/home.tsx가 맡는다.
 * 대응(R15-11): 큰 숫자 ← s01.totalMinutes · 상위 5 ← s01.top5 ·
 * 산 게임 중 플레이 ← s03.played/owned · 별점 평균 ← s04.mean ·
 * 가장 많은 장르 ← s02.bars[0]. 새로 계산하지 않는다.
 */
import { Link } from 'wouter';
import type { LibraryRecap } from '@questail/core';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import { useLocale } from '../i18n/context.js';
import {
  formatHours,
  formatInt,
  formatPendingHours,
  formatStarAvg,
} from '../../shared/format.js';
import { lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import type { PendingHours } from '../tbti/pending.js';
import logoUrl from '../../assets/logo-mark.png';
import './home.css';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

function TopRows({
  recap,
  map,
}: {
  recap: LibraryRecap;
  map: GameNameMap;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const max = Math.max(1, ...recap.s01.top5.map((row) => row.minutes));
  return (
    <ol className="home-top">
      {recap.s01.top5.map((row, index) => (
        <li key={`${row.key.platform}/${row.key.externalId}`} className="home-top-row">
          <span className="home-top-rank">{formatInt(index + 1)}</span>
          <span className="home-top-name">{lookupName(map, row.key)}</span>
          <span
            className="home-top-track"
            aria-hidden="true"
          >
            <span
              className="home-top-fill"
              style={{ width: `${(row.minutes / max) * 100}%` }}
            />
          </span>
          <span className="home-top-hours">
            {formatHours(row.minutes)}
            {text('library.unitHours')}
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
}): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const summary = recap.tbti;
  if (summary.pending) {
    const haveHours =
      pendingHours !== null ? formatPendingHours(pendingHours.have) : null;
    return (
      <section className="home-tbti home-tbti--pending" aria-label={text('tbti.myTbti')}>
        <p className="home-tbti-lead">{text('tbti.myTbti')}</p>
        <p className="home-tbti-pend">{text('tbti.pendLead')}</p>
        {haveHours !== null && pendingHours !== null ? (
          <p className="home-tbti-prog">
            {text('tbti.pendProg', { have: haveHours })}
          </p>
        ) : null}
        <div
          className="home-tbti-track"
          aria-hidden="true"
        >
          <span
            className="home-tbti-fill"
            style={{
              width:
                pendingHours !== null
                  ? `${Math.min(100, (pendingHours.have / pendingHours.need) * 100)}%`
                  : '0%',
            }}
          />
        </div>
        <Link href="/tbti" className="home-tbti-go">
          {text('tbti.detail')}
        </Link>
      </section>
    );
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
        <p className="home-tbti-lead">{text('tbti.myTbti')}</p>
        <span className="home-tbti-code">{summary.code}</span>
      </div>
      <img className="home-tbti-symbol" src={logoUrl} alt="" />
      {nickname !== '' ? (
        <p className="home-tbti-name">{nickname}</p>
      ) : null}
      {definition !== '' ? (
        <p className="home-tbti-def">{definition}</p>
      ) : null}
      <Link href="/tbti" className="home-tbti-go">
        {text('tbti.detail')}
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
  const { locale, text } = useLocale();
  const hours = Math.round(recap.s01.totalMinutes / 60);
  const ratio =
    recap.s03.owned > 0
      ? `${Math.round((recap.s03.played / recap.s03.owned) * 100)}%`
      : null;
  // 미확인(`__unknown`)은 "가장 많은 장르"가 될 수 없다(F-11).
  const topGenre = recap.s02.bars.find((bar) => bar.genreId !== '__unknown');
  return (
    <main data-route="home">
      <div className="home-head">
        <h1 className="home-title">{text('nav.home')}</h1>
        <p className="home-basis">{text('home.basis')}</p>
      </div>
      <div className="home-cols">
        <section className="home-play" aria-label={text('home.playedLead')}>
          <p className="home-play-lead">{text('home.playedLead')}</p>
          <p className="home-bignum">
            <span className="home-bignum-num">{formatInt(hours)}</span>
            <span className="home-bignum-unit">{text('library.unitHours')}</span>
          </p>
          <p className="home-play-sub">
            {text('home.playedSub', {
              owned: formatInt(recap.s03.owned),
              played: formatInt(recap.s03.played),
            })}
          </p>
          <TopRows recap={recap} map={map} />
          <Link href="/recap" className="home-more">
            {text('home.top5Link')}
          </Link>
        </section>
        <TbtiCard recap={recap} pendingHours={pendingHours} />
      </div>
      <div className="home-trio">
        <section className="home-cell">
          <p className="home-cell-label">{text('home.playedShare')}</p>
          <p className="home-cell-num">{ratio ?? text('recap.emptyNote')}</p>
        </section>
        <section className="home-cell">
          <p className="home-cell-label">{text('home.meanStars')}</p>
          <p className="home-cell-num">
            {recap.s04.mean !== null ? (
              <span>★{formatStarAvg(recap.s04.mean)}</span>
            ) : (
              text('home.noRating')
            )}
          </p>
        </section>
        <section className="home-cell">
          <p className="home-cell-label">{text('home.topGenre')}</p>
          <p className="home-cell-num">
            {topGenre !== undefined
              ? (genres.get(topGenre.genreId) ?? text('library.genreOther'))
              : text('recap.emptyNote')}
          </p>
        </section>
      </div>
    </main>
  );
}
