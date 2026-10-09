/**
 * W7 별 입력 상태 전이 — 순수 함수. 미리보기와 확정을 분리한다.
 * 단위: 별 0.5~5 (저장값 1~10의 /2). DOM 배선은 Stars.tsx가 맡는다.
 */
export type StarsKeyInput =
  | 'left'
  | 'right'
  | 'enter'
  | 'space'
  | 'delete'
  | 'backspace'
  | 'escape'
  | 'blur'
  | 'leave'
  | { digit: number }
  | { hover: number };

export interface StarsTransition {
  preview: number | null;
  commit?: number | null;
}

function clampStars(value: number): number {
  if (value < 0.5) return 0.5;
  if (value > 5) return 5;
  return value;
}

/** 미리보기 후크 — 미리보기 중이면 data-preview, 아니면 없음. 순수. */
export function previewAttrs(preview: number | null): {
  'data-preview'?: 'true';
} {
  return preview === null ? {} : { 'data-preview': 'true' };
}

/**
 * current = 확정값(별 단위, 미평가 null), preview = 미리보기.
 * Enter/Space는 미리보기(없으면 확정값)를 확정하고, 확정값과 같으면
 * 취소(null)로 바꾼다. 화살표·hover·숫자는 미리보기만 바꾼다.
 */
export function starsTransition(
  current: number | null,
  preview: number | null,
  key: StarsKeyInput,
): StarsTransition {
  const displayed = preview ?? current;
  if (key === 'enter' || key === 'space') {
    const target = displayed;
    return { preview: null, commit: target === current ? null : target };
  }
  if (key === 'delete' || key === 'backspace') {
    return { preview: null, commit: null };
  }
  if (key === 'escape' || key === 'blur' || key === 'leave') {
    return { preview: null };
  }
  if (key === 'left') {
    if (displayed === null) return { preview: 5 };
    const next = displayed - 0.5;
    return { preview: next < 0.5 ? null : next };
  }
  if (key === 'right') {
    if (displayed === null) return { preview: 0.5 };
    return { preview: clampStars(displayed + 0.5) };
  }
  if (typeof key === 'object' && 'digit' in key) {
    if (key.digit < 1 || key.digit > 5) return { preview };
    return { preview: key.digit };
  }
  if (typeof key === 'object' && 'hover' in key) {
    return { preview: clampStars(key.hover) };
  }
  return { preview };
}
