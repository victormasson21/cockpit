// Modal.tsx — generic themed overlay: scrim + centered panel; click scrim, ✕, or Escape to close.
import { useEffect, type ReactNode } from "react";
import { CloseIcon } from "./icons";
import "./Modal.css";

export function Modal({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
  // Escape closes the modal (universal for every Modal). Respects a caller's guarded onClose (e.g. a
  // busy no-op in TeardownConfirm), since it just invokes the same prop the scrim/✕ do.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="modal__scrim" onClick={onClose}>
      {/* className lets a caller widen/reshape the panel (e.g. Settings' sidebar layout) without touching other modals. */}
      <div className={className ? `modal__panel ${className}` : "modal__panel"} onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          <button className="icon-btn modal__close" aria-label="close" onClick={onClose}><CloseIcon /></button>
        </div>
        <div className="modal__content">{children}</div>
      </div>
    </div>
  );
}
