// timer.ts — pure countdown helpers: format mm:ss and advance one tick.
export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

// Advance the countdown by one second; at/below one second it lands on 00:00 and stops running.
export function tick(remaining: number): { remaining: number; running: boolean } {
  if (remaining <= 1) return { remaining: 0, running: false };
  return { remaining: remaining - 1, running: true };
}
