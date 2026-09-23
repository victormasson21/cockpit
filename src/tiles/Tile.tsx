// Tile.tsx — shared tile chrome: icon + uppercase title + optional actions slot, over a bordered body.
import type { ReactNode } from "react";
import "./Tile.css";

export function Tile({ title, icon, actions, className, children }: {
  title: string;
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`tile${className ? ` ${className}` : ""}`}>
      <header className="tile__head">
        {icon && <span className="tile__icon">{icon}</span>}
        <span className="tile__title">{title}</span>
        {actions && <span className="tile__actions">{actions}</span>}
      </header>
      <div className="tile__body">{children}</div>
    </section>
  );
}
