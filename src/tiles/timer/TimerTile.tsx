// TimerTile.tsx — configurable countdown (default 25 min); state lives in the store so it
// survives view switches (App drives the tick). Full controls; the header shows a compact mirror.
import { Tile } from "../Tile";
import { formatTime } from "./timer";
import { useSettings } from "../../settings/store";
import "./timer.css";

export function TimerTile() {
  const minutes = useSettings((s) => s.timerMinutes);
  const remaining = useSettings((s) => s.timerRemaining);
  const running = useSettings((s) => s.timerRunning);
  const startTimer = useSettings((s) => s.startTimer);
  const pauseTimer = useSettings((s) => s.pauseTimer);
  const resetTimer = useSettings((s) => s.resetTimer);
  const setTimerMinutes = useSettings((s) => s.setTimerMinutes);

  const done = remaining === 0;
  // Edit minutes only while truly idle (at a full, un-started duration).
  const idleFull = !running && remaining === minutes * 60;

  return (
    <Tile title="TIMER" icon={<span>⏱</span>}>
      <div className="timer">
        <div className={`timer__time ${done ? "timer__time--done" : ""}`}>{formatTime(remaining)}</div>
        <div className="timer__controls">
          {!running
            ? <button className="timer__btn timer__btn--primary" onClick={startTimer} disabled={done}>Start</button>
            : <button className="timer__btn timer__btn--primary" onClick={pauseTimer}>Pause</button>}
          <button className="timer__btn" onClick={resetTimer}>Reset</button>
          {idleFull && (
            <label className="timer__min">
              <input type="number" min={1} max={180} value={minutes} onChange={(e) => setTimerMinutes(Number(e.target.value))} /> min
            </label>
          )}
        </div>
      </div>
    </Tile>
  );
}
