import { describe, expect, it } from 'vitest';
import { rng } from './personas.ts';
import type { Scenario } from './scenario.ts';
import { dryPlan, hourIn, plan, play, timesOf, type Clock } from './timeline.ts';

const H = 3_600_000;
const start = Date.UTC(2026, 10, 10, 12, 0); // midday UTC
const day = { timeZone: 'UTC', startHour: 7, endHour: 19 };
const s = (id: string, cadence: Scenario['cadence']): Scenario => ({ id, title: id, owner: 'platform', goals: [36], given: '', when: '', then: '', cadence, needs: [{ as: 'anyone' }], run: async () => {} });

describe('the timeline', () => {
  it('fires a daily job each day it falls inside the run, after its grace time', () => {
    const times = timesOf({ kind: 'daily', atUtc: '02:00', graceMinutes: 45 }, start, start + 48 * H, { random: rng(1), day });
    expect(times.map((t) => new Date(t).toISOString())).toEqual(['2026-11-11T02:45:00.000Z', '2026-11-12T02:45:00.000Z']);
  });

  it('is busy in the working day and quiet at night', () => {
    const times = timesOf({ kind: 'every', minutes: 10, quietMinutes: 60 }, start, start + 24 * H, { random: rng(2), day });
    const busy = times.filter((t) => hourIn(t, 'UTC') >= 7 && hourIn(t, 'UTC') < 19).length;
    const quiet = times.length - busy;
    // About 6 an hour for 12 working hours, about 1 an hour for the other 12.
    expect(busy).toBeGreaterThan(55);
    expect(quiet).toBeLessThan(20);
  });

  it('skips the night for a cadence with no quiet gap', () => {
    const times = timesOf({ kind: 'every', minutes: 30 }, start, start + 24 * H, { random: rng(3), day });
    expect(times.every((t) => hourIn(t, 'UTC') >= 7 && hourIn(t, 'UTC') < 20)).toBe(true);
  });

  it('follows the organisation’s time zone', () => {
    expect(hourIn(Date.UTC(2026, 6, 1, 12), 'Europe/London')).toBe(13);
  });

  it('plans 48 hours in order, and a dry run as every scenario once', () => {
    const list = [s('RUN-02', { kind: 'once', afterMinutes: 5 }), s('RUN-10', { kind: 'daily', atUtc: '02:00' }), s('RUN-01', { kind: 'every', minutes: 120, quietMinutes: 240 })];
    const events = plan(list, { start, hours: 48, random: rng(4), day });
    expect(events.map((e) => e.at)).toEqual([...events.map((e) => e.at)].sort((a, b) => a - b));
    expect(events.filter((e) => e.scenario === 'RUN-10')).toHaveLength(2);
    expect(dryPlan(list, start).map((e) => e.scenario)).toEqual(['RUN-01', 'RUN-02', 'RUN-10']);
  });

  it('plays events at their times, a few at once, and reports one that starts late', async () => {
    let t = 0;
    const clock: Clock = { now: () => t, sleep: async (ms) => void (t += ms) };
    const ran: [string, number][] = [];
    const late: string[] = [];
    await play(
      [
        { at: 1000, scenario: 'a' },
        { at: 2000, scenario: 'b' },
        { at: 2500, scenario: 'c' },
      ],
      {
        clock,
        parallel: 1,
        lateAfterMs: 1000,
        late: (e) => late.push(e.scenario),
        run: async (e) => {
          ran.push([e.scenario, t]);
          if (e.scenario === 'b') t += 3000; // b takes long, so c starts late
        },
      },
    );
    expect(ran).toEqual([
      ['a', 1000],
      ['b', 2000],
      ['c', 5000],
    ]);
    expect(late).toEqual(['c']);
  });
});
