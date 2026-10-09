/** U4 워드마크 — Q(Azeret 400) + uestail(JetBrains 500). 폰트 미로드 시 시스템 폴백. */
export function Wordmark(): React.JSX.Element {
  return (
    <span className="wordmark" aria-label="Questail">
      <span className="wordmark-q" aria-hidden="true">
        Q
      </span>
      <span className="wordmark-rest" aria-hidden="true">
        uestail
      </span>
    </span>
  );
}
