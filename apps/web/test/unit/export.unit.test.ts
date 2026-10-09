import { existsSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { GameFacts } from '../../src/data/library.js';
import type { ExportFsOps } from '../../src/server/export.js';
import {
  ExportWriteError,
  exportFilename,
  exportRatedAt,
  renderExportFile,
  renderExportFiles,
  writeExportFiles,
} from '../../src/server/export.js';

/** W9 렌더·원자 쓰기 단위 테스트. DB 없이 GameFacts 픽스처로 확인한다. */
function makeFacts(overrides?: Partial<GameFacts>): GameFacts {
  return {
    key: { platform: 'steam', externalId: '100' },
    name: 'Store Name',
    titleKo: '한글 제목',
    developerRaw: '["Dev A"]',
    releaseDate: 1704067200,
    releaseDateText: 'Jan 2024',
    genres: [{ genreId: 'action', nameEn: 'Action', nameKo: '액션' }],
    coverUrl: null,
    hidden: false,
    libraryAddedAt: 1700000000,
    confirmedMinutes: 120,
    lastPlayed: 1700100000,
    snapshots: [],
    deltas: [],
    coverage: {
      firstObservedAt: null,
      lastObservedAt: null,
      gapDays: [],
      isBaseline: false,
    },
    ownership: [],
    wishlist: [],
    tags: [{ tag: 'Roguelike', votes: 50, rank: 1 }],
    tagStatus: 'ready',
    achievements: [],
    achievementState: 'not_collected',
    latestScore: 8,
    ratingEvents: [{ id: 1, before: null, after: 8, at: 1700200000 }],
    syncRunRefs: [],
    ...overrides,
  };
}

function frontmatter(content: string): Record<string, string> {
  const block = content.split('---\n')[1] ?? '';
  const out: Record<string, string> = {};
  for (const line of block.split('\n')) {
    if (line.trim() === '') continue;
    const at = line.indexOf(': ');
    out[line.slice(0, at)] = line.slice(at + 2);
  }
  return out;
}

describe('renderExportFile', () => {
  it('frontmatter 14키 + 값 대응', () => {
    const fm = frontmatter(renderExportFile(makeFacts(), 'ko').content);
    expect(Object.keys(fm).sort()).toEqual(
      [
        'developer',
        'external_id',
        'genres',
        'last_played',
        'library_added_at',
        'name',
        'ownership_status',
        'platform',
        'playtime_minutes',
        'rating',
        'rated_at',
        'release_date',
        'tags',
        'title_ko',
      ].sort(),
    );
    expect(fm['platform']).toBe('"steam"');
    expect(fm['external_id']).toBe('"100"');
    expect(fm['release_date']).toBe('"2024-01-01"');
    expect(fm['playtime_minutes']).toBe('120');
    expect(fm['rating']).toBe('8');
    expect(fm['rated_at']).toBe(`"${new Date(1700200000 * 1000).toISOString()}"`);
    expect(fm['ownership_status']).toBe('"owned"');
    expect(fm['developer']).toBe('["Dev A"]');
  });

  it('release_date = epoch 없으면 원문, 둘 다 없으면 null', () => {
    const raw = frontmatter(
      renderExportFile(
        makeFacts({ releaseDate: null, releaseDateText: 'Q1 2024' }),
        'ko',
      ).content,
    );
    expect(raw['release_date']).toBe('"Q1 2024"');
    const empty = frontmatter(
      renderExportFile(
        makeFacts({ releaseDate: null, releaseDateText: null }),
        'ko',
      ).content,
    );
    expect(empty['release_date']).toBe('null');
  });

  it('미평가면 rating·rated_at null', () => {
    const fm = frontmatter(
      renderExportFile(makeFacts({ latestScore: null, ratingEvents: [] }), 'ko')
        .content,
    );
    expect(fm['rating']).toBe('null');
    expect(fm['rated_at']).toBe('null');
  });

  it('취소 후 재평가는 현재 점수의 최신 at', () => {
    const facts = makeFacts({
      latestScore: 9,
      ratingEvents: [
        { id: 1, before: null, after: 8, at: 1700200000 },
        { id: 2, before: 8, after: null, at: 1700300000 },
        { id: 3, before: null, after: 9, at: 1700400000 },
      ],
    });
    expect(exportRatedAt(facts)).toBe(1700400000);
    const fm = frontmatter(renderExportFile(facts, 'ko').content);
    expect(fm['rated_at']).toBe(
      `"${new Date(1700400000 * 1000).toISOString()}"`,
    );
  });

  it('본문 라벨은 호출 언어(ko·en)', () => {
    const ko = renderExportFile(makeFacts(), 'ko').content;
    const en = renderExportFile(makeFacts(), 'en').content;
    expect(ko).toContain('- 플레이타임: 120분');
    expect(ko).toContain('- 별점: 8');
    expect(en).toContain('- Playtime: 120min');
    expect(en).toContain('- Rating: 8');
    expect(en).not.toContain('플레이타임');
  });

  it('파일명에 키·경로 원문 없음', () => {
    const { content } = renderExportFile(makeFacts(), 'ko');
    expect(content).not.toContain('keyText');
    expect(content).not.toContain('steam.key');
  });
});

describe('exportFilename', () => {
  it('소문자화 + 위험 문자 → "-"', () => {
    expect(exportFilename('a/b', 'c:d')).toBe('a-b-c-d.md');
    expect(exportFilename('steam', '100')).toBe('steam-100.md');
    expect(exportFilename('Steam', 'ABC')).toBe('steam-abc.md');
  });

  it('동명 매핑 2건은 렌더 단계 전체 실패', () => {
    const games = [
      makeFacts({ key: { platform: 'a-b', externalId: 'c' } }),
      makeFacts({ key: { platform: 'a', externalId: 'b-c' } }),
    ];
    expect(() => renderExportFiles(games, 'ko')).toThrow(ExportWriteError);
  });
});

describe('writeExportFiles', () => {
  it('N개 쓰기 + 잔여 파일 제거', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-export-'));
    const target = join(dir, 'export');
    const files = renderExportFiles(
      [
        makeFacts({ key: { platform: 'steam', externalId: '100' } }),
        makeFacts({
          key: { platform: 'steam', externalId: '200' },
          name: 'Second',
          titleKo: null,
        }),
      ],
      'ko',
    );
    expect(writeExportFiles(target, files)).toEqual({ written: 2 });
    // 잔여 파일 정책: 이전 내보내기 파일을 남기지 않는다
    writeFileSync(join(target, 'stale.md'), 'old', 'utf8');
    expect(writeExportFiles(target, files)).toEqual({ written: 2 });
    expect(readdirSync(target).sort()).toEqual(
      files.map((file) => file.filename).sort(),
    );
    expect(readFileSync(join(target, files[0].filename), 'utf8')).toBe(
      files[0].content,
    );
  });

  it('경로 탈출 파일명은 이전 결과 보존 + 실패', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-export-'));
    const target = join(dir, 'export');
    const files = renderExportFiles(
      [makeFacts({ key: { platform: 'steam', externalId: '100' } })],
      'ko',
    );
    writeExportFiles(target, files);
    expect(() =>
      writeExportFiles(target, [{ filename: '../evil.md', content: 'x' }]),
    ).toThrow(ExportWriteError);
    expect(readdirSync(target)).toEqual([files[0].filename]);
    expect(readdirSync(dir).sort()).toEqual(['export']);
  });

  it('부모 없음은 write_failed + 대상 미생성', () => {
    const target = join(
      tmpdir(),
      'questail-no-such-parent',
      'export',
    );
    expect(() =>
      writeExportFiles(target, [
        { filename: 'steam-100.md', content: 'x' },
      ]),
    ).toThrow(expect.objectContaining({ reason: 'write_failed' }));
  });

  it('교체 단계 실패 시 이전 결과 복원', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-export-'));
    const target = join(dir, 'export');
    const oldFiles = renderExportFiles(
      [makeFacts({ key: { platform: 'steam', externalId: '100' } })],
      'ko',
    );
    writeExportFiles(target, oldFiles);
    const nextFiles = renderExportFiles(
      [
        makeFacts({
          key: { platform: 'steam', externalId: '200' },
          name: 'Second',
          titleKo: null,
        }),
      ],
      'ko',
    );
    let renames = 0;
    const ops: ExportFsOps = {
      mkdtemp: (prefix) => mkdtempSync(prefix),
      writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
      rm: (path) => rmSync(path, { recursive: true, force: true }),
      exists: (path) => existsSync(path),
      readdir: (path) => readdirSync(path),
      rename: (from, to) => {
        renames += 1;
        if (renames === 2) {
          throw new Error('injected step-2 failure');
        }
        renameSync(from, to);
      },
    };
    expect(() => writeExportFiles(target, nextFiles, ops)).toThrow(
      ExportWriteError,
    );
    expect(readdirSync(target)).toEqual(
      oldFiles.map((file) => file.filename),
    );
    expect(readFileSync(join(target, oldFiles[0].filename), 'utf8')).toBe(
      oldFiles[0].content,
    );
    expect(readdirSync(dir)).toEqual(['export']);
  });

  it('prev 삭제 실패해도 성공 응답 + 새 결과 유지, 다음 실행에서 잔여 정리', () => {
    const dir = mkdtempSync(join(tmpdir(), 'questail-export-'));
    const target = join(dir, 'export');
    const oldFiles = renderExportFiles(
      [makeFacts({ key: { platform: 'steam', externalId: '100' } })],
      'ko',
    );
    writeExportFiles(target, oldFiles);
    const nextFiles = renderExportFiles(
      [
        makeFacts({
          key: { platform: 'steam', externalId: '200' },
          name: 'Second',
          titleKo: null,
        }),
      ],
      'ko',
    );
    const ops: ExportFsOps = {
      mkdtemp: (prefix) => mkdtempSync(prefix),
      writeFile: (path, content) => writeFileSync(path, content, 'utf8'),
      rm: (path) => {
        if (basename(path).startsWith('export.prev-')) {
          throw new Error('injected prev-rm failure');
        }
        rmSync(path, { recursive: true, force: true });
      },
      exists: (path) => existsSync(path),
      readdir: (path) => readdirSync(path),
      rename: (from, to) => renameSync(from, to),
    };
    expect(writeExportFiles(target, nextFiles, ops)).toEqual({ written: 1 });
    expect(readdirSync(target)).toEqual(
      nextFiles.map((file) => file.filename),
    );
    const residue = readdirSync(dir).filter((entry) => entry !== 'export');
    expect(residue).toHaveLength(1);
    const thirdFiles = renderExportFiles(
      [makeFacts({ key: { platform: 'steam', externalId: '300' } })],
      'ko',
    );
    expect(writeExportFiles(target, thirdFiles)).toEqual({ written: 1 });
    expect(readdirSync(dir)).toEqual(['export']);
    expect(readdirSync(target)).toEqual(
      thirdFiles.map((file) => file.filename),
    );
  });
});
