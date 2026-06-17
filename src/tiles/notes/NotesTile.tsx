// NotesTile.tsx — stub tile with editable text; exercises a tile persisting its own config.
import type { TileProps } from "../registry";

interface NotesConfig { text: string }

export function NotesTile({ config, updateConfig }: TileProps<NotesConfig>) {
  return (
    <textarea
      style={{ width: "100%", height: "100%", border: "none", padding: 12, resize: "none" }}
      value={config.text}
      onChange={(e) => updateConfig({ text: e.target.value })}
      placeholder="Notes…"
    />
  );
}
