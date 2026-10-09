/**
 * W9 Markdown 내보내기 — 렌더 + 원자 파일 쓰기.
 * DB·키 파일에 닿지 않는다. 입력은 data/readExportGames의 GameFacts[]다.
 * frontmatter 키 14개 영문 고정(L-7), 본문 라벨은 호출 시점 화면 언어(U-6).
 * rated_at은 현재 점수가 된 최신 실변경 at이다(data getLatestRatedAt과 같은 값).
 * 장르·태그 값은 영문 정본(L-3: nameEn·태그 원문), 표시 매핑은 화면 몫이다.
 */
import { existsSync, mkdtempSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import type { GameFacts } from '../data/library.js';
import { latestRatedAt } from '../shared/ratedAt.js';
import { t, type Locale } from '../ui/i18n/index.js';

export interface ExportFile {
  filename: string;
  content: string;
}

/** 제품 출력 디렉터리 이름 — <dataDir> 직하. 디자인 원문 exports 폴더가 정본. */
export const EXPORT_DIR_NAME = 'exports';

export type ExportFailureReason =
  | 'duplicate_filename'
  | 'invalid_filename'
  | 'write_failed';

export class ExportWriteError extends Error {
  readonly reason: ExportFailureReason;
  constructor(reason: ExportFailureReason, detail?: string) {
    super(
      `[web] export 쓰기 실패(${reason})${detail === undefined ? '' : `: ${detail}`}`,
    );
    this.reason = reason;
  }
}

/** 파일명 화이트리스트 밖 문자 → '-' 치환. 소문자화 후 적용한다. */
const FILENAME_UNSAFE = /[^a-z0-9-_.]/g;

/** `{platform}-{external_id}.md` + 소문자 살균. 빈 줄기면 쓰기 전 실패로 던진다. */
export function exportFilename(platform: string, externalId: string): string {
  const base = `${platform}-${externalId}`
    .toLowerCase()
    .replace(FILENAME_UNSAFE, '-');
  if (base === '' || base === '.' || base === '..') {
    throw new ExportWriteError('invalid_filename');
  }
  return `${base}.md`;
}

/** UTC YYYY-MM-DD. */
function isoDay(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

/** UTC ISO 8601(…Z). */
function isoDateTime(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString();
}

function yamlScalar(value: string | number | null): string {
  if (value === null) return 'null';
  if (typeof value === 'number') return String(value);
  return JSON.stringify(value);
}

function yamlStringList(items: string[]): string {
  return `[${items.map((item) => JSON.stringify(item)).join(', ')}]`;
}

/** developerRaw(JSON 배열 원문) → YAML 목록, 파싱 불가면 원문 문자열. */
function developerValue(raw: string | null): string {
  if (raw === null) return 'null';
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      Array.isArray(parsed) &&
      parsed.every((item): item is string => typeof item === 'string')
    ) {
      return yamlStringList(parsed);
    }
  } catch {
    // 원문 유지
  }
  return JSON.stringify(raw);
}

/**
 * 현재 점수가 된 최신 실변경 at. 미평가면 null이다(data getLatestRatedAt과 같은 값).
 * 정의는 shared/ratedAt.ts 1곳에만 있다.
 */
export function exportRatedAt(facts: GameFacts): number | null {
  return latestRatedAt(facts);
}

export function renderExportFile(
  facts: GameFacts,
  locale: Locale,
): ExportFile {
  const releaseDate =
    facts.releaseDate !== null
      ? isoDay(facts.releaseDate)
      : (facts.releaseDateText ?? null);
  const ratedAtEpoch = exportRatedAt(facts);
  const genres = facts.genres.map((genre) => genre.nameEn);
  const tags = facts.tags.map((entry) => entry.tag);
  const displayName = facts.titleKo ?? facts.name;
  const none = t(locale, 'export.none');

  const frontmatter = [
    '---',
    `platform: ${yamlScalar(facts.key.platform)}`,
    `external_id: ${yamlScalar(facts.key.externalId)}`,
    `name: ${yamlScalar(facts.name)}`,
    `title_ko: ${yamlScalar(facts.titleKo)}`,
    `developer: ${developerValue(facts.developerRaw)}`,
    `release_date: ${yamlScalar(releaseDate)}`,
    `genres: ${yamlStringList(genres)}`,
    `tags: ${yamlStringList(tags)}`,
    `playtime_minutes: ${yamlScalar(facts.confirmedMinutes)}`,
    `last_played: ${yamlScalar(facts.lastPlayed !== null ? isoDateTime(facts.lastPlayed) : null)}`,
    `rating: ${yamlScalar(facts.latestScore)}`,
    `rated_at: ${yamlScalar(ratedAtEpoch !== null ? isoDateTime(ratedAtEpoch) : null)}`,
    `library_added_at: ${yamlScalar(facts.libraryAddedAt !== null ? isoDateTime(facts.libraryAddedAt) : null)}`,
    'ownership_status: "owned"',
    '---',
  ];

  const body = [
    `# ${displayName}`,
    '',
    `- ${t(locale, 'export.playtime')}: ${facts.confirmedMinutes}${t(locale, 'export.minutes')}`,
    `- ${t(locale, 'export.lastPlayed')}: ${facts.lastPlayed !== null ? isoDateTime(facts.lastPlayed) : none}`,
    `- ${t(locale, 'export.rating')}: ${facts.latestScore !== null ? String(facts.latestScore) : t(locale, 'export.unrated')}`,
    `- ${t(locale, 'export.genres')}: ${genres.length > 0 ? genres.join(', ') : none}`,
    `- ${t(locale, 'export.tags')}: ${tags.length > 0 ? tags.join(', ') : none}`,
    '',
  ];

  return {
    filename: exportFilename(facts.key.platform, facts.key.externalId),
    content: `${frontmatter.join('\n')}\n\n${body.join('\n')}`,
  };
}

/** 게임당 1파일 렌더. 파일명 중복이면 쓰기 전 전체 실패로 던진다. */
export function renderExportFiles(
  games: GameFacts[],
  locale: Locale,
): ExportFile[] {
  const files = games.map((facts) => renderExportFile(facts, locale));
  const seen = new Set<string>();
  for (const file of files) {
    if (seen.has(file.filename)) {
      throw new ExportWriteError('duplicate_filename', file.filename);
    }
    seen.add(file.filename);
  }
  return files;
}

function assertWritableFilenames(target: string, files: ExportFile[]): void {
  const seen = new Set<string>();
  for (const file of files) {
    if (
      file.filename === '' ||
      file.filename === '.' ||
      file.filename === '..' ||
      file.filename.includes('/') ||
      file.filename.includes('\\') ||
      resolve(target, file.filename) !== join(target, file.filename)
    ) {
      throw new ExportWriteError('invalid_filename', file.filename);
    }
    if (seen.has(file.filename)) {
      throw new ExportWriteError('duplicate_filename', file.filename);
    }
    seen.add(file.filename);
  }
}

/**
 * 원자 교체 — 스테이징에 전부 쓴 뒤 ① 기존 target → prev rename
 * ② staging → target rename ③ 성공하면 prev 삭제.
 * ②가 실패하면 prev를 target으로 되돌려 이전 결과를 보존한다.
 */
export interface ExportFsOps {
  mkdtemp: (prefix: string) => string;
  writeFile: (path: string, content: string) => void;
  rm: (path: string) => void;
  rename: (from: string, to: string) => void;
  exists: (path: string) => boolean;
  readdir: (dir: string) => string[];
}

const defaultFsOps: ExportFsOps = {
  mkdtemp: (prefix) => mkdtempSync(prefix),
  writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
  rm: (path) => rmSync(path, { recursive: true, force: true }),
  rename: (from, to) => renameSync(from, to),
  exists: (path) => existsSync(path),
  readdir: (dir) => readdirSync(dir),
};

function prevPrefix(target: string): string {
  return `${basename(target)}.prev-`;
}

export function writeExportFiles(
  exportDir: string,
  files: ExportFile[],
  ops: ExportFsOps = defaultFsOps,
): { written: number } {
  const target = resolve(exportDir);
  assertWritableFilenames(target, files);
  const parent = dirname(target);
  // 이전 실행 잔여 prev 정리 — 실패해도 이번 쓰기를 막지 않는다.
  try {
    for (const entry of ops.readdir(parent)) {
      if (entry.startsWith(prevPrefix(target))) {
        ops.rm(join(parent, entry));
      }
    }
  } catch {
    // 정리 실패는 이번 쓰기를 막지 않는다
  }
  const prev = `${target}.prev-${Date.now()}`;
  let staging: string | null = null;
  let movedPrev = false;
  try {
    staging = ops.mkdtemp(join(parent, `.${basename(target)}.staging-`));
    for (const file of files) {
      ops.writeFile(join(staging, file.filename), file.content);
    }
    if (ops.exists(target)) {
      ops.rename(target, prev);
      movedPrev = true;
    }
    ops.rename(staging, target);
    staging = null;
  } catch (error) {
    if (staging !== null) {
      ops.rm(staging);
    }
    if (movedPrev) {
      try {
        ops.rename(prev, target);
      } catch {
        // 복원 best effort — 원인은 최초 실패 그대로 던진다
      }
    }
    if (error instanceof ExportWriteError) throw error;
    throw new ExportWriteError('write_failed');
  }
  // 교체 성공 — prev 정리는 성공 응답과 분리한다.
  // 실패해도 성공을 돌려주고 잔여는 다음 내보내기 시작 때 정리한다.
  if (movedPrev) {
    try {
      ops.rm(prev);
    } catch {
      // 다음 내보내기 시작 때 정리
    }
  }
  return { written: files.length };
}
