// Dropdown.tsx — themed <select> replacement: trigger button + popover listbox (macOS renders the native popup; CSS can't style it).
import { useEffect, useRef, useState } from "react";
import { selectedLabel, type DropdownGroup } from "./dropdownModel";
import { ChevronIcon, TickIcon } from "./icons";
import "./Dropdown.css";

export function Dropdown({ value, onChange, groups, placeholder, variant }: {
  value: string | null;
  onChange: (value: string) => void;
  groups: DropdownGroup[];
  placeholder: string;
  variant: "heading" | "form";
}) {
  const [open, setOpen] = useState(false);
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

  return (
    <div className={`dd dd--${variant}`} ref={rootRef} onKeyDown={onKeyDown}>
      <button type="button" className="dd__trigger" onClick={() => setOpen((o) => !o)}>
        <span className="dd__label">{selectedLabel(groups, value, placeholder)}</span>
        <span className="dd__chevron" aria-hidden><ChevronIcon open /></span>
      </button>
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
