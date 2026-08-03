// timerStore.ts — the countdown's own store. Deliberately NOT part of useSettings: the timer writes
// once a second, and every bare `useSettings()` subscription would re-render on each tick — including
// SlotColumn, which holds the terminals. Nothing here is persisted, so it shares nothing with settings.
// It lives in the store (not a component) so the countdown survives view switches, which unmount the tile.
import { create } from "zustand";
import { tick } from "./timer";

const TIMER_DEFAULT_MIN = 25;
const MIN_MINUTES = 1;
const MAX_MINUTES = 180;

interface TimerState {
  minutes: number;
  remaining: number; // seconds
  running: boolean;
  start: () => void;
  pause: () => void;
  reset: () => void;
  setMinutes: (m: number) => void;
  tick: () => void; // App drives this on a 1s interval while `running`
}

export const useTimer = create<TimerState>((set) => ({
  minutes: TIMER_DEFAULT_MIN,
  remaining: TIMER_DEFAULT_MIN * 60,
  running: false,
  // Refuse to start a finished countdown (the UI also disables the button); reset re-arms it.
  start: () => set((st) => (st.remaining > 0 ? { running: true } : st)),
  pause: () => set({ running: false }),
  reset: () => set((st) => ({ running: false, remaining: st.minutes * 60 })),
  // Clamp to a sane range and re-arm the countdown to the new full duration (editable only while idle).
  setMinutes: (m) => {
    const v = Math.max(MIN_MINUTES, Math.min(MAX_MINUTES, Math.floor(m) || 0));
    set({ minutes: v, remaining: v * 60 });
  },
  tick: () =>
    set((st) => {
      if (!st.running) return st;
      const { remaining, running } = tick(st.remaining);
      return { remaining, running };
    }),
}));
