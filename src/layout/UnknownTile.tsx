// UnknownTile.tsx — placeholder for a tile whose type isn't registered; keeps one bad tile from breaking the layout.
export function UnknownTile({ type }: { type: string }) {
  return <div style={{ padding: 16, opacity: 0.6 }}>Unknown tile: {type}</div>;
}
