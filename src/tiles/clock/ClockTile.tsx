// ClockTile.tsx — stub tile showing the current time; exercises a self-updating tile.
import { useEffect, useState } from "react";
import type { TileProps } from "../registry";

export function ClockTile(_: TileProps<{}>) {
  const [now, setNow] = useState(() => new Date().toLocaleTimeString());
  // Tick once a second; clean up the interval on unmount.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date().toLocaleTimeString()), 1000);
    return () => clearInterval(t);
  }, []);
  return <div style={{ padding: 16, fontVariantNumeric: "tabular-nums" }}>{now}</div>;
}
