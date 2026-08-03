// HeaderTimer.tsx — compact countdown mirror in the app header, visible across all views.
// Shares store state with TimerTile; play/pause + reset here, full controls in the tile.
import { formatTime } from "./timer";
import { useTimer } from "./timerStore";
import { PlayIcon, PauseIcon, RestartIcon } from "../../views/icons";
import "./headerTimer.css";

export function HeaderTimer() {
  const remaining = useTimer((s) => s.remaining);
  const running = useTimer((s) => s.running);
  const start = useTimer((s) => s.start);
  const pause = useTimer((s) => s.pause);
  const reset = useTimer((s) => s.reset);

  const done = remaining === 0;

  return (
    <div className={`header-timer ${done ? "header-timer--done" : ""}`} title="Timer">
      <span className="header-timer__time">{formatTime(remaining)}</span>
      {running
        ? <button className="header-timer__btn" onClick={pause} aria-label="pause timer"><PauseIcon /></button>
        : <button className="header-timer__btn" onClick={start} disabled={done} aria-label="start timer"><PlayIcon /></button>}
      <button className="header-timer__btn" onClick={reset} aria-label="reset timer"><RestartIcon /></button>
    </div>
  );
}
