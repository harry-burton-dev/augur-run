// RUN-12 on the timed run's first night, against a Status that goes down and comes back.
import { describe, expect, it } from 'vitest';
import type { ScenarioContext } from '../../src/scenario.ts';
import { faultDrill } from './run-12-fault-drill.ts';

const night = (states: string[][]) => {
  let t = Date.UTC(2026, 10, 11, 2, 58);
  let read = 0;
  const checks: { label: string; ok: boolean }[] = [];
  const notes: unknown[] = [];
  const state: Record<string, unknown> = {};
  const api = {
    get: async () => {
      const now = states[Math.min(read++, states.length - 1)]!;
      return { ok: true, status: 200, body: { components: [{ name: 'gateway', state: 'up' }, ...now.map((name) => ({ name, state: 'down' }))] } };
    },
  };
  const ctx = {
    parts: { watcher: { persona: { key: 'admin' }, api } },
    dry: false,
    state,
    now: () => new Date(t),
    check: (label: string, ok: boolean) => (checks.push({ label, ok }), ok),
    note: (_text: string, data?: unknown) => void notes.push(data),
    eventually: async <T>(probe: () => Promise<{ ok: boolean; value: T }>, o: { withinMs: number; everyMs?: number }) => {
      const from = t;
      for (;;) {
        const r = await probe();
        if (r.ok || t - from + (o.everyMs ?? 15_000) > o.withinMs) return { ...r, ms: t - from };
        t += o.everyMs ?? 15_000;
      }
    },
  } as unknown as ScenarioContext;
  return { ctx, checks, notes, state };
};

describe('RUN-12, the fault drill', () => {
  it('records the part going down and coming back, with the times for the operator', async () => {
    const n = night([[], [], ['identity'], ['identity'], []]);
    expect(await faultDrill.available!(n.ctx)).toEqual({ ok: true });
    await faultDrill.run(n.ctx);
    expect(n.checks.every((c) => c.ok)).toBe(true);
    expect(n.notes).toEqual([expect.objectContaining({ parts: ['identity'], downSeenAt: expect.any(String), upSeenAt: expect.any(String) })]);
    expect(await faultDrill.available!(n.ctx)).toMatchObject({ ok: false, why: expect.stringMatching(/isn’t repeated/) });
  });

  it('fails when no part goes down on the first night', async () => {
    const n = night([[]]);
    await faultDrill.run(n.ctx);
    expect(n.checks).toEqual([{ label: 'Status shows the part the operator stopped as down', ok: false }]);
  });
});
