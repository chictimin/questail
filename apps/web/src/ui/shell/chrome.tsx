/**
 * 좁은 폭 헤더 숨김 상태의 단일 출처 — MobileHeader가 쓰고, 셸 루트 data 속성과
 * 팝오버 잠금이 읽는다. 이동 거리(76)·전환·reduced-motion은 shell.css 토큰을 공용한다.
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

export interface ChromeState {
  hidden: boolean;
  frost: boolean;
  /** true면 리스트 등 내부 스크롤이 숨김 원천, false면 문서 스크롤. */
  inner: boolean;
}

export interface ChromeApi {
  state: ChromeState;
  setState: (next: ChromeState) => void;
  /** 팝오버가 열려 있는 동안 true — 헤더 판정 중단. */
  lockedRef: { current: boolean };
  /** 잠금 해제 직후 판정 기준값 재설정을 요청하는 구독 지점. */
  rebaselineRef: { current: (() => void) | null };
  setLocked: (locked: boolean) => void;
}

const SHOWN: ChromeState = { hidden: false, frost: false, inner: false };

const ChromeContext = createContext<ChromeApi | null>(null);

export function ChromeProvider({
  children,
}: {
  children: (state: ChromeState) => React.ReactNode;
}): React.JSX.Element {
  const [state, setState] = useState<ChromeState>(SHOWN);
  const lockedRef = useRef(false);
  const rebaselineRef = useRef<(() => void) | null>(null);
  const setLocked = useCallback((locked: boolean): void => {
    lockedRef.current = locked;
    if (!locked) rebaselineRef.current?.();
  }, []);
  const api = useMemo<ChromeApi>(
    () => ({ state, setState, lockedRef, rebaselineRef, setLocked }),
    [state, setLocked],
  );
  return (
    <ChromeContext.Provider value={api}>{children(state)}</ChromeContext.Provider>
  );
}

const FALLBACK: ChromeApi = {
  state: SHOWN,
  setState: () => undefined,
  lockedRef: { current: false },
  rebaselineRef: { current: null },
  setLocked: () => undefined,
};

export function useChrome(): ChromeApi {
  return useContext(ChromeContext) ?? FALLBACK;
}

/** 본문 이동 여부 — 내부 스크롤이 숨긴 경우만(문서 스크롤은 본문이 이미 움직인다). */
export function chromeShifts(state: ChromeState): boolean {
  return state.hidden && state.inner;
}
