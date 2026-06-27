// TimerTile.tsx — a simple configurable countdown (default 25 min); session-only state.
import { useEffect, useRef, useState } from "react";
import { Tile } from "../Tile";
import { formatTime } from "./timer";
import "./timer.css";

export function TimerTile() {
  const [minutes, setMinutes] = useState(25);
  const [remaining, setRemaining] = useState(25 * 60); // seconds
  const [running, setRunning] = useState(false);
  const tick = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  // Drive the countdown while running; stop at zero. Cleared on pause/reset/unmount.
  useEffect(() => {
    if (!running) return;
    tick.current = setInterval(() => {
      setRemaining((r) => {
        if (r <= 1) { clearInterval(tick.current); setRunning(false); return 0; }
        return r - 1;
      });
    }, 1000);
    return () => clearInterval(tick.current);
  }, [running]);

  const start = () => { if (remaining > 0) setRunning(true); };
  const pause = () => setRunning(false);
  const reset = () => { setRunning(false); setRemaining(minutes * 60); };
  // Edit minutes only while truly idle (at a full, un-started duration); keep the display in sync.
  const editMinutes = (m: number) => { const v = Math.max(1, Math.min(180, Math.floor(m) || 0)); setMinutes(v); setRemaining(v * 60); };

  const done = remaining === 0;
  const idleFull = !running && remaining === minutes * 60;

  return (
    <Tile title="TIMER" icon={<span>⏱</span>}>
      <div className="timer">
        <div className={`timer__time ${done ? "timer__time--done" : ""}`}>{formatTime(remaining)}</div>
        <div className="timer__controls">
          {!running
            ? <button className="timer__btn timer__btn--primary" onClick={start} disabled={done}>Start</button>
            : <button className="timer__btn timer__btn--primary" onClick={pause}>Pause</button>}
          <button className="timer__btn" onClick={reset}>Reset</button>
          {idleFull && (
            <label className="timer__min">
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => editMinutes(Number(e.target.value))} /> min
            </label>
          )}
        </div>
      </div>
    </Tile>
  );
}
