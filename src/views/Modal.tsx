// Modal.tsx — generic themed overlay: scrim + centered panel; click scrim or ✕ to close.
import type { ReactNode } from "react";
import "./Modal.css";

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="modal__scrim" onClick={onClose}>
      <div className="modal__panel" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <span className="modal__title">{title}</span>
          <button className="modal__close" aria-label="close" onClick={onClose}>✕</button>
        </div>
        <div className="modal__content">{children}</div>
      </div>
    </div>
  );
}
