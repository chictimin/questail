/**
 * TBTI 8a — 디자인 확정안(`Questail R1.5.dc.html` #8a) 그대로: 본문 폭 800 세로 흐름.
 * 카드 앞면(2열 텍스트 | 심볼 160) → 기준 한 줄 → 축 카드 4개(번호·이름·칩·점수 / 양끝 글자·단어 + 50% 기준선 막대 /
 * 해석 문장 / 「왜 이 글자인가」 접기: 안내 → 지표 한 줄 → 참고 → 근거 게임 행(태그) → 각주) → 본문 아코디언 → 끝 한 줄 + 공유.
 * 8c(전체 보류)는 보류 카드, 8d(축 ?)는 글자 흐리게 + 줄무늬 막대 + ? 원 + 사유 한 줄.
 * 해석 문장·지표 줄은 화면 i18n 템플릿(계약 v1.1.2 R15-11 — 사전 키 `tbti.interp{글자}`·`tbti.metric*`).
 * 컴포넌트는 판정 출력 props로 받는다. 데이터 읽기는 routes/tbti.tsx가 맡는다.
 */
import { useState } from 'react';
import { Link } from 'wouter';
import {
  CaretDown,
  Info,
  MagnifyingGlass,
  Minus,
  Plus,
  ShareFat,
} from '@phosphor-icons/react';
import type {
  AxisLetter,
  AxisMetrics,
  Caveat,
  GameKey,
  LibraryRecap,
  TbtiAxis,
  TbtiResult,
} from '@questail/core';
import {
  TBTI_BASELINE_IMC2016_TEXT_KEY,
  TBTI_REASON_CL_ACH_READY,
  TBTI_REASON_CL_HOURS_ONLY,
  TBTI_REASON_IR_BOTH,
  TBTI_REASON_IR_I_ONLY,
  TBTI_REASON_IR_R_ONLY,
  TBTI_REASON_NH_CONFIRMED_LASTPLAYED,
  TBTI_REASON_NH_CONFIRMED_SNAPSHOT,
  TBTI_REASON_NH_CONFIRMED_UNLOCK,
  TBTI_REASON_NH_CONFIRMED_WISHLIST,
  TBTI_REASON_NH_LATE,
  TBTI_REASON_NH_NO_EVIDENCE,
  TBTI_REASON_OA_GENRE,
} from '@questail/core';
import type { CollectSource } from '../../data/sync.js';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import { formatCaveatCount, formatHours, formatInt, formatPct } from '../../shared/format.js';
import { josaGwaWa, josaIGa } from '../../shared/josa.js';
import { useLocale } from '../i18n/context.js';
import { gameMapKey, lookupCover, lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import { TbtiPendingCard } from './pending.js';
import { ShareSheet } from '../share/ShareSheet.js';
import logoUrl from '../../assets/logo-mark.png';
import './tbti.css';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

type TextKey = Parameters<ReturnType<typeof useLocale>['text']>[0];
type TextFn = ReturnType<typeof useLocale>['text'];

const DOT = ' · ';

const AXIS_NUMS: Record<TbtiAxis['axis'], string> = { 1: '①', 2: '②', 3: '③', 4: '④' };

const AXIS_NAMES: Record<TbtiAxis['axis'], TextKey> = {
  1: 'tbti.axisName1',
  2: 'tbti.axisName2',
  3: 'tbti.axisName3',
  4: 'tbti.axisName4',
};

const AXIS_WORDS: Record<AxisLetter, TextKey> = {
  I: 'tbti.axisI',
  R: 'tbti.axisR',
  N: 'tbti.axisN',
  H: 'tbti.axisH',
  O: 'tbti.axisO',
  A: 'tbti.axisA',
  C: 'tbti.axisC',
  L: 'tbti.axisL',
  '?': 'tbti.axisQ',
};

// 축 해석 문장(R15-11 대응표의 축×글자 템플릿 → 사전 낙타 키 interp+글자). 물음표 축은 해석 없이 사유 한 줄.
const INTERP_KEYS: Partial<Record<AxisLetter, TextKey>> = {
  I: 'tbti.interpI',
  R: 'tbti.interpR',
  N: 'tbti.interpN',
  H: 'tbti.interpH',
  O: 'tbti.interpO',
  A: 'tbti.interpA',
  C: 'tbti.interpC',
  L: 'tbti.interpL',
};

const LEFT_LETTER: Record<TbtiAxis['axis'], AxisLetter> = { 1: 'I', 2: 'N', 3: 'O', 4: 'C' };
const RIGHT_LETTER: Record<TbtiAxis['axis'], AxisLetter> = { 1: 'R', 2: 'H', 3: 'A', 4: 'L' };

/**
 * core baselineTextKey(계약 키, 실값 tbti.baseline.imc2016.text — core constants.ts)는
 * t()가 한 번만 나누므로 그대로 풀지 못한다. 아는 키만 사전 키로 옮기고,
 * 표에 없는 키는 줄을 그리지 않는다(원키 노출 0, F-06).
 */
const BASELINE_TEXT_KEYS: Record<string, TextKey> = {
  [TBTI_BASELINE_IMC2016_TEXT_KEY]: 'tbti.baselineImc2016',
};

/**
 * core reasonKey(닫힌 12키, 계약 v1.0.4)는 t()가 두 조각만 풀므로 사전 키로 옮긴다.
 * 출처 = packages/core/src/tbti/judge.ts TBTI_REASON_* 상수 12개.
 */
const REASON_TEXT_KEYS: Record<string, TextKey> = {
  [TBTI_REASON_IR_I_ONLY]: 'tbti.reasonIrIOnly',
  [TBTI_REASON_IR_R_ONLY]: 'tbti.reasonIrROnly',
  [TBTI_REASON_IR_BOTH]: 'tbti.reasonIrBoth',
  [TBTI_REASON_NH_CONFIRMED_SNAPSHOT]: 'tbti.reasonNhSnapshot',
  [TBTI_REASON_NH_CONFIRMED_UNLOCK]: 'tbti.reasonNhUnlock',
  [TBTI_REASON_NH_CONFIRMED_LASTPLAYED]: 'tbti.reasonNhLastPlayed',
  [TBTI_REASON_NH_CONFIRMED_WISHLIST]: 'tbti.reasonNhWishlist',
  [TBTI_REASON_NH_LATE]: 'tbti.reasonNhLate',
  [TBTI_REASON_NH_NO_EVIDENCE]: 'tbti.reasonNhNoEvidence',
  [TBTI_REASON_OA_GENRE]: 'tbti.reasonOaGenre',
  [TBTI_REASON_CL_ACH_READY]: 'tbti.reasonClAchReady',
  [TBTI_REASON_CL_HOURS_ONLY]: 'tbti.reasonClHoursOnly',
};

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

function axisWord(text: TextFn, letter: AxisLetter): string {
  return text(AXIS_WORDS[letter]);
}

function observedDays(result: TbtiResult): number {
  return result.caveats.find((caveat) => caveat.code === 'observation_days')?.count ?? 0;
}

/** 앞면 풀이 끝 병기 — ②축 H 비중(N주) 또는 시리즈 반복(H주). */
function homeLine(text: TextFn, result: TbtiResult): string | null {
  const second = result.axes.find((axis) => axis.axis === 2);
  if (second === undefined || second.secondary !== 'H' || second.secondaryPct === null) {
    return null;
  }
  const pct = formatPct(second.secondaryPct);
  return second.primary === 'H'
    ? text('tbti.seriesReplay', { pct })
    : text('tbti.homeShare', { pct });
}

function FrontCard({ result }: { result: TbtiResult }): React.JSX.Element {
  const { locale, text } = useLocale();
  const entry = isTbtiCode(result.code) ? TBTI_NAMES[result.code] : null;
  const nickname = entry === null ? '' : locale === 'ko' ? entry.ko.title : entry.en.title;
  const definition =
    entry === null
      ? ''
      : locale === 'ko' ? entry.ko.body.definition : entry.en.body.definition;
  const words = [...result.axes]
    .sort((a, b) => a.axis - b.axis)
    .map((axis) => axisWord(text, axis.primary))
    .join(DOT);
  const extra = homeLine(text, result);
  return (
    <section className="tbti-front" aria-label={text('tbti.myTbti')}>
      <div className="tbti-front-text">
        <p className="tbti-front-codeline">
          {nickname !== '' ? <span className="tbti-front-code">{result.code}</span> : null}
          <span className="tbti-front-words">
            {words}
            {extra !== null ? ` — ${extra}` : ''}
          </span>
        </p>
        <h1 className={nickname !== '' ? 'tbti-name' : 'tbti-name tbti-name--code'}>
          {nickname !== '' ? nickname : result.code}
        </h1>
        {definition !== '' ? <p className="tbti-def">{definition}</p> : null}
      </div>
      <img className="tbti-symbol" src={logoUrl} alt="" />
    </section>
  );
}

function FrontNote({ result }: { result: TbtiResult }): React.JSX.Element {
  const { text } = useLocale();
  const days = observedDays(result);
  return (
    <p className="tbti-frontnote">
      <span className="tbti-frontnote-basis">
        <Info size={14} aria-hidden />
        {days <= 1
          ? text('tbti.frontBasisZero')
          : text('tbti.frontBasis', { days: formatInt(days) })}
      </span>
      <span>{text('tbti.frontRule')}</span>
    </p>
  );
}

function Chip({ label }: { label: string }): React.JSX.Element {
  return <span className="tbti-chip">{label}</span>;
}

// 점수 라벨(오른쪽 위 Mono 700) — 글자+정수%. ②축 N주는 H 비중, H주는 시리즈 반복을 가운뎃점으로 잇는다.
function scoreLabel(text: TextFn, axis: TbtiAxis): string {
  if (axis.held || axis.primary === '?' || axis.primaryPct === null) {
    return text('tbti.heldTitle');
  }
  const head = `${axis.primary} ${formatPct(axis.primaryPct)}%`;
  if (axis.axis !== 2 || axis.secondary !== 'H' || axis.secondaryPct === null) {
    return head;
  }
  const pct = formatPct(axis.secondaryPct);
  const tail = axis.primary === 'H' ? text('tbti.seriesReplay', { pct }) : `${axis.secondary} ${pct}%`;
  return [head, tail].join(DOT);
}

/** 막대 양쪽 채움(%) — 왼쪽 a·오른쪽 b. ②축은 왼쪽 N_min, 오른쪽 H주면 신작 아닌 비중·N주면 H_pct. */
function meterWidths(axis: TbtiAxis): { a: number; b: number } {
  const left = LEFT_LETTER[axis.axis];
  if (axis.axis === 2) {
    const a = axis.nInterval?.min ?? (axis.primary === 'N' ? (axis.primaryPct ?? 0) : 0);
    const b = axis.primary === 'H' ? (axis.primaryPct ?? 0) : (axis.secondaryPct ?? 0);
    return { a, b };
  }
  const pct = axis.primaryPct ?? 0;
  const a = axis.primary === left ? pct : 100 - pct;
  return { a, b: 100 - a };
}

function interpText(text: TextFn, axis: TbtiAxis): string | null {
  if (axis.held || axis.primary === '?') {
    return null;
  }
  if (axis.chips.includes('similar') && axis.secondary !== null) {
    const a = axisWord(text, axis.primary);
    const b = axisWord(text, axis.secondary);
    return text('tbti.interpSimilar', { a, wa: josaGwaWa(a), b, ga: josaIGa(b) });
  }
  if (axis.axis === 2 && axis.primary === 'N' && axis.chips.includes('both_strong')) {
    return text('tbti.interpNBoth');
  }
  const key = INTERP_KEYS[axis.primary];
  return key === undefined ? null : text(key);
}

type Evidence = TbtiAxis extends { evidence: (infer E)[] } ? E : never;
type EvidenceMetric = Evidence extends { metric: infer M } ? M : never;

function metricLine(text: TextFn, metrics: AxisMetrics | null, map: GameNameMap): string | null {
  if (metrics === null) {
    return null;
  }
  switch (metrics.kind) {
    case 'ir':
      return text('tbti.metricIr', {
        judged: formatInt(metrics.judgedGames),
        i: formatInt(metrics.iGames),
        r: formatInt(metrics.rGames),
      });
    case 'nh': {
      // 묶음 이름 = 대표 게임(core representativeKey, 계약 v1.1.3)의 표시명. 정규화 bundleId는 쓰지 않는다.
      const bundles = metrics.bundles.map((bundle) =>
        text('tbti.metricNhBundle', {
          name: lookupName(map, bundle.representativeKey),
          games: formatInt(bundle.games),
          hours: formatHours(bundle.minutes),
        }),
      );
      const interval = text('tbti.metricNhInterval', {
        min: formatPct(metrics.nMin),
        max: formatPct(metrics.nMax),
      });
      const list = bundles.length > 0 ? text('tbti.metricNh', { list: bundles.join(DOT) }) : null;
      return [list, interval].filter((part): part is string => part !== null).join(DOT);
    }
    case 'oa':
      return text('tbti.metricOa', { g: formatInt(metrics.g), hhi: formatPct(metrics.hhi * 100) });
    case 'cl':
      return [
        text('tbti.metricClMedian', { hours: formatInt(metrics.medianHours) }),
        metrics.achMean === null ? null : text('tbti.metricClAch', { pct: formatPct(metrics.achMean) }),
        text('tbti.metricClQuit', { quit: formatInt(metrics.quitCount), denom: formatInt(metrics.quitDenom) }),
      ]
        .filter((part): part is string => part !== null)
        .join(DOT);
  }
}

/**
 * 근거 행 수치. ①축 개수는 태그 일치 수라 늘 1~2로 정보가 없어 싣지 않는다(F-31).
 * ③축 개수는 그 게임의 장르 수다.
 */
function statText(text: TextFn, axis: TbtiAxis['axis'], metric: EvidenceMetric): string | null {
  if (metric.unit === 'hours') return text('tbti.statHours', { n: formatInt(metric.value) });
  if (metric.unit === 'percent') return text('tbti.statPercent', { n: formatPct(metric.value) });
  if (axis === 1) return null;
  if (axis === 3) return text('tbti.statGenres', { n: formatInt(metric.value) });
  return text('tbti.statCount', { n: formatInt(metric.value) });
}

/** 근거 행 태그 — 그 게임이 4축에 귀속된 글자(core gameLetters, `?`·미정 null 제외). */
function tagFor(result: TbtiResult, key: GameKey): string {
  const row = result.gameLetters.find((entry) => gameMapKey(entry.key) === gameMapKey(key));
  if (row === undefined) return '';
  return row.letters
    .filter((letter): letter is AxisLetter => letter !== null && letter !== '?')
    .join(DOT);
}

function Notice({
  children,
  action,
}: {
  children: React.ReactNode;
  action?: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="tbti-notice">
      <div className="tbti-notice-text">
        <Info size={18} aria-hidden />
        <div>{children}</div>
      </div>
      {action ?? null}
    </div>
  );
}

/** 재수집 버튼 상태 — 대기·전송 중·시작됨·실패. */
const RETRY_IDLE = 0;
const RETRY_SENDING = 1;
const RETRY_STARTED = 2;
const RETRY_FAILED = 3;
type RetryState = 0 | 1 | 2 | 3;

/**
 * ④ 업적 안내(R15-11): off → 설정 토글 · priv(ACCESS_PRIVATE) → 업적만 재수집 · part → 버튼 없음 ·
 * 켜져 있는데 그 밖의 실패·미수집 → 사실대로 "아직 다 받지 못함"(F-28, 설정 링크 없음).
 */
function AchNotice({
  axis,
  achEnabled,
  achPrivSource,
}: {
  axis: TbtiAxis;
  achEnabled: boolean;
  achPrivSource: CollectSource | null;
}): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const [state, setState] = useState<RetryState>(RETRY_IDLE);
  async function retryAchievements(): Promise<void> {
    setState(RETRY_SENDING);
    try {
      const response = await fetch(`/api/sync/${achPrivSource}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      setState(response.ok ? RETRY_STARTED : RETRY_FAILED);
    } catch {
      setState(RETRY_FAILED);
    }
  }
  if (axis.chips.includes('ach_partial') && axis.achReflected !== undefined) {
    const { got, of } = axis.achReflected;
    return <Notice>{text('tbti.achPart', { got: formatInt(got), rest: formatInt(of - got) })}</Notice>;
  }
  if (!axis.chips.includes('ach_not_reflected')) {
    return null;
  }
  if (!achEnabled) {
    return (
      <Notice
        action={
          <Link href="/settings" className="tbti-notice-btn">
            {text('tbti.achOffBtn')}
          </Link>
        }
      >
        {text('tbti.achOff')}
      </Notice>
    );
  }
  if (achPrivSource !== null) {
    return (
      <Notice
        action={
          <button
            type="button"
            className="tbti-notice-btn"
            disabled={state === RETRY_SENDING || state === RETRY_STARTED}
            onClick={() => void retryAchievements()}
          >
            {text('tbti.achPrivBtn')}
          </button>
        }
      >
        {text('tbti.achPriv')}
        {state === RETRY_STARTED ? (
          <span className="tbti-notice-sub" role="status">
            {text('tbti.achRetryStarted')}
          </span>
        ) : null}
        {state === RETRY_FAILED ? (
          <span className="tbti-notice-sub" role="alert">
            {text('tbti.achRetryFailed')}
          </span>
        ) : null}
      </Notice>
    );
  }
  return <Notice>{text('tbti.achPending')}</Notice>;
}

function Meter({ axis }: { axis: TbtiAxis }): React.JSX.Element {
  const { text } = useLocale();
  const left = LEFT_LETTER[axis.axis];
  const right = RIGHT_LETTER[axis.axis];
  const held = axis.held || axis.primary === '?';
  const { a, b } = meterWidths(axis);
  const leftStrong = !held && axis.primary === left;
  const rightStrong = !held && axis.primary === right;
  const heldReason = text(axis.heldReasonKey === 'interval_cross' ? 'tbti.heldCross' : 'tbti.heldShort');
  // 접근성(F-24·DoD 화면8): 수치는 정수, 보류면 사유를 aria-label에.
  const label = held
    ? text('tbti.heldAria', { axis: text(AXIS_NAMES[axis.axis]), reason: heldReason })
    : text('tbti.meterText', {
        w0: axisWord(text, left),
        p0: formatPct(a),
        w1: axisWord(text, right),
        p1: formatPct(b),
      });
  return (
    <div
      className="tbti-meter"
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={held ? 0 : Math.round(axis.primaryPct ?? 0)}
    >
      <span className={leftStrong ? 'tbti-end' : 'tbti-end tbti-end--weak'} aria-hidden="true">
        <span className="tbti-end-letter">{left}</span>
        <span className="tbti-end-word">{axisWord(text, left)}</span>
      </span>
      {held ? (
        <span className="tbti-track tbti-track--held" aria-hidden="true">
          <span className="tbti-q">{text('tbti.axisQ')}</span>
        </span>
      ) : (
        <span className="tbti-track" aria-hidden="true">
          <span
            className={leftStrong ? 'tbti-fill-a tbti-fill--on' : 'tbti-fill-a'}
            style={{ width: `${Math.max(0, Math.min(100, a))}%` }}
          />
          <span
            className={rightStrong ? 'tbti-fill-b tbti-fill--on' : 'tbti-fill-b'}
            style={{ width: `${Math.max(0, Math.min(100, b))}%` }}
          />
          <span className="tbti-mid" />
        </span>
      )}
      <span className={rightStrong ? 'tbti-end tbti-end--r' : 'tbti-end tbti-end--r tbti-end--weak'} aria-hidden="true">
        <span className="tbti-end-word">{axisWord(text, right)}</span>
        <span className="tbti-end-letter">{right}</span>
      </span>
    </div>
  );
}

function AxisCard({
  axis,
  result,
  map,
  achEnabled,
  achPrivSource,
}: {
  axis: TbtiAxis;
  result: TbtiResult;
  map: GameNameMap;
  achEnabled: boolean;
  achPrivSource: CollectSource | null;
}): React.JSX.Element {
  const { text } = useLocale();
  const [open, setOpen] = useState(false);
  const held = axis.held || axis.primary === '?';
  const heldReason = text(axis.heldReasonKey === 'interval_cross' ? 'tbti.heldCross' : 'tbti.heldShort');
  const interp = interpText(text, axis);
  const metric = metricLine(text, axis.metrics, map);
  const baselineKey =
    axis.baselineTextKey !== null ? BASELINE_TEXT_KEYS[axis.baselineTextKey] : undefined;
  // 보류 ②축은 구간·H 병기를 사유 아래 작은 줄로 남긴다(F-15, O10).
  const heldSub =
    held && axis.axis === 2
      ? [
          axis.nInterval !== null
            ? text('tbti.metricNhInterval', {
                min: formatPct(axis.nInterval.min),
                max: formatPct(axis.nInterval.max),
              })
            : null,
          axis.secondary === 'H' && axis.secondaryPct !== null
            ? text('tbti.homeShare', { pct: formatPct(axis.secondaryPct) })
            : null,
        ]
          .filter((part): part is string => part !== null)
          .join(DOT)
      : '';
  const name = text(AXIS_NAMES[axis.axis]);
  return (
    <section className="tbti-axis" aria-label={`${AXIS_NUMS[axis.axis]} ${name}`}>
      <div className="tbti-axis-head">
        <span className="tbti-axis-name">
          {AXIS_NUMS[axis.axis]} {name}
        </span>
        {axis.chips.includes('similar') ? <Chip label={text('tbti.chipSimilar')} /> : null}
        {axis.chips.includes('both_strong') ? <Chip label={text('tbti.chipBoth')} /> : null}
        {axis.chips.includes('ach_not_reflected') ? <Chip label={text('tbti.chipAchOff')} /> : null}
        {axis.chips.includes('ach_partial') && axis.achReflected !== undefined ? (
          <Chip
            label={text('tbti.chipAchPart', {
              got: formatInt(axis.achReflected.got),
              of: formatInt(axis.achReflected.of),
            })}
          />
        ) : null}
        <span className={held ? 'tbti-axis-score tbti-axis-score--held' : 'tbti-axis-score'}>
          {scoreLabel(text, axis)}
        </span>
      </div>
      <Meter axis={axis} />
      {held ? (
        <p className="tbti-axis-text">
          {heldReason}
          {heldSub !== '' ? <span className="tbti-axis-subline">{heldSub}</span> : null}
        </p>
      ) : interp !== null ? (
        <p className="tbti-axis-text">{interp}</p>
      ) : null}
      <div className="tbti-why">
        <button
          type="button"
          className="tbti-why-btn"
          aria-expanded={open}
          onClick={() => setOpen((value) => !value)}
        >
          <MagnifyingGlass size={14} aria-hidden className="tbti-why-icon" />
          <span>{text('tbti.whyToggle')}</span>
          <CaretDown size={14} aria-hidden className="tbti-caret" />
        </button>
        {open ? (
          <div className="tbti-evidence">
            {axis.axis === 4 ? (
              <AchNotice axis={axis} achEnabled={achEnabled} achPrivSource={achPrivSource} />
            ) : null}
            {axis.axis === 2 && result.aliasStatus === 'broken' ? (
              <Notice>{text('tbti.aliasBroken')}</Notice>
            ) : null}
            {metric !== null ? <p className="tbti-metric">{metric}</p> : null}
            {baselineKey !== undefined ? (
              <p className="tbti-baseline">{text('tbti.baselineRef', { t: text(baselineKey) })}</p>
            ) : null}
            {axis.evidence.length > 0 ? (
              <ul className="tbti-rows">
                {axis.evidence.map((row) => {
                  const cover = lookupCover(map, row.key);
                  const tag = tagFor(result, row.key);
                  const stat = statText(text, axis.axis, row.metric);
                  return (
                    <li key={gameMapKey(row.key)} className="tbti-row">
                      {cover !== null ? (
                        <img className="tbti-cover" src={cover} alt="" />
                      ) : (
                        <span className="tbti-cover tbti-cover--empty" aria-hidden="true" />
                      )}
                      <span className="tbti-row-main">
                        <span className="tbti-row-name">{lookupName(map, row.key)}</span>
                        {stat !== null ? <span className="tbti-row-stat">{stat}</span> : null}
                        <span className="tbti-row-why">
                          {REASON_TEXT_KEYS[row.reasonKey] !== undefined
                            ? text(REASON_TEXT_KEYS[row.reasonKey] as TextKey)
                            : ''}
                        </span>
                      </span>
                      <span className="tbti-row-tag">{tag}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {axis.excludedCount > 0 ? (
              <p className="tbti-foot">
                {text('tbti.excludedNote', { n: formatInt(axis.excludedCount) })}
              </p>
            ) : null}
            {axis.caveats.length > 0 ? (
              <ul className="tbti-caveats">
                {axis.caveats.map((caveat) => (
                  <li key={caveat.code} className="tbti-caveat">
                    {text(CAVEAT_KEYS[caveat.code])}
                    {caveat.code === 'ach_partial' && axis.achReflected !== undefined ? (
                      // 부분 반영은 got/of 둘 다(F-30, 계약 R15-4).
                      <span className="tbti-caveat-num">
                        {formatInt(axis.achReflected.got)}/{formatInt(axis.achReflected.of)}
                      </span>
                    ) : caveat.count !== null ? (
                      <span className="tbti-caveat-num">
                        {formatCaveatCount(caveat.code, caveat.count)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

const BODY_ITEMS: { title: TextKey; field: 'representativeGame' | 'slip' | 'empathy' | 'ensemble' }[] = [
  { title: 'tbti.bodyFit', field: 'representativeGame' },
  { title: 'tbti.bodySlip', field: 'slip' },
  { title: 'tbti.bodyEmpathy', field: 'empathy' },
  { title: 'tbti.bodyEnsemble', field: 'ensemble' },
];

/** 본문 칸 한 줄 나누기 — 이름 데이터는 ` / `로 항목을 잇는다(R15-8). */
const BODY_SEPARATOR = ' / ';

/**
 * 본문 아코디언(+/−). ko는 이름 데이터 본문, en은 본문 영역을 숨기고 고지 한 줄(R15-11 A 확정, F-29).
 * 16유형이 아닌 코드(부분 `?`)는 본문이 없어 영역을 두지 않는다.
 */
function BodyAccordion({ result }: { result: TbtiResult }): React.JSX.Element | null {
  const { locale, text } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  if (!isTbtiCode(result.code)) {
    return null;
  }
  if (locale !== 'ko') {
    return <p className="tbti-body-note">{text('tbti.bodyPending')}</p>;
  }
  const body = TBTI_NAMES[result.code].ko.body;
  const items = BODY_ITEMS.filter((item) => body[item.field] !== '');
  if (items.length === 0) {
    return null;
  }
  return (
    <div className="tbti-body">
      {items.map((item, index) => {
        const open = openIndex === index;
        const Icon = open ? Minus : Plus;
        return (
          <div key={item.title} className="tbti-acc">
            <button
              type="button"
              className="tbti-acc-btn"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : index)}
            >
              <span>{text(item.title)}</span>
              <Icon size={16} aria-hidden className="tbti-acc-icon" />
            </button>
            {open ? (
              <ul className="tbti-acc-list">
                {body[item.field].split(BODY_SEPARATOR).map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ResultCaveats({ result }: { result: TbtiResult }): React.JSX.Element | null {
  const { text } = useLocale();
  const [open, setOpen] = useState(false);
  if (result.caveats.length === 0) {
    return null;
  }
  return (
    <div className="tbti-source">
      <button
        type="button"
        className="tbti-source-btn"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        <Info size={14} aria-hidden />
        <span>{text('recap.sourceLine')}</span>
        <CaretDown size={14} aria-hidden className="tbti-caret" />
      </button>
      {open ? (
        <ul className="tbti-caveats">
          {result.caveats.map((caveat) => (
            <li key={caveat.code} className="tbti-caveat">
              {text(CAVEAT_KEYS[caveat.code])}
              {caveat.count !== null ? (
                <span className="tbti-caveat-num">{formatCaveatCount(caveat.code, caveat.count)}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function TbtiView({
  result,
  recap,
  map,
  achEnabled = true,
  achPrivSource = null,
}: {
  result: TbtiResult;
  recap: LibraryRecap | null;
  map: GameNameMap;
  /** 업적 수집 켜짐 여부 — GET /api/settings/achievements 출처(라우트 전달). */
  achEnabled?: boolean;
  /** 업적 소스 실패 ACCESS_PRIVATE — GET /api/sync/status 출처(라우트 전달). */
  achPrivSource?: CollectSource | null;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [shareOpen, setShareOpen] = useState(false);
  if (result.pending) {
    return (
      <main data-route="tbti">
        <div className="tbti-page">
          <TbtiPendingCard
            summary={{
              code: result.code,
              pending: true,
              letters: ['?', '?', '?', '?'],
              mini: [
                { axis: 1, pct: null },
                { axis: 2, pct: null },
                { axis: 3, pct: null },
                { axis: 4, pct: null },
              ],
            }}
            compact={false}
            link={false}
            pendingHours={result.pendingHours}
          />
          <ResultCaveats result={result} />
        </div>
      </main>
    );
  }
  const closing =
    locale === 'ko' && isTbtiCode(result.code) ? TBTI_NAMES[result.code].ko.body.closing : '';
  return (
    <main data-route="tbti">
      <div className="tbti-page">
        <FrontCard result={result} />
        <FrontNote result={result} />
        <div className="tbti-axes">
          {[...result.axes]
            .sort((a, b) => a.axis - b.axis)
            .map((axis) => (
              <AxisCard
                key={axis.axis}
                axis={axis}
                result={result}
                map={map}
                achEnabled={achEnabled}
                achPrivSource={achPrivSource}
              />
            ))}
        </div>
        <BodyAccordion result={result} />
        <div className="tbti-foot-share">
          {closing !== '' ? <p className="tbti-closing">{closing}</p> : null}
          <button type="button" className="tbti-share-btn" onClick={() => setShareOpen(true)}>
            <ShareFat size={16} aria-hidden />
            {text('tbti.shareBtn')}
          </button>
        </div>
        <ResultCaveats result={result} />
      </div>
      {shareOpen ? (
        <ShareSheet hasRecap={recap !== null} onClose={() => setShareOpen(false)} />
      ) : null}
    </main>
  );
}
