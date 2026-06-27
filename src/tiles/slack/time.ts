// time.ts — compact relative-time label for Slack rows (Slack ts is epoch seconds, possibly fractional).
export function relativeTime(tsSeconds: number, nowMs: number): string {
  const deltaSec = Math.max(0, Math.floor(nowMs / 1000 - tsSeconds));
  if (deltaSec < 60) return "now";
  if (deltaSec < 3600) return `${Math.floor(deltaSec / 60)}m`;
  if (deltaSec < 86400) return `${Math.floor(deltaSec / 3600)}h`;
  return `${Math.floor(deltaSec / 86400)}d`;
}
