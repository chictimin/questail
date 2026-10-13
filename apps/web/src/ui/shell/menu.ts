/**
 * U1 셸 메뉴 정의 — Header·MobileHeader 공유. 보는 화면 4 | 관리 화면 3, 사이 구분선 1개.
 * 순서(Na 확정안): 홈 · 리캡 · TBTI · 라이브러리 | 수집 상태 · 설정 · 내보내기.
 * 아이콘 실명(Phosphor 2.1.10): House · ChartBar · Tag. 구분선 수치는 shell.css가 갖는다.
 */
import {
  Books,
  ChartBar,
  CloudArrowDown,
  Export,
  GearSix,
  House,
  Tag,
  type Icon,
} from '@phosphor-icons/react';

export interface ShellMenuLink {
  href: string;
  label: `nav.${string}`;
  Icon: Icon;
  sep?: undefined;
}

export interface ShellMenuSeparator {
  sep: true;
}

export type ShellMenuEntry = ShellMenuLink | ShellMenuSeparator;

export const SHELL_MENU: readonly ShellMenuEntry[] = [
  { href: '/home', label: 'nav.home', Icon: House },
  { href: '/recap', label: 'nav.recap', Icon: ChartBar },
  { href: '/tbti', label: 'nav.tbti', Icon: Tag },
  { href: '/library', label: 'nav.library', Icon: Books },
  { sep: true },
  { href: '/sync', label: 'nav.sync', Icon: CloudArrowDown },
  { href: '/settings', label: 'nav.settings', Icon: GearSix },
  { href: '/export', label: 'nav.export', Icon: Export },
];
