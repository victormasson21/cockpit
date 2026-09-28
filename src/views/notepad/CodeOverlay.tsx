// CodeOverlay.tsx — the coloured mirror under the notepad's transparent-text textarea: same text, same
// metrics (shared .notepad__text class), spans only inside the code regions, scrolled with the editor.
import { Fragment, useDeferredValue, useMemo } from "react";
import { overlaySegments } from "./highlight";

export function CodeOverlay({ text, scrollTop, scrollLeft }: { text: string; scrollTop: number; scrollLeft: number }) {
  // Deferred so a keystroke never waits for tokenizing; the overlay catches up a frame later.
  const deferred = useDeferredValue(text);
  const segments = useMemo(() => overlaySegments(deferred), [deferred]);
  return (
    <pre className="notepad__text notepad__overlay" aria-hidden style={{ transform: `translate(${-scrollLeft}px, ${-scrollTop}px)` }}>
      {segments.map((seg, i) => (
        <Fragment key={i}>
          {typeof seg === "string"
            ? seg
            : seg.map((t, j) => (t.kind === "text" ? t.text : <span key={j} className={`hl-${t.kind}`}>{t.text}</span>))}
        </Fragment>
      ))}
      {/* A trailing newline in a <pre> collapses; the textarea shows it as an empty line. Keep heights equal. */}
      {"\n"}
    </pre>
  );
}
