import { describe, expect, it } from 'vitest';
import {
  starsTransition,
  type StarsKeyInput,
} from '../../src/ui/library/stars-state.js';

/** W7 별 상태 전이 단위 테스트. 미리보기·확정·취소 표를 확인한다. */
function apply(
  current: number | null,
  preview: number | null,
  key: StarsKeyInput,
): { preview: number | null; commit?: number | null } {
  return starsTransition(current, preview, key);
}

describe('미리보기만 (저장 없음)', () => {
  it('hover·←→·숫자', () => {
    expect(apply(4, null, { hover: 3 })).toEqual({ preview: 3 });
    expect(apply(4, 3, 'left')).toEqual({ preview: 2.5 });
    expect(apply(4, 3, 'right')).toEqual({ preview: 3.5 });
    expect(apply(null, null, { digit: 5 })).toEqual({ preview: 5 });
    expect(apply(4, 3, 'escape')).toEqual({ preview: null });
    expect(apply(4, 3, 'blur')).toEqual({ preview: null });
    expect(apply(4, 3, 'leave')).toEqual({ preview: null });
  });

  it('빈 값에서 ←→는 끝에서 진입', () => {
    expect(apply(null, null, 'left')).toEqual({ preview: 5 });
    expect(apply(null, null, 'right')).toEqual({ preview: 0.5 });
  });

  it('0.5에서 ←는 미리보기 해제, 5에서 →는 유지', () => {
    expect(apply(null, 0.5, 'left')).toEqual({ preview: null });
    expect(apply(null, 5, 'right')).toEqual({ preview: 5 });
  });

  it('범위 밖 숫자는 무시', () => {
    expect(apply(4, null, { digit: 9 })).toEqual({ preview: null });
  });
});

describe('확정·취소', () => {
  it('Enter/Space는 미리보기 확정', () => {
    expect(apply(4, 3, 'enter')).toEqual({ preview: null, commit: 3 });
    expect(apply(4, 3, 'space')).toEqual({ preview: null, commit: 3 });
  });

  it('현재 값과 같으면 null로 취소', () => {
    expect(apply(4, 4, 'enter')).toEqual({ preview: null, commit: null });
    expect(apply(null, null, 'space')).toEqual({ preview: null, commit: null });
  });

  it('Delete/Backspace는 즉시 취소', () => {
    expect(apply(4, 3, 'delete')).toEqual({ preview: null, commit: null });
    expect(apply(4, null, 'backspace')).toEqual({ preview: null, commit: null });
  });
});
