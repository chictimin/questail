/** U3a 수집 상태 pill 6종 — 단어+아이콘, 색만으로 구분하지 않는다. */
import {
  CheckCircle,
  CircleNotch,
  Clock,
  MinusCircle,
  PauseCircle,
  XCircle,
} from '@phosphor-icons/react';
import { useLocale } from '../i18n/context.js';
import type { SyncPill } from './statusMap.js';
import './sync.css';

const ICONS = {
  wait: Clock,
  run: CircleNotch,
  done: CheckCircle,
  hold: PauseCircle,
  fail: XCircle,
  off: MinusCircle,
} as const;

const WORDS = {
  wait: 'sync.pillWait',
  run: 'sync.pillRun',
  done: 'sync.pillDone',
  hold: 'sync.pillHold',
  fail: 'sync.pillFail',
  off: 'sync.pillOff',
} as const;

export function Pill({ pill }: { pill: SyncPill }): React.JSX.Element {
  const { text } = useLocale();
  const Icon = ICONS[pill];
  if (pill === 'run') {
    return (
      <span className={`sync-pill sync-pill--${pill}`}>
        <Icon size={14} className="sync-pill-spin" aria-hidden />
        <span className="sync-pill-shimmer">{text(WORDS[pill])}</span>
      </span>
    );
  }
  return (
    <span className={`sync-pill sync-pill--${pill}`}>
      <Icon size={14} aria-hidden />
      {text(WORDS[pill])}
    </span>
  );
}
