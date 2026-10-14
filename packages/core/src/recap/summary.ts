/**
 * recap 07 요약 카드 변환 (계약 R15-3 TbtiCardSummary · R16 · R22, 정본 1곳).
 * T2가 중복 정의하지 않도록 이 모듈이 유일한 변환이다.
 * DB·FS·HTTP·Date.now·Math.random·apps/web import 0.
 */
import type { TbtiAxis, TbtiResult } from '../tbti/types.js';
import type { TbtiCardSummary } from './types.js';

function nullMini(axes: readonly TbtiAxis[]): TbtiCardSummary['mini'] {
  return axes.map((axis) => ({ axis: axis.axis, pct: null }));
}

/**
 * TbtiResult → 카드 요약.
 * pending이면 code ????·letters 4개 ?·mini pct null(R22 확정).
 * 비보류면 letters = 4축 primary 순서, mini pct = ①③④ primaryPct · ② nInterval.min
 * (계약 v1.0.1 델타 — ②축만 값(N_min·N_max), ①③④ null, pending이면 null).
 * ② mini는 held면 null(R16 — F-15로 interval_cross 보류 ②축도 nInterval을 싣게
 * 되므로 held 체크를 먼저 한다). 그 외 R22 규칙 그대로.
 */
export function toCardSummary(result: TbtiResult): TbtiCardSummary {
  const axes = [...result.axes].sort((a, b) => a.axis - b.axis);
  if (result.pending) {
    return { code: '????', pending: true, letters: ['?', '?', '?', '?'], mini: nullMini(axes) };
  }
  const [first, second, third, fourth] = axes;
  return {
    code: result.code,
    pending: false,
    letters: [first.primary, second.primary, third.primary, fourth.primary],
    mini: [
      { axis: 1, pct: first.primaryPct },
      { axis: 2, pct: second.held ? null : second.nInterval ? second.nInterval.min : null },
      { axis: 3, pct: third.primaryPct },
      { axis: 4, pct: fourth.primaryPct },
    ],
  };
}
