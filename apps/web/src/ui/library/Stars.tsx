/** W7 별 입력 — role=slider 단일 탭 정지. 반쪽 히트는 포인터만, 키보드는 상태 함수. */
import { useState } from 'react';
import { Star } from '@phosphor-icons/react';
import { t, type Locale } from '../i18n/index.js';
import { starsValueText } from './format.js';
import { starsTransition, previewAttrs, type StarsKeyInput } from './stars-state.js';

export interface StarsProps {
  /** 확정값 — 저장 단위 1~10, 미평가 null. */
  value: number | null;
  disabled?: boolean;
  locale: Locale;
  /** 별 단위 0.5~5 또는 null(취소). */
  onCommit: (stars: number | null) => void;
  /** 슬라이더 안에 수치(미평가 '–')를 함께 렌더. 별 필터 바·행에서 쓴다. */
  showValue?: boolean;
}

function currentStars(value: number | null): number | null {
  return value === null ? null : value / 2;
}

/** 별 1개 채움 비율 — 0 · 50 · 100. 색은 CSS가 맡는다. */
function starFill(displayed: number | null, index: number): number {
  if (displayed !== null && displayed >= index + 1) return 100;
  if (displayed !== null && displayed >= index + 0.5) return 50;
  return 0;
}

export function Stars({ value, disabled, locale, onCommit, showValue }: StarsProps): React.JSX.Element {
  const [preview, setPreview] = useState<number | null>(null);
  const current = currentStars(value);
  const displayed = preview ?? current;
  const locked = disabled === true;

  const apply = (key: StarsKeyInput): void => {
    if (locked) return;
    const next = starsTransition(current, preview, key);
    if (next.commit !== undefined) {
      setPreview(null);
      onCommit(next.commit);
    } else {
      setPreview(next.preview);
    }
  };

  const halves: number[] = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5];

  return (
    <div
      className="stars"
      role="slider"
      tabIndex={locked ? -1 : 0}
      {...previewAttrs(preview)}
      data-rated={value === null ? undefined : 'true'}
      aria-label={t(locale, 'library.ariaStars')}
      aria-valuemin={0.5}
      aria-valuemax={5}
      aria-valuenow={displayed ?? undefined}
      aria-valuetext={starsValueText(value, locale)}
      aria-disabled={locked || undefined}
      onKeyDown={(event) => {
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          apply('left');
        } else if (event.key === 'ArrowRight') {
          event.preventDefault();
          apply('right');
        } else if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          apply(event.key === 'Enter' ? 'enter' : 'space');
        } else if (event.key === 'Delete' || event.key === 'Backspace') {
          event.preventDefault();
          apply('delete');
        } else if (event.key === 'Escape') {
          apply('escape');
        } else if (['1', '2', '3', '4', '5'].includes(event.key)) {
          apply({ digit: Number(event.key) });
        }
      }}
      onBlur={() => apply('blur')}
      onMouseLeave={() => apply('leave')}
    >
      <span className="stars-row" aria-hidden>
        {[0, 1, 2, 3, 4].map((index) => (
          <span key={index} className="star-unit">
            <Star className="star-bg" aria-hidden />
            <span
              className="star-fill"
              style={{ width: `${starFill(displayed, index)}%` }}
            >
              <Star weight="fill" aria-hidden />
            </span>
            {[0, 1].map((half) => {
              const stars = halves[index * 2 + half] as number;
              return (
                <button
                  key={half}
                  type="button"
                  tabIndex={-1}
                  aria-hidden
                  disabled={locked}
                  className={half === 0 ? 'star-hit star-hit--left' : 'star-hit star-hit--right'}
                  onMouseEnter={() => apply({ hover: stars })}
                  onFocus={() => apply({ hover: stars })}
                  onClick={() => {
                    if (locked) return;
                    const next = starsTransition(current, preview, {
                      hover: stars,
                    });
                    const target = next.preview;
                    setPreview(null);
                    onCommit(target === current ? null : target);
                  }}
                />
              );
            })}
          </span>
        ))}
      </span>
      {showValue === true ? (
        <span className="stars-num">
          {displayed === null ? '–' : displayed.toFixed(1)}
        </span>
      ) : null}
    </div>
  );
}
