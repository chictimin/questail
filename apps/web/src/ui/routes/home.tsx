/**
 * U1 자리 스텁 — 홈 본문은 범위 밖(U2)에서 채운다. 메뉴·라우트 확인용 최소 틀이다.
 */
import { useLocale } from '../i18n/context.js';
import '../stub/stub.css';

export function HomePage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="home">
      <div className="stub-head">
        <h1 className="stub-title">{text('nav.home')}</h1>
        <p className="stub-desc">{text('nav.homeGuide')}</p>
      </div>
    </main>
  );
}
