/**
 * U1 자리 스텁 — 리캡 본문은 범위 밖(U3)에서 채운다. 메뉴·라우트 확인용 최소 틀이다.
 */
import { useLocale } from '../i18n/context.js';
import '../stub/stub.css';

export function RecapPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="recap">
      <div className="stub-head">
        <h1 className="stub-title">{text('nav.recap')}</h1>
        <p className="stub-desc">{text('nav.recapGuide')}</p>
      </div>
    </main>
  );
}
