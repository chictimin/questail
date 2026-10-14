/**
 * S3 TBTI 공유 텍스트 렌더 — 디자인 10a 미리보기 형식(ko 그대로).
 * en은 PM #109421 결정대로: 한국어 카드 본문(앞 문구·호칭·정의) 제외,
 * `My TBTI is {code}` + 축 수치 줄(영어 축 이름) + 업적 미반영 줄(해당 시) +
 * 관측 줄 + questail. 영어 별명(구안)은 예시값이라 쓰지 않는다.
 * 문구는 서버 i18n 사전으로 렌더한다. 카드 본문 ko 정의는 이름 데이터에서 읽는다.
 *
 * 가정(리뷰에서 확정):
 * - 축 약칭 ko: 몰입·런·신작·본진·원툴·잡식·파먹기·찍먹(10a + SPEC C1~C4),
 *   en: SPEC 영문 풀이(Immersion·Run·New·Home·One-trick·All-rounder·Completionist·Light taster).
 * - 병기 `(본진 비중 n%)`는 ②축 전용(R15-5 ② 분기표) — ①③④ secondary가 와도 찍지 않는다.
 * - 업적 줄은 ④축 chips에 ach_not_reflected가 있을 때만(ach_partial은 제외).
 * - 관측 일수는 result caveats의 observation_days count(없으면 0).
 * - pct null(보류·`)은 '?'로 찍는다. 보류 공유는 보류 안내 줄을 쓴다.
 */
import type { AxisLetter, TbtiAxis, TbtiResult } from '@questail/core';
import { t, type Locale } from '../ui/i18n/index.js';
import { TBTI_NAMES, type TbtiCode } from './tbtiNames.js';

function axisName(locale: Locale, letter: AxisLetter): string {
  switch (letter) {
    case 'I': return t(locale, 'tbti.axisI');
    case 'R': return t(locale, 'tbti.axisR');
    case 'N': return t(locale, 'tbti.axisN');
    case 'H': return t(locale, 'tbti.axisH');
    case 'O': return t(locale, 'tbti.axisO');
    case 'A': return t(locale, 'tbti.axisA');
    case 'C': return t(locale, 'tbti.axisC');
    case 'L': return t(locale, 'tbti.axisL');
    case '?': return t(locale, 'tbti.axisQ');
  }
}

function pctText(pct: number | null): string {
  return pct === null ? '?' : String(pct);
}

/** 축 1개 수치 조각. ②축만 secondary 병기를 단다(가정). */
function axisSegment(locale: Locale, axis: TbtiAxis): string {
  const head = `${axisName(locale, axis.primary)} ${pctText(axis.primaryPct)}%`;
  if (axis.axis === 2 && axis.secondary !== null && axis.secondaryPct !== null) {
    const tail =
      locale === 'ko'
        ? `(${axisName(locale, axis.secondary)} 비중 ${axis.secondaryPct}%)`
        : ` (${axisName(locale, axis.secondary)} ${axis.secondaryPct}%)`;
    return `${head}${tail}`;
  }
  return head;
}

function observedDays(result: TbtiResult): number {
  return result.caveats.find((caveat) => caveat.code === 'observation_days')?.count ?? 0;
}

function isTbtiCode(code: string): code is TbtiCode {
  return code in TBTI_NAMES;
}

/**
 * 10a 미리보기 텍스트. 보류(pending)면 코드 ???? + 보류 안내 줄이다(R22).
 * en에는 한국어 문자열이 들어가지 않는다(PM #109421).
 */
export function renderTbtiShare(result: TbtiResult, locale: Locale): string {
  const days = observedDays(result);
  const tail = `${t(locale, 'tbti.observed', { days })} · questail`;
  if (result.pending) {
    return [
      t(locale, 'tbti.sharePendingTitle'),
      t(locale, 'tbti.sharePendingNote'),
      tail,
    ].join('\n');
  }
  const axes = [...result.axes].sort((a, b) => a.axis - b.axis);
  // ko 정의 줄은 이름 데이터 실값 — 비어 있으면 줄 자체를 두지 않는다(빈 줄 금지).
  const lines = [
    locale === 'ko' && isTbtiCode(result.code)
      ? t(locale, 'tbti.shareTitle', { code: result.code, title: TBTI_NAMES[result.code].ko.title })
      : t(locale, 'tbti.shareTitle', { code: result.code }),
  ];
  if (locale === 'ko') {
    const definition = isTbtiCode(result.code) ? TBTI_NAMES[result.code].ko.body.definition : '';
    if (definition !== '') {
      lines.push(definition);
    }
  }
  lines.push(axes.map((axis) => axisSegment(locale, axis)).join(' · '));
  const fourth = axes.find((axis) => axis.axis === 4);
  if (fourth !== undefined && fourth.chips.includes('ach_not_reflected')) {
    lines.push(t(locale, 'tbti.achOnly', { axis: axisName(locale, fourth.primary) }));
  }
  lines.push(tail);
  return lines.join('\n');
}
