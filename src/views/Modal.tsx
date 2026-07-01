// Modal.tsx — generic themed overlay: scrim + centered panel; click scrim or ✕ to close.
import type { ReactNode } from "react";
import { CloseIcon } from "./icons";
import "./Modal.css";

export function Modal({ title, onClose, children, className }: { title: string; onClose: () => void; children: ReactNode; className?: string }) {
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
