/**
 * U1 자리 스텁 — TBTI 본문은 범위 밖(U4)에서 채운다. 메뉴·라우트 확인용 최소 틀이다.
 */
import { useLocale } from '../i18n/context.js';
import '../stub/stub.css';

export function TbtiPage(): React.JSX.Element {
  const { text } = useLocale();
  return (
    <main data-route="tbti">
      <div className="stub-head">
        <h1 className="stub-title">{text('nav.tbti')}</h1>
        <p className="stub-desc">{text('nav.tbtiGuide')}</p>
      </div>
    </main>
  );
}
