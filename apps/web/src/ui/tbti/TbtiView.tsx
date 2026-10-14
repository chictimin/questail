/**
 * U4 TBTI 8a — 세로 흐름 · 축 카드마다 「왜 이 글자인가」 접기 · 본문 아코디언.
 * 8c(전체 보류)는 보류 카드로 대체, 8d(축 ?)는 점수 자리에 "판정 보류"+사유 한 줄.
 * 컴포넌트는 판정 출력 props로 받는다. 데이터 읽기는 routes/tbti.tsx가 맡는다.
 * 결과 caveats는 계약 v1.0.3 공통 4종만 든다(리캡 섹션 코드는 LibraryRecap 쪽).
 */
import { useState } from 'react';
import { Link } from 'wouter';
import type {
  AxisLetter,
  Caveat,
  LibraryRecap,
  TbtiAxis,
  TbtiResult,
} from '@questail/core';
import {
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
  TBTI_BASELINE_IMC2016_TEXT_KEY,
} from '@questail/core';
import type { CollectSource } from '../../data/sync.js';
import { TBTI_NAMES, type TbtiCode } from '../../data/tbtiNames.js';
import { useLocale } from '../i18n/context.js';
import {
  formatCaveatCount,
  formatInt,
  formatPct,
} from '../../shared/format.js';
import { lookupCover, lookupName } from '../r15/names.js';
import type { GameNameMap } from '../r15/names.js';
import { TbtiPendingCard } from './pending.js';
import { ShareSheet } from '../share/ShareSheet.js';
import logoUrl from '../../assets/logo-mark.png';
import './tbti.css';

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

type TextKey = Parameters<ReturnType<typeof useLocale>['text']>[0];

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

const LEFT_LETTER: Record<TbtiAxis['axis'], AxisLetter> = {
  1: 'I',
  2: 'N',
  3: 'O',
  4: 'C',
};

/**
 * core baselineTextKey(계약 키, 실값 tbti.baseline.imc2016.text — core constants.ts)는
 * t()가 한 번만 나누므로 그대로 풀지 못한다. 아는 키만 사전 키로 옮기고,
 * 표에 없는 키는 줄을 그리지 않는다(원키 노출 0, F-06).
 */
const BASELINE_TEXT_KEYS: Record<string, TextKey> = {
  [TBTI_BASELINE_IMC2016_TEXT_KEY]: 'tbti.baselineImc2016',
};

/**
 * core reasonKey(점이 3개인 판정 키, 예 tbti.reason.ir.i_only)는
 * t()가 두 조각만 풀므로 사전 키로 옮긴다. 값 목록 출처 =
 * packages/core/src/tbti/judge.ts TBTI_REASON_* 상수 12개(읽기 전용).
 * 표에 없는 키는 원키 그대로 두어 i18n 감사 테스트가 잡는다.
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

const CAVEAT_KEYS: Record<Caveat['code'], TextKey> = {  observation_days: 'recap.caveatObservationDays',
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

function axisWord(text: (key: TextKey) => string, letter: AxisLetter): string {
  return text(AXIS_WORDS[letter]);
}

function FrontCard({ result }: { result: TbtiResult }): React.JSX.Element {
  const { locale, text } = useLocale();
  const entry = isTbtiCode(result.code) ? TBTI_NAMES[result.code] : null;
  const nickname =
    entry === null ? '' : locale === 'ko' ? entry.ko.title : entry.en.title;
  const definition =
    entry === null
      ? ''
      : locale === 'ko' ? entry.ko.body.definition : entry.en.body.definition;
  const words = result.axes.map((axis) => axisWord(text, axis.primary));
  const second = result.axes[1];
  const homePct =
    second !== undefined &&
    second.secondary === 'H' &&
    second.secondaryPct !== null
      ? second.secondaryPct
      : null;
  const homeLine =
    homePct === null || second === undefined
      ? null
      : second.primary === 'N'
        ? text('tbti.homeShare', { pct: formatInt(homePct) })
        : text('tbti.seriesReplay', { pct: formatInt(homePct) });
  const days =
    result.caveats.find((caveat) => caveat.code === 'observation_days')?.count ?? 0;
  return (
    <section className="tbti-front" aria-label={text('tbti.myTbti')}>
      {nickname !== '' ? (
        <p className="tbti-code">{result.code}</p>
      ) : null}
      <p className="tbti-axisline">
        {words.join(' · ')}
        {homeLine !== null ? ` — ${homeLine}` : ''}
      </p>
      <img className="tbti-symbol" src={logoUrl} alt="" />
      {nickname !== '' ? (
        <h1 className="tbti-name">{nickname}</h1>
      ) : (
        <h1 className="tbti-code">{result.code}</h1>
      )}
      {definition !== '' ? <p className="tbti-def">{definition}</p> : null}
      <p className="tbti-note">
        {text('tbti.frontNote', { days: formatInt(days) })}
      </p>
    </section>
  );
}

function Chip({ kind }: { kind: TextKey | { part: { got: number; of: number } } }): React.JSX.Element {
  const { locale, text } = useLocale();
  if (typeof kind === 'object') {
    const label = text('tbti.chipAchPart', {
      got: formatInt(kind.part.got),
      of: formatInt(kind.part.of),
    });
    return (
      <span className="tbti-chip" aria-label={label}>
        {label}
      </span>
    );
  }
  const label = text(kind);
  return (
    <span className="tbti-chip" aria-label={label}>
      {label}
    </span>
  );
}

function MetricText({ value, unit }: { value: number; unit: 'hours' | 'percent' | 'count' }): React.JSX.Element {
  const { locale, text } = useLocale();
  if (unit === 'hours') {
    return (
      <span>
        {formatInt(value)}
        {text('tbti.unitHours')}
      </span>
    );
  }
  if (unit === 'percent') {
    return (
      <span>
        {formatPct(value)}
        {text('tbti.unitPercent')}
      </span>
    );
  }
  return (
    <span>
      {formatInt(value)}
      {text('tbti.unitCount')}
    </span>
  );
}

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
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  async function retryAchievements(): Promise<void> {
    setSending(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/sync/${achPrivSource}/retry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ locale }),
      });
      if (!response.ok) {
        throw new Error(`[web] 재수집 실패: ${response.status}`);
      }
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }
  if (axis.chips.includes('ach_partial') && axis.achReflected !== undefined) {
    const { got, of } = axis.achReflected;
    return (
      <p className="tbti-ach">
        {text('tbti.achPart', {
          got: got,
          rest: of - got,
        })}
      </p>
    );
  }
  if (axis.chips.includes('ach_not_reflected')) {
    // priv = 업적 소스 실패 ACCESS_PRIVATE(수집 상태 출처) →
    // 업적 소스만 재수집(R1 resyncSource 경로).
    if (achEnabled && achPrivSource !== null) {
      return (
        <div className="tbti-ach">
          <p className="tbti-ach-text">{text('tbti.achPriv')}</p>
          <button
            type="button"
            className="tbti-ach-go"
            disabled={sending}
            onClick={() => void retryAchievements()}
          >
            {text('tbti.achPrivBtn')}
          </button>
          {failed ? (
            <p className="tbti-ach-text" role="alert">
              {text('library.loadFailed')}
            </p>
          ) : null}
        </div>
      );
    }
    // off = 업적 수집 꺼짐(설정 토글 출처). 그 외 잔여(그 외 실패·미수집)는
    // 기존 동작대로 off 처리한다.
    return (
      <div className="tbti-ach">
        <p className="tbti-ach-text">{text('tbti.achOff')}</p>
        <Link href="/settings" className="tbti-ach-go">
          {text('tbti.achOffBtn')}
        </Link>
      </div>
    );
  }
  return null;
}

function AxisCard({
  axis,
  map,
  achEnabled,
  achPrivSource,
}: {
  axis: TbtiAxis;
  map: GameNameMap;
  achEnabled: boolean;
  achPrivSource: CollectSource | null;
}): React.JSX.Element {
  const { locale, text } = useLocale();
  const [open, setOpen] = useState(false);
  const heldReason = text(
    axis.heldReasonKey === 'interval_cross'
      ? 'tbti.heldCross'
      : 'tbti.heldShort',
  );
  const left = LEFT_LETTER[axis.axis];
  const held = axis.held || axis.primary === '?';
  const leftPct =
    axis.axis === 2
      ? (axis.nInterval !== null ? axis.nInterval.min : axis.primaryPct)
      : axis.primary === left
        ? axis.primaryPct
        : axis.secondaryPct;
  const rightPct =
    axis.axis === 2
      ? (axis.secondary === 'H' ? axis.secondaryPct : null)
      : axis.primary === left
        ? axis.secondaryPct
        : axis.primaryPct;
  const leftStrong =
    !held &&
    leftPct !== null &&
    (rightPct === null || leftPct >= rightPct);
  const rightStrong =
    !held &&
    rightPct !== null &&
    (leftPct === null || rightPct > leftPct);
  const meterLabel =
    axis.secondary !== null && axis.secondaryPct !== null
      ? text('tbti.meterText', {
          w0: axisWord(text, axis.primary),
          p0: axis.primaryPct !== null ? formatPct(axis.primaryPct) : '?',
          w1: axisWord(text, axis.secondary),
          p1: formatPct(axis.secondaryPct),
        })
      : axis.primaryPct !== null
        ? `${axisWord(text, axis.primary)} ${formatPct(axis.primaryPct)}%`
        : axisWord(text, axis.primary);
  return (
    <section className="tbti-axis" aria-label={text(AXIS_NAMES[axis.axis])}>
      <div className="tbti-axis-head">
        <p className="tbti-axis-name">{text(AXIS_NAMES[axis.axis])}</p>
        {held ? (
          <p className="tbti-axis-score">{text('tbti.heldTitle')}</p>
        ) : (
          <p className="tbti-axis-score">
            {axis.primary}{' '}
            {axis.primaryPct !== null
              ? `${formatPct(axis.primaryPct)}${text('tbti.unitPercent')}`
              : '?'}
          </p>
        )}
        <div className="tbti-chips">
          {axis.chips.includes('similar') ? <Chip kind="tbti.chipSimilar" /> : null}
          {axis.chips.includes('both_strong') ? <Chip kind="tbti.chipBoth" /> : null}
          {axis.chips.includes('ach_not_reflected') ? <Chip kind="tbti.chipAchOff" /> : null}
          {axis.chips.includes('ach_partial') && axis.achReflected !== undefined ? (
            <Chip kind={{ part: axis.achReflected }} />
          ) : null}
        </div>
      </div>
      <div
        className="tbti-meter"
        role="meter"
        aria-label={meterLabel}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={axis.primaryPct !== null ? Math.round(axis.primaryPct) : 0}
      >
        {held ? (
          <span className="tbti-meter-held" aria-label={heldReason}>
            {text('tbti.axisQ')}
          </span>
        ) : (
          <span className="tbti-meter-track">
            <span
              className={
                leftStrong
                  ? 'tbti-meter-left tbti-meter-left--strong'
                  : 'tbti-meter-left'
              }
              style={{ width: `${leftPct ?? 0}%` }}
            />
            <span className="tbti-meter-mid" />
            <span
              className={
                rightStrong
                  ? 'tbti-meter-right tbti-meter-right--strong'
                  : 'tbti-meter-right'
              }
              style={{ width: `${rightPct ?? 0}%` }}
            />
          </span>
        )}
      </div>
      {held ? <p className="tbti-held">{heldReason}</p> : null}
      {!held && axis.axis === 2 && axis.secondary !== null && axis.secondaryPct !== null ? (
        <p className="tbti-sub">
          {axis.primary === 'N'
            ? `${axisWord(text, axis.secondary)} ${formatPct(axis.secondaryPct)}%`
            : text('tbti.seriesReplay', {
                pct: formatInt(axis.secondaryPct),
              })}
        </p>
      ) : null}
      {!held && axis.axis !== 2 && axis.secondary !== null && axis.secondaryPct !== null ? (
        <p className="tbti-sub">
          {axisWord(text, axis.secondary)} {formatPct(axis.secondaryPct)}
          {text('tbti.unitPercent')}
        </p>
      ) : null}
      <button
        type="button"
        className="tbti-why"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
      >
        {text('tbti.whyToggle')}
      </button>
      {open ? (
        <div className="tbti-evidence">
          {axis.axis === 4 ? (
            <AchNotice
              axis={axis}
              achEnabled={achEnabled}
              achPrivSource={achPrivSource}
            />
          ) : null}
          {axis.axis === 2 && axis.nInterval !== null ? (
            <p className="tbti-metric">
              N {formatPct(axis.nInterval.min)}~{formatPct(axis.nInterval.max)}
              {text('tbti.unitPercent')}
            </p>
          ) : null}
          {axis.baselineTextKey !== null &&
          BASELINE_TEXT_KEYS[axis.baselineTextKey] !== undefined ? (
            <p className="tbti-baseline">
              {text('tbti.baselineRef', {
                t: text(BASELINE_TEXT_KEYS[axis.baselineTextKey]),
              })}
            </p>
          ) : null}
          <ul className="tbti-rows">
            {axis.evidence.map((row) => {
              const cover = lookupCover(map, row.key);
              return (
                <li
                  key={`${row.key.platform}/${row.key.externalId}`}
                  className="tbti-row"
                >
                  {cover !== null ? (
                    <img className="tbti-cover" src={cover} alt="" />
                  ) : (
                    <span className="game-cover game-cover--empty" aria-hidden="true" />
                  )}
                  <span className="tbti-row-main">
                    <span className="tbti-row-name">{lookupName(map, row.key)}</span>
                    <span className="tbti-row-reason">
                      {text(
                        REASON_TEXT_KEYS[row.reasonKey] ??
                          (row.reasonKey as TextKey),
                      )}
                    </span>
                  </span>
                  <span className="tbti-row-metric">
                    <MetricText value={row.metric.value} unit={row.metric.unit} />
                  </span>
                </li>
              );
            })}
          </ul>
          {axis.excludedCount > 0 ? (
            <p className="tbti-excluded">
              {text('tbti.excludedNote', {
                n: formatInt(axis.excludedCount),
              })}
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
    </section>
  );
}

const BODY_ITEMS: { title: TextKey; field: 'representativeGame' | 'slip' | 'empathy' | 'ensemble' }[] = [
  { title: 'tbti.bodyFit', field: 'representativeGame' },
  { title: 'tbti.bodySlip', field: 'slip' },
  { title: 'tbti.bodyEmpathy', field: 'empathy' },
  { title: 'tbti.bodyEnsemble', field: 'ensemble' },
];

function BodyAccordion({ result }: { result: TbtiResult }): React.JSX.Element {
  const { locale, text } = useLocale();
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const entry = isTbtiCode(result.code) ? TBTI_NAMES[result.code] : null;
  const body = locale === 'ko' ? entry?.ko.body : entry?.en.body;
  return (
    <div className="tbti-body">
      {BODY_ITEMS.map((item, index) => {
        const content = body?.[item.field] ?? '';
        const open = openIndex === index;
        return (
          <div key={item.title} className="tbti-acc">
            <button
              type="button"
              className="tbti-acc-btn"
              aria-expanded={open}
              onClick={() => setOpenIndex(open ? null : index)}
            >
              {text(item.title)}
            </button>
            {open ? (
              content !== '' ? (
                <p className="tbti-acc-text">{content}</p>
              ) : (
                <p className="tbti-acc-text tbti-acc-pending">
                  {text('tbti.bodyPending')}
                </p>
              )
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function ResultCaveats({ result }: { result: TbtiResult }): React.JSX.Element | null {
  const { locale, text } = useLocale();
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
        {text('recap.sourceLine')}
      </button>
      {open ? (
        <ul className="tbti-caveats">
          {result.caveats.map((caveat) => (
            <li key={caveat.code} className="tbti-caveat">
              {text(CAVEAT_KEYS[caveat.code])}
              {caveat.count !== null ? (
                <span className="tbti-caveat-num">
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
  const { text } = useLocale();
  const [shareOpen, setShareOpen] = useState(false);
  if (result.pending) {
    return (
      <main data-route="tbti">
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
          pendingHours={result.pendingHours}
        />
        <ResultCaveats result={result} />
      </main>
    );
  }
  return (
    <main data-route="tbti">
      <FrontCard result={result} />
      <div className="tbti-axes">
        {result.axes.map((axis) => (
          <AxisCard
            key={axis.axis}
            axis={axis}
            map={map}
            achEnabled={achEnabled}
            achPrivSource={achPrivSource}
          />
        ))}
      </div>
      <BodyAccordion result={result} />
      <div className="tbti-foot">
        <button
          type="button"
          className="tbti-share-btn"
          onClick={() => setShareOpen(true)}
        >
          {text('tbti.shareBtn')}
        </button>
      </div>
      <ResultCaveats result={result} />
      {shareOpen ? (
        <ShareSheet
          result={result}
          recap={recap}
          map={map}
          onClose={() => setShareOpen(false)}
        />
      ) : null}
    </main>
  );
}
