/** GENRE-L genreDisplayName 단위 — ko/en × 있음/없음 (+null 입력). */
import { describe, expect, it } from 'vitest';
import {
  genreDisplayName,
  genreDisplayNames,
  genreExportNames,
  type GenreName,
} from '../../src/shared/genres.js';

const both: GenreName = { nameKo: '액션', nameEn: 'Action' };
const koOnly: GenreName = { nameKo: '액션', nameEn: null };
const enOnly: GenreName = { nameKo: null, nameEn: 'Action' };
const neither: GenreName = { nameKo: null, nameEn: null };

describe('genreDisplayName', () => {
  it('ko → nameKo 우선', () => {
    expect(genreDisplayName(both, 'ko')).toBe('액션');
  });

  it('ko·nameKo 없음 → nameEn', () => {
    expect(genreDisplayName(enOnly, 'ko')).toBe('Action');
  });

  it('en → nameEn 우선', () => {
    expect(genreDisplayName(both, 'en')).toBe('Action');
  });

  it('en·nameEn 없음·genreId 없음 → Other genre(한국어 0, F-09)', () => {
    expect(genreDisplayName(koOnly, 'en')).toBe('Other genre');
  });

  it('en·nameEn 없음·고정표 적중 → 고정표 영문', () => {
    expect(genreDisplayName({ ...koOnly, genreId: '1' }, 'en')).toBe('Action');
  });

  it('둘 다 없음 → null', () => {
    expect(genreDisplayName(neither, 'ko')).toBe(null);
    expect(genreDisplayName(neither, 'en')).toBe(null);
  });

  it('목록 — null 제외', () => {
    expect(genreDisplayNames([both, neither, enOnly], 'ko')).toEqual([
      '액션',
      'Action',
    ]);
  });
});

describe('genreExportNames', () => {
  it('ko locale에서도 영문 우선', () => {
    expect(genreExportNames([both, neither])).toEqual(['Action']);
  });

  it('nameEn 없을 때 nameKo', () => {
    expect(genreExportNames([koOnly])).toEqual(['액션']);
  });
});
