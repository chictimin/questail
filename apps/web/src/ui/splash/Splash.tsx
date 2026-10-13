/**
 * U6 스플래시 3a — 계약 R15-12, R1 핸드오프 DESIGN_SYSTEM 38행 배경 규칙과 41행 모션 규칙을 따른다.
 *
 * 마운트 위치는 앱 최상위이며 기동당 1회만 올린다. 마운트 자체는 앱 쪽에서 하며 이 파일은 바꾸지 않는다.
 * once per boot 조건은 앱 쪽 마운트 가드가 맡는다. onDone 1회 호출 뒤 앱이 언마운트한다.
 *
 * 로딩은 3단이다. 도트 그리드는 CSS로 항상 먼저 깔린다. 다음으로 라이브러리 커버를 미리 읽어
 * 블러 배경으로 깐다. 합성 캐시 파일에 닿는 서버 경로가 아직 없어 1단계는 비워 두었다.
 * 합성 캐시 경로가 생기면 아래 커버 수집 자리에 캐시 우선 조회로 교체한다. 교체 지점 표시 있음.
 * 커버가 없거나 2.5초를 넘기면 그리드만 둔다. 모션은 전역 토큰 qtBlurIn과 qtPaw를 그대로 쓴다.
 * 전역 reduced motion 처리가 이 파일 애니메이션에도 그대로 적용된다.
 * 문구와 로고는 범위 밖이라 두지 않는다. 화면에 보이는 문자열이 없다.
 */

import { useEffect, useRef, useState } from 'react';
import { PawPrint } from '@phosphor-icons/react';
import styles from './splash.module.css';

interface SplashProps {
  onDone: () => void;
}

interface Print {
  x: number;
  y: number;
  left: boolean;
  id: number;
}

const MAX_COVERS = 6;
const MAX_PRINTS = 24;
const INTRO_MS = 1100;
const CAP_MS = 2500;
const PRINT_GAP_PX_SQ = 4096;

async function preload(urls: string[], ms: number): Promise<string[]> {
  return new Promise((resolve) => {
    const loaded: string[] = [];
    if (urls.length === 0) {
      resolve(loaded);
      return;
    }
    let remaining = urls.length;
    let finished = false;
    const timer = window.setTimeout(() => {
      finished = true;
      resolve(loaded);
    }, ms);
    const one = (url: string, ok: boolean) => {
      if (ok) {
        loaded.push(url);
      }
      remaining -= 1;
      if (remaining <= 0 && !finished) {
        finished = true;
        window.clearTimeout(timer);
        resolve(loaded);
      }
    };
    for (const url of urls) {
      const img = new Image();
      img.onload = () => one(url, true);
      img.onerror = () => one(url, false);
      img.src = url;
    }
  });
}

// 교체 지점: 합성 캐시 경로가 생기면 여기서 캐시를 먼저 조회하고 없으면 아래로 이어간다.
async function loadCovers(): Promise<string[]> {
  try {
    const res = await fetch('/api/library?includeEnded=false');
    if (!res.ok) {
      return [];
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body)) {
      return [];
    }
    const urls: string[] = [];
    for (const row of body) {
      if (urls.length >= MAX_COVERS) {
        break;
      }
      if (typeof row !== 'object' || row === null) {
        continue;
      }
      const cover: unknown = (row as { coverUrl: unknown }).coverUrl;
      if (typeof cover !== 'string' || cover.length === 0) {
        continue;
      }
      urls.push(cover);
    }
    return preload(urls, CAP_MS);
  } catch {
    return [];
  }
}

export function Splash({ onDone }: SplashProps): React.JSX.Element {
  const [covers, setCovers] = useState<string[]>([]);
  const [prints, setPrints] = useState<Print[]>([]);
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;
  const idRef = useRef(0);
  const lastRef = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let alive = true;
    let introElapsed = false;
    let coversSettled = false;
    let done = false;
    const maybeFinish = () => {
      if (!done && introElapsed && coversSettled) {
        done = true;
        onDoneRef.current();
      }
    };
    const introTimer = window.setTimeout(() => {
      introElapsed = true;
      maybeFinish();
    }, INTRO_MS);
    const capTimer = window.setTimeout(() => {
      coversSettled = true;
      maybeFinish();
    }, CAP_MS);
    void loadCovers().then((urls) => {
      if (!alive || coversSettled) {
        return;
      }
      coversSettled = true;
      if (urls.length > 0) {
        setCovers(urls);
      }
      maybeFinish();
    });
    return () => {
      alive = false;
      window.clearTimeout(introTimer);
      window.clearTimeout(capTimer);
    };
  }, []);

  const newest = prints.length === 0 ? -1 : prints[prints.length - 1].id;

  return (
    <div
      className={styles.overlay}
      onPointerMove={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        const last = lastRef.current;
        if (last !== null) {
          const dx = x - last.x;
          const dy = y - last.y;
          if (dx * dx + dy * dy < PRINT_GAP_PX_SQ) {
            return;
          }
        }
        lastRef.current = { x, y };
        idRef.current += 1;
        const id = idRef.current;
        setPrints((prev) => {
          const next = [...prev, { x, y, left: id % 2 === 0, id }];
          return next.length > MAX_PRINTS ? next.slice(next.length - MAX_PRINTS) : next;
        });
      }}
    >
      <div className={styles.grid} aria-hidden={true} />
      <div className={styles.covers} aria-hidden={true}>
        {covers.map((url) => (
          <img key={url} src={url} alt="" className={styles.cover} />
        ))}
      </div>
      <div className={styles.scrim} aria-hidden={true} />
      <div className={styles.prints} aria-hidden={true}>
        {prints.map((p) => (
          <span
            key={p.id}
            className={styles.pin}
            style={{ left: p.x, top: p.y }}
          >
            <span className={p.left ? styles.turnLeft : styles.turnRight}>
              <PawPrint
                weight="fill"
                className={p.id === newest ? styles.pawNew : styles.paw}
              />
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}
