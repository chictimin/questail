/** epoch 초 → 고정형 "YYYY-MM-DD HH:mm"(로컬 시각, 0 패딩). ko·en 동일. U5-[3] 백업 목록용. */
import type { Locale } from '../ui/i18n/index.js';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

export function formatDateTime(epochSeconds: number, _locale: Locale): string {
  const date = new Date(epochSeconds * 1000);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
