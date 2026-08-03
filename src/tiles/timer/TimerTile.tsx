// TimerTile.tsx — configurable countdown (default 25 min); state lives in the store so it
// survives view switches (App drives the tick). Full controls; the header shows a compact mirror.
import { Tile } from "../Tile";
import { formatTime } from "./timer";
import { useTimer } from "./timerStore";
import "./timer.css";

export function TimerTile() {
  const minutes = useTimer((s) => s.minutes);
  const remaining = useTimer((s) => s.remaining);
  const running = useTimer((s) => s.running);
  const start = useTimer((s) => s.start);
  const pause = useTimer((s) => s.pause);
  const reset = useTimer((s) => s.reset);
  const setMinutes = useTimer((s) => s.setMinutes);

  const done = remaining === 0;
  // Edit minutes only while truly idle (at a full, un-started duration).
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
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} /> min
            </label>
          )}
        </div>
      </div>
    </Tile>
  );
}
