/**
 * U4 화면 검증용 계약 형태 픽스처 — TbtiResult 실타입. 값은 CONCEPT B(INAC
 * 예시 걷기) 계열의 예시값으로, 판정 mere illustration이다(경계 근거 아님).
 * result.caveats는 계약 v1.0.3 공통 4종만 든다(축별 caveats는 그대로).
 * 앱에 미리보기 경로를 두지 않고 Playwright route 가로채기로 /api/tbti에 넣는다.
 */
import type { Caveat, TbtiAxis, TbtiResult } from '@questail/core';

const COMMON_CAVEATS: Caveat[] = [
  { code: 'observation_days', count: 2 },
  { code: 'hidden_excluded', count: 3 },
  { code: 'outside_steam_missing', count: null },
  { code: 'server_record_basis', count: null },
];

function axis1(): TbtiAxis {
  return {
    axis: 1,
    primary: 'I',
    primaryPct: 83,
    secondary: 'R',
    secondaryPct: 17,
    chips: [],
    evidence: [
      {
        key: { platform: 'steam', externalId: 'wilds-2025' },
        metric: { value: 921.9, unit: 'hours' },
        reasonKey: 'tbti.reason.ir.i_only',
      },
      {
        key: { platform: 'steam', externalId: 'bg3' },
        metric: { value: 303.3, unit: 'hours' },
        reasonKey: 'tbti.reason.ir.i_only',
      },
      {
        key: { platform: 'steam', externalId: 'zomboid' },
        metric: { value: 300.9, unit: 'hours' },
        reasonKey: 'tbti.reason.ir.i_only',
      },
      {
        key: { platform: 'steam', externalId: 'spire2' },
        metric: { value: 199.5, unit: 'hours' },
        reasonKey: 'tbti.reason.ir.i_only',
      },
      {
        key: { platform: 'steam', externalId: 'isaac' },
        metric: { value: 224.4, unit: 'hours' },
        reasonKey: 'tbti.reason.ir.i_only',
      },
    ],
    excludedCount: 22,
    held: false,
    heldReasonKey: null,
    nInterval: null,
    caveats: [{ code: 'tag_uncollected', count: 22 }],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
  };
}

function axis2(): TbtiAxis {
  return {
    axis: 2,
    primary: 'N',
    primaryPct: 60,
    secondary: 'H',
    secondaryPct: 34,
    chips: ['both_strong'],
    evidence: [
      {
        key: { platform: 'steam', externalId: 'wilds-2025' },
        metric: { value: 956.0, unit: 'hours' },
        reasonKey: 'tbti.reason.nh.confirmed_snapshot',
      },
      {
        key: { platform: 'steam', externalId: 'spire2' },
        metric: { value: 382.0, unit: 'hours' },
        reasonKey: 'tbti.reason.nh.confirmed_snapshot',
      },
    ],
    excludedCount: 6,
    held: false,
    heldReasonKey: null,
    nInterval: { min: 60, max: 68 },
    caveats: [
      { code: 'release_unknown', count: 6 },
      { code: 'n_covered_ratio', count: 60 },
      { code: 'h_alias_file', count: 12 },
    ],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
  };
}

function axis3(): TbtiAxis {
  return {
    axis: 3,
    primary: 'A',
    primaryPct: 85,
    secondary: 'O',
    secondaryPct: 15,
    chips: [],
    evidence: [
      {
        key: { platform: 'steam', externalId: 'bg3' },
        metric: { value: 85, unit: 'percent' },
        reasonKey: 'tbti.reason.oa.genre',
      },
    ],
    excludedCount: 3,
    held: false,
    heldReasonKey: null,
    nInterval: null,
    caveats: [{ code: 'genre_unknown', count: 3 }],
    baselineKey: null,
    baselineTextKey: null,
    metrics: null,
  };
}

function axis4Full(): TbtiAxis {
  return {
    axis: 4,
    primary: 'C',
    primaryPct: 78,
    secondary: 'L',
    secondaryPct: 22,
    chips: [],
    evidence: [
      {
        key: { platform: 'steam', externalId: 'wilds-2025' },
        metric: { value: 100, unit: 'percent' },
        reasonKey: 'tbti.reason.cl.ach_ready',
      },
      {
        key: { platform: 'steam', externalId: 'spire2' },
        metric: { value: 100, unit: 'percent' },
        reasonKey: 'tbti.reason.cl.ach_ready',
      },
    ],
    excludedCount: 15,
    held: false,
    heldReasonKey: null,
    nInterval: null,
    caveats: [],
    baselineKey: 'tbti.baseline.imc2016',
    baselineTextKey: 'tbti.baseline.imc2016.text',
    metrics: null,
  };
}

/** 8a — 전체 판정(INAC, 둘 다 강해요 병기). */
export const fixture8a: TbtiResult = {
  code: 'INAC',
  axes: [axis1(), axis2(), axis3(), axis4Full()],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: COMMON_CAVEATS,
};

/** 8c — 전체 보류(총 5시간 미만, 3.2시간). */
export const fixture8c: TbtiResult = {
  code: '????',
  axes: [
    {
      axis: 1,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: [],
      excludedCount: 0,
      held: true,
      heldReasonKey: 'short_sample',
      nInterval: null,
      caveats: [],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
    {
      axis: 2,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: [],
      excludedCount: 0,
      held: true,
      heldReasonKey: 'short_sample',
      nInterval: null,
      caveats: [],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
    {
      axis: 3,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: [],
      excludedCount: 0,
      held: true,
      heldReasonKey: 'short_sample',
      nInterval: null,
      caveats: [],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
    {
      axis: 4,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: [],
      excludedCount: 0,
      held: true,
      heldReasonKey: 'short_sample',
      nInterval: null,
      caveats: [],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
  ],
  pending: true,
  pendingHours: { have: 192, need: 300 },
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: COMMON_CAVEATS,
};

/** 8d — ①축만 판정 보류(?). */
export const fixture8d: TbtiResult = {
  code: '?NAC',
  axes: [
    {
      axis: 1,
      primary: '?',
      primaryPct: null,
      secondary: null,
      secondaryPct: null,
      chips: [],
      evidence: [],
      excludedCount: 0,
      held: true,
      heldReasonKey: 'short_sample',
      nInterval: null,
      caveats: [],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
    axis2(),
    axis3(),
    axis4Full(),
  ],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: COMMON_CAVEATS,
};

/** 업적 꺼짐 — ④축 미반영 칩 + 안내 + 설정 버튼. */
export const fixtureAchOff: TbtiResult = {
  code: 'INAC',
  axes: [
    axis1(),
    axis2(),
    axis3(),
    {
      ...axis4Full(),
      chips: ['ach_not_reflected'],
      caveats: [{ code: 'ach_not_reflected', count: null }],
      baselineKey: null,
      baselineTextKey: null,
      metrics: null,
    },
  ],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: COMMON_CAVEATS,
};

/** 업적 일부 반영 — ④축 103/123편 칩 + 안내(버튼 없음). */
export const fixtureAchPart: TbtiResult = {
  code: 'INAC',
  axes: [
    axis1(),
    axis2(),
    axis3(),
    {
      ...axis4Full(),
      chips: ['ach_partial'],
      achReflected: { got: 103, of: 123 },
      caveats: [{ code: 'ach_partial', count: null }],
    },
  ],
  pending: false,
  pendingHours: null,
  gameLetters: [],
  aliasStatus: 'missing',
  caveats: COMMON_CAVEATS,
};
