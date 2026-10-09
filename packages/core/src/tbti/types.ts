/**
 * TBTI 자리 (C-8, R1.5). 이름·입력 타입만 둔다.
 * DB·FS·HTTP·apps/web import 0.
 */
import type { GameFacts } from '../archive/types.js';

export type TbtiInput = {
  games: GameFacts[];
};
