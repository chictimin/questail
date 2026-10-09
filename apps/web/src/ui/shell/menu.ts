/** U4 셸 메뉴 정의 — Header·MobileHeader 공유. 아이콘 + 활성 스타일 + 심볼 보정. */
import { Books, CloudArrowDown, Export, GearSix } from '@phosphor-icons/react';

export const SHELL_MENU = [
  { href: '/library', label: 'nav.library', Icon: Books },
  { href: '/sync', label: 'nav.sync', Icon: CloudArrowDown },
  { href: '/settings', label: 'nav.settings', Icon: GearSix },
  { href: '/export', label: 'nav.export', Icon: Export },
] as const;
