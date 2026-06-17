// TerminalPane.tsx — one labelled terminal pane (title bar + restart) wrapping a single PTY-bound xterm.
import { useTerminal, type UseTerminalArgs } from "./useTerminal";

export function TerminalPane({ title, ...args }: UseTerminalArgs & { title: string }) {
  const { containerRef, restart } = useTerminal(args);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 6px", fontSize: 11, opacity: 0.7 }}>
        <span>{title}</span>
        <button style={{ marginLeft: "auto", fontSize: 11 }} onClick={restart}>restart</button>
      </div>
      <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
    </div>
  );
}
