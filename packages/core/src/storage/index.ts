/**
 * Markdown 저장소 — 정규화된 게임 데이터를 md 파일로 직렬화
 *
 * 데이터 정본은 md 파일. DB 아님.
 * 볼트 호환 frontmatter 사용, 객관/주관 분리(source) 유지.
 */

import { type NormalizedGame } from '../normalize/index.js';

export interface GameNote {
  frontmatter: Record<string, unknown>;
  body: string;
}

/**
 * 게임 1개를 md 노트로 직렬화
 */
export function serializeGameNote(game: NormalizedGame): GameNote {
  const frontmatter: Record<string, unknown> = {
    title: game.title,
    game_id: game.id,
    platform: game.platform,
    source: game.source,
    playtime_minutes: game.playtimeMinutes,
  };

  if (game.achievementPercent !== undefined) {
    frontmatter.achievement_pct = game.achievementPercent;
  }
  if (game.lastPlayedAt !== undefined) {
    frontmatter.last_played = game.lastPlayedAt;
  }
  if (game.imageUrl !== undefined) {
    frontmatter.image = game.imageUrl;
  }
  if (game.genres !== undefined && game.genres.length > 0) {
    frontmatter.genres = game.genres;
  }

  const body = game.source === 'auto'
    ? `> Steam에서 자동 가져온 게임 데이터입니다.\n`
    : `> 수동으로 추가된 게임입니다.\n`;

  return { frontmatter, body };
}

/**
 * GameNote를 실제 md 문자열로 변환
 */
export function formatNote(note: GameNote): string {
  const fmLines = Object.entries(note.frontmatter).map(([key, value]) => {
    if (Array.isArray(value)) {
      return `${key}:\n${value.map(v => `  - ${v}`).join('\n')}`;
    }
    return `${key}: ${value}`;
  });

  return `---\n${fmLines.join('\n')}\n---\n\n${note.body}`;
}
