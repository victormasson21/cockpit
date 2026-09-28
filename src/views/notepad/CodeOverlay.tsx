// CodeOverlay.tsx — the coloured mirror under the notepad's transparent-text textarea: same text, same
// metrics (shared .notepad__text class), spans only inside the code regions, scrolled with the editor.
import { Fragment, useDeferredValue, useLayoutEffect, useMemo, type RefObject } from "react";
import { overlaySegments } from "./highlight";

// Scroll is copied onto the <pre> as a DOM write (the editor's onScroll does the same), never as state:
// a transform would move the clipped box out of view, and state would re-render the column per scroll.
export function syncScroll(pre: HTMLElement | null, editor: HTMLElement | null): void {
  if (pre && editor) pre.scrollTop = editor.scrollTop;
}

export function CodeOverlay({ ref, editorRef, text }: {
  ref: RefObject<HTMLPreElement | null>;
  editorRef: RefObject<HTMLTextAreaElement | null>;
  text: string;
}) {
  // Deferred so a keystroke never waits for tokenizing; the overlay catches up a frame later.
  const deferred = useDeferredValue(text);
  const segments = useMemo(() => overlaySegments(deferred), [deferred]);
  // The browser caps scrollTop while the content is shorter, so re-sync after each content commit.
  useLayoutEffect(() => syncScroll(ref.current, editorRef.current), [segments, ref, editorRef]);
  return (
    <pre ref={ref} className="notepad__text notepad__overlay" aria-hidden>
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
