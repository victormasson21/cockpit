// HeaderTimer.tsx — compact countdown mirror in the app header, visible across all views.
// Shares store state with TimerTile; play/pause + reset here, full controls in the tile.
import { formatTime } from "./timer";
import { useSettings } from "../../settings/store";
import { PlayIcon, PauseIcon, RestartIcon } from "../../views/icons";
import "./headerTimer.css";

export function HeaderTimer() {
  const remaining = useSettings((s) => s.timerRemaining);
  const running = useSettings((s) => s.timerRunning);
  const startTimer = useSettings((s) => s.startTimer);
  const pauseTimer = useSettings((s) => s.pauseTimer);
  const resetTimer = useSettings((s) => s.resetTimer);

  const done = remaining === 0;

  return (
    <div className={`header-timer ${done ? "header-timer--done" : ""}`} title="Timer">
      <span className="header-timer__time">{formatTime(remaining)}</span>
      {running
        ? <button className="header-timer__btn" onClick={pauseTimer} aria-label="pause timer"><PauseIcon /></button>
        : <button className="header-timer__btn" onClick={startTimer} disabled={done} aria-label="start timer"><PlayIcon /></button>}
      <button className="header-timer__btn" onClick={resetTimer} aria-label="reset timer"><RestartIcon /></button>
    </div>
  );
}
