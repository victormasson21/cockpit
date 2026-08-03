// timerStore.test.ts — the countdown's store behaviour (the pure tick/format helpers are in timer.test.ts).
import { describe, it, expect, beforeEach } from "vitest";
import { useTimer } from "./timerStore";

const reset = () => useTimer.setState({ minutes: 25, remaining: 25 * 60, running: false });

describe("useTimer", () => {
  beforeEach(reset);

  it("starts and pauses", () => {
    useTimer.getState().start();
    expect(useTimer.getState().running).toBe(true);
    useTimer.getState().pause();
    expect(useTimer.getState().running).toBe(false);
  });

  it("refuses to start a finished countdown", () => {
    useTimer.setState({ remaining: 0 });
    useTimer.getState().start();
    expect(useTimer.getState().running).toBe(false);
  });

  it("tick counts down while running and is a no-op while paused", () => {
    useTimer.setState({ remaining: 10, running: true });
    useTimer.getState().tick();
    expect(useTimer.getState().remaining).toBe(9);
    useTimer.getState().pause();
    useTimer.getState().tick();
    expect(useTimer.getState().remaining).toBe(9);
  });

  it("tick stops the countdown when it lands on zero", () => {
    useTimer.setState({ remaining: 1, running: true });
    useTimer.getState().tick();
    expect(useTimer.getState()).toMatchObject({ remaining: 0, running: false });
  });

  it("reset re-arms the full duration and stops", () => {
    useTimer.setState({ minutes: 5, remaining: 12, running: true });
    useTimer.getState().reset();
    expect(useTimer.getState()).toMatchObject({ remaining: 300, running: false });
  });

  it("setMinutes clamps to 1..180 and re-arms the countdown", () => {
    useTimer.getState().setMinutes(0);
    expect(useTimer.getState()).toMatchObject({ minutes: 1, remaining: 60 });
    useTimer.getState().setMinutes(999);
    expect(useTimer.getState()).toMatchObject({ minutes: 180, remaining: 180 * 60 });
    useTimer.getState().setMinutes(7.9); // floored
    expect(useTimer.getState()).toMatchObject({ minutes: 7, remaining: 420 });
  });

  it("setMinutes treats junk as the minimum, not NaN", () => {
    useTimer.getState().setMinutes(Number.NaN);
    expect(useTimer.getState().minutes).toBe(1);
  });
});
