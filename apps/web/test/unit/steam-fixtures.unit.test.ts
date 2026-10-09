import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * S7 합성 Steam 응답 5종 로드 테스트 1건.
 * JSON·manifest를 읽어 파싱만 확인한다. 판정·정규화(D-03)는 범위 밖이라 하지 않는다.
 */
const DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'steam');

function loadJson(name: string): unknown {
  return JSON.parse(readFileSync(join(DIR, name), 'utf8'));
}

describe('steam fixtures load', () => {
  it('5종 + manifest를 읽어 파싱한다', () => {
    const manifest = loadJson('manifest.json') as {
      version: number;
      fixtures: { file: string }[];
    };
    expect(manifest.version).toBe(1);
    expect(manifest.fixtures).toHaveLength(5);
    for (const entry of manifest.fixtures) {
      const body = loadJson(entry.file) as { response: unknown };
      expect(body).toHaveProperty('response');
    }
    const onDisk = readdirSync(DIR)
      .filter((name) => name.startsWith('owned-') && name.endsWith('.json'))
      .sort();
    expect(onDisk).toEqual([
      'owned-missing-count.json',
      'owned-normal.json',
      'owned-time-zero.json',
      'owned-zero-drop.json',
      'owned-zero-first.json',
    ]);
  });
});
