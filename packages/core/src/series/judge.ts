/**
 * T3 시리즈 판별 — 묶음 판정 (계약 R15-6, 동결 v1.0 + F-20 2회 조회).
 * 별칭 조회 = ③ 숫자 통일 후 정규화명 전체 정확 일치 → 미스면 코어로 한 번 더(둘 다 정확 일치, 접두 금지, C15).
 * 개발사 보조는 불리언 조건으로만 쓴다(점수 가산 금지, 확정 N5).
 * hidden 게임은 입력 단계에서 제외하고 제외 수를 반환에 포함한다(R15-2 ①).
 * DB·FS·HTTP·Date·Random·apps/web import 0.
 */
import type { GameKey } from '../types.js';
import type { GameFacts } from '../archive/types.js';
import type { SeriesAliasInput } from '../tbti/types.js';
import {
  SERIES_BUILTIN_ALIASES,
  normalizeAliasKey,
  normalizeSeriesDeveloper,
  normalizeSeriesTitle,
} from './normalize.js';
import type {
  SeriesAliasSource,
  SeriesBundle,
  SeriesBundleVia,
  SeriesGameBundle,
  SeriesJudgeInput,
  SeriesJudgeResult,
} from './types.js';

function compareGameKey(a: GameKey, b: GameKey): number {
  if (a.platform !== b.platform) return a.platform < b.platform ? -1 : 1;
  if (a.externalId !== b.externalId) return a.externalId < b.externalId ? -1 : 1;
  return 0;
}

/** 접미 차이 1토큰 이내 — (a) 한쪽 토큰열이 다른 쪽의 접두이고 길이 차가 1이거나, (b) 토큰 수가 같고 마지막 토큰만 다름(공통 앞부분이 있어야 하므로 2토큰 이상 — 1토큰 서로 다름은 전체가 다르므로 제외). 동등은 호출 전 이미 같은 묶음이므로 병합하지 않는다. */
function isSuffixDiffWithinOneToken(a: string, b: string): boolean {
  const ta = a.split(' ').filter((t) => t.length > 0);
  const tb = b.split(' ').filter((t) => t.length > 0);
  if (ta.length === tb.length) {
    if (ta.length < 2) return false;
    for (let i = 0; i < ta.length - 1; i += 1) {
      if (ta[i] !== tb[i]) return false;
    }
    return ta[ta.length - 1] !== tb[tb.length - 1];
  }
  const [shorter, longer] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
  if (longer.length - shorter.length !== 1) return false;
  for (let i = 0; i < shorter.length; i += 1) {
    if (shorter[i] !== longer[i]) return false;
  }
  return true;
}

/** F-20 별칭 2회 조회 — 정규화명 전체 정확 일치 → 미스면 코어로 한 번 더(둘 다 정확 일치, 접두 금지). 빈 값은 미스로 취급. */
function lookupSeriesAlias(
  aliasMap: Record<string, string>,
  normalized: string,
  core: string,
): string | undefined {
  const full = aliasMap[normalized];
  if (full !== undefined && full.length > 0) return full;
  if (core !== normalized) {
    const byCore = aliasMap[core];
    if (byCore !== undefined && byCore.length > 0) return byCore;
  }
  return undefined;
}

export function judgeSeriesBundles(input: SeriesJudgeInput): SeriesJudgeResult {
  const { games, seriesAliases } = input;

  const visible = games.filter((g) => !g.hidden);
  const hiddenExcluded = games.length - visible.length;

  // 별칭 맵 선택. status='ok'의 aliases=null은 계약 미정의 → 빈 파일 맵으로 처리(부록 A 미사용).
  let aliasMap: Record<string, string>;
  let aliasSource: SeriesAliasSource;
  const status: SeriesAliasInput['status'] = seriesAliases.status;
  if (status === 'ok') {
    aliasSource = 'file';
    aliasMap = {};
    const raw = seriesAliases.aliases ?? {};
    for (const [k, v] of Object.entries(raw)) {
      aliasMap[normalizeAliasKey(k)] = v.trim();
    }
  } else if (status === 'missing') {
    aliasSource = 'builtin';
    aliasMap = { ...SERIES_BUILTIN_ALIASES };
  } else {
    aliasSource = 'none';
    aliasMap = {};
  }

  // key 오름차순 고정(결정성 축 — 같은 입력→같은 출력 바이트).
  const sorted = [...visible].sort((a, b) => compareGameKey(a.key, b.key));

  type Work = {
    game: GameFacts;
    normalized: string;
    core: string;
    dev: string | null;
    bundleId: string;
    via: SeriesBundleVia;
  };
  const works: Work[] = sorted.map((game) => {
    const rawName = game.name ?? game.titleKo ?? '';
    const { normalized, core } = normalizeSeriesTitle(rawName);
    const dev = normalizeSeriesDeveloper(game.developerRaw);
    if (normalized.length === 0) {
      // 이름 없음 — 서로 묶지 않고 게임별 단일 묶음(결정적).
      return {
        game, normalized, core, dev,
        bundleId: `unknown:${game.key.platform}:${game.key.externalId}`,
        via: 'core' as SeriesBundleVia,
      };
    }
    const aliasId = lookupSeriesAlias(aliasMap, normalized, core);
    if (aliasId !== undefined) {
      return { game, normalized, core, dev, bundleId: `alias:${aliasId}`, via: 'alias' };
    }
    return { game, normalized, core, dev, bundleId: `core:${core}`, via: 'core' };
  });

  // 개발사 보조 병합(불리언 조건만): core 묶음끼리, 정규화 개발사 동등(non-null),
  // 코어 접미 차이 1토큰 이내일 때만 병합. alias 묶음은 저자 단언이라 손대지 않는다.
  // 정규화 전체 동점은 파이프라인상 이미 같은 묶음이므로 별도 처리 불필요(no-op).
  const parent = new Map<string, string>();
  const find = (id: string): string => {
    let cur = id;
    let p = parent.get(cur);
    while (p !== undefined && p !== cur) {
      cur = p;
      p = parent.get(cur);
    }
    return cur;
  };
  const union = (a: string, b: string): void => {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    // 결정성: 사전순으로 작은 쪽이 대표.
    const [rep, other] = ra < rb ? [ra, rb] : [rb, ra];
    parent.set(other, rep);
  };
  const coreWorks = works.filter((w) => w.via === 'core');
  for (let i = 0; i < coreWorks.length; i += 1) {
    for (let j = i + 1; j < coreWorks.length; j += 1) {
      const a = coreWorks[i];
      const b = coreWorks[j];
      if (a === undefined || b === undefined) continue;
      if (a.bundleId === b.bundleId) continue;
      if (a.dev === null || b.dev === null || a.dev !== b.dev) continue;
      if (isSuffixDiffWithinOneToken(a.core, b.core)) union(a.bundleId, b.bundleId);
    }
  }
  for (const w of works) {
    if (w.via === 'core') {
      const rep = find(w.bundleId);
      if (rep !== w.bundleId) {
        w.bundleId = rep;
        w.via = 'core-dev';
      }
    }
  }

  const items: SeriesGameBundle[] = works.map((w) => ({
    key: w.game.key,
    normalized: w.normalized,
    core: w.core,
    bundleId: w.bundleId,
    via: w.via,
  }));

  const byBundle = new Map<string, { via: SeriesBundleVia; keys: GameKey[] }>();
  for (const w of works) {
    const entry = byBundle.get(w.bundleId);
    if (entry === undefined) {
      byBundle.set(w.bundleId, { via: w.via, keys: [w.game.key] });
    } else {
      entry.keys.push(w.game.key);
      // via 표기 우선순위 alias > core-dev > core (T2의 h_alias_file 판정용).
      if (entry.via === 'core' && w.via !== 'core') entry.via = w.via;
    }
  }
  const bundles: SeriesBundle[] = [...byBundle.entries()]
    .map(([bundleId, entry]) => ({
      bundleId,
      via: entry.via,
      size: entry.keys.length,
      keys: entry.keys,
    }))
    .sort((a, b) => (a.bundleId < b.bundleId ? -1 : a.bundleId > b.bundleId ? 1 : 0));

  const aliasBundleCount = bundles.filter((b) => b.via === 'alias').length;

  return {
    items,
    bundles,
    aliasSource,
    bundleCount: bundles.length,
    aliasBundleCount,
    hiddenExcluded,
  };
}
