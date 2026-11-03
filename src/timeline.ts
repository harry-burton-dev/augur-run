// The run's timeline: when each scenario happens across the 48 wall-clock hours (ADR 0050). Busy in the
// organisation's working day, quieter at night, with daily jobs checked after they are due. The server
// clock is never faked; the suite's own clock is a parameter only so its tests can use fake timers.
import type { Cadence, Scenario } from './scenario.ts';

export type Event = { at: number; scenario: string };

export type Clock = { now: () => number; sleep: (ms: number) => Promise<void> };
export const realClock: Clock = { now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)) };

const MINUTE = 60_000;

/** The working day, in the organisation's time zone. Outside it, `every` cadences use their quiet gap. */
export type WorkingDay = { timeZone: string; startHour: number; endHour: number };
export const DEFAULT_DAY: WorkingDay = { timeZone: 'UTC', startHour: 7, endHour: 19 };

export const hourIn = (t: number, timeZone: string) => {
  const h = new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(new Date(t));
  return Number(h);
};

const working = (t: number, day: WorkingDay) => {
  const h = hourIn(t, day.timeZone);
  return h >= day.startHour && h < day.endHour;
};

/** The times one cadence fires in [start, end). `jitter` spreads repeats so personas don't move in step. */
export const timesOf = (cadence: Cadence, start: number, end: number, o: { random: () => number; day: WorkingDay }): number[] => {
  if (cadence.kind === 'once') {
    const at = start + (cadence.afterMinutes ?? 0) * MINUTE;
    return at < end ? [at] : [];
  }
  if (cadence.kind === 'daily') {
    const [hh, mm] = cadence.atUtc.split(':').map(Number);
    const out: number[] = [];
    const first = new Date(start);
    first.setUTCHours(hh ?? 0, mm ?? 0, 0, 0);
    for (let due = first.getTime(); due < end; due += 24 * 60 * MINUTE) {
      const at = due + (cadence.graceMinutes ?? 30) * MINUTE;
      if (due >= start && at < end) out.push(at);
    }
    return out;
  }
  const out: number[] = [];
  for (let t = start + o.random() * cadence.minutes * MINUTE; t < end; ) {
    const gap = working(t, o.day) ? cadence.minutes : cadence.quietMinutes;
    if (gap === undefined) {
      // Nothing outside the working day: skip ahead an hour at a time until it starts again.
      t += 60 * MINUTE;
      continue;
    }
    out.push(Math.round(t));
    t += gap * MINUTE * (0.75 + o.random() * 0.5);
  }
  return out;
};

/** Every event of a timeline run, in order. */
export const plan = (scenarios: Scenario[], o: { start: number; hours: number; random: () => number; day?: WorkingDay }): Event[] => {
  const end = o.start + o.hours * 60 * MINUTE;
  return scenarios
    .flatMap((s) => timesOf(s.cadence, o.start, end, { random: o.random, day: o.day ?? DEFAULT_DAY }).map((at) => ({ at, scenario: s.id })))
    .sort((a, b) => a.at - b.at || a.scenario.localeCompare(b.scenario));
};

/** The dry run: every scenario once, in id order, now. */
export const dryPlan = (scenarios: Scenario[], now: number): Event[] =>
  [...scenarios].sort((a, b) => a.id.localeCompare(b.id, 'en', { numeric: true })).map((s) => ({ at: now, scenario: s.id }));

/**
 * Plays a timeline: waits for each event's time, then runs it, with at most `parallel` events at once. An
 * event that starts more than `lateAfterMs` after its time is reported, so a slow run is visible.
 */
export const play = async (events: Event[], o: { clock: Clock; parallel?: number; run: (e: Event) => Promise<void>; late?: (e: Event, byMs: number) => void; lateAfterMs?: number; stop?: () => boolean }) => {
  const limit = o.parallel ?? 4;
  const running = new Set<Promise<void>>();
  for (const e of events) {
    if (o.stop?.()) break;
    const wait = e.at - o.clock.now();
    if (wait > 0) await o.clock.sleep(wait);
    while (running.size >= limit) await Promise.race(running);
    const late = o.clock.now() - e.at;
    if (late > (o.lateAfterMs ?? 5 * MINUTE)) o.late?.(e, late);
    const p = o.run(e).finally(() => running.delete(p));
    running.add(p);
  }
  await Promise.all(running);
};
