// Dropdown.tsx — themed <select> replacement: trigger button + popover listbox (macOS renders the native popup; CSS can't style it).
// Heading variant supports optional inline title edit: pass onRename + editValue to split the trigger into an editable label + a chevron button.
import { useEffect, useRef, useState } from "react";
import { selectedLabel, sanitizeTitle, type DropdownGroup } from "./dropdownModel";
import { ChevronIcon, TickIcon } from "./icons";
import "./Dropdown.css";

export function Dropdown({ value, onChange, groups, placeholder, variant, onRename, editValue }: {
  value: string | null;
  onChange: (value: string) => void;
  groups: DropdownGroup[];
  placeholder: string;
  variant: "heading" | "form";
  onRename?: (value: string) => void; // present → the label is click-to-edit; the chevron alone opens the popover
  editValue?: string;                 // raw value to seed the edit input (the entity name/title, not the composed label)
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  // Close on outside click — listener only lives while open.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  // Escape closes the popover; stopPropagation keeps a host modal's own Escape handler from also firing.
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (open && e.key === "Escape") { e.stopPropagation(); setOpen(false); }
  };

  // Commit an inline rename: blank input is a no-op revert (no clear mechanism); always exit edit mode.
  const commit = (raw: string) => {
    const t = sanitizeTitle(raw);
    if (t && onRename) onRename(t);
    setEditing(false);
  };

  const label = <span className="dd__label">{selectedLabel(groups, value, placeholder)}</span>;

  return (
    <div className={`dd dd--${variant}`} ref={rootRef} onKeyDown={onKeyDown}>
      {editing ? (
        // Inline title editor: Enter/blur commit, Escape reverts (stopPropagation so the popover Escape doesn't also fire).
        <input
          className="dd__edit" autoFocus defaultValue={editValue ?? ""}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit((e.target as HTMLInputElement).value);
            else if (e.key === "Escape") { e.stopPropagation(); setEditing(false); }
          }}
          onBlur={(e) => commit(e.target.value)}
        />
      ) : onRename ? (
        // Split trigger: label click → edit; chevron button → popover (styled like the nearby gear).
        <>
          <button type="button" className="dd__trigger dd__trigger--editable" onClick={() => setEditing(true)}>
            {label}
          </button>
          <button type="button" className="dd__chevron-btn icon-btn" aria-label="switch worktree" onClick={() => setOpen((o) => !o)}>
            <ChevronIcon open />
          </button>
        </>
      ) : (
        <button type="button" className="dd__trigger" onClick={() => setOpen((o) => !o)}>
          {label}
          <span className="dd__chevron" aria-hidden><ChevronIcon open /></span>
        </button>
      )}
      {open && (
        <div className="dd__pop" role="listbox">
          {groups.map((g, i) => (
            <div key={g.label ?? i}>
              {g.label && <div className="dd__group">{g.label}</div>}
              {g.options.map((o) => (
                <button
                  type="button" key={o.value} role="option" disabled={o.disabled}
                  aria-selected={o.value === value}
                  className={`dd__opt${o.value === value ? " dd__opt--selected" : ""}`}
                  onClick={() => { onChange(o.value); setOpen(false); }}
                >
                  <span className="dd__opt-label">{o.label}</span>
                  {o.hint && <span className="dd__opt-hint">{o.hint}</span>}
                  {o.value === value && <span className="dd__tick"><TickIcon /></span>}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
