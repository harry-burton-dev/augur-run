import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Status } from './shared.ts';

const down = (s: Status) => (s.components ?? []).filter((c) => c.state && c.state !== 'up').map((c) => c.name);

/**
 * The fault drill (CUJ 4): at 03:00 UTC on the run's first night the operator stops one service, then
 * starts it again. The suite watches Status from just before, so the drill is on the record with its
 * times, and sees the part go down and come back. The alert itself goes to deployment admins, a role no
 * sample person has (the seed never gives it), so whether the notice and the email came within 5 minutes
 * is for the operator to record against the times written here.
 */
export const faultDrill: Scenario = {
  id: 'RUN-12',
  title: 'A failure alerts an absent admin',
  owner: 'platform',
  goals: [23],
  cuj: 4,
  given: 'Staging running normally, with Grafana alerting (PER-181) and the mail relay.',
  when: 'At 03:00 UTC on the first night the operator stops one service (the fault drill), then starts it again.',
  then: 'Status shows the part down, then up again, with the times recorded; the operator records that a notice and an email reached a deployment admin within 5 minutes, one per incident, with a recovery notice after.',
  cadence: { kind: 'daily', atUtc: '02:58', graceMinutes: 0 },
  needs: [{ as: 'watcher', role: 'admin' }],
  available: async (ctx) => {
    if (ctx.dry) return { ok: false, why: 'The fault drill happens only in the timed run, at 03:00 UTC on its first night.' };
    if (ctx.state.drillSeenAt) return { ok: false, why: `The fault drill ran on the first night (${String(ctx.state.drillSeenAt)}); it isn’t repeated.` };
    const r = await ctx.parts.watcher!.api.get<Status>(PATHS.status);
    if (!r.ok) return { ok: false, why: `Status can’t be read (${r.status}).` };
    const already = down(r.body);
    return already.length ? { ok: false, why: `${already.join(', ')} ${already.length === 1 ? 'is' : 'are'} already down before the drill, so the drill can’t be told apart.`, whoCanChange: 'The operator, by bringing the part back before 03:00 UTC.' } : { ok: true };
  },
  run: async (ctx) => {
    const { api } = ctx.parts.watcher!;
    const read = async () => {
      const r = await api.get<Status>(PATHS.status);
      return r.ok ? down(r.body) : undefined;
    };
    const stopped = await ctx.eventually(async () => {
      const d = await read();
      return { ok: !!d?.length, value: d ?? [] };
    }, { withinMs: 15 * MINUTE, everyMs: 15_000 });
    if (!ctx.check('Status shows the part the operator stopped as down', stopped.ok, { expected: 'a part down between 02:58 and 03:13 UTC', actual: 'every part stayed up' })) return;
    const downAt = ctx.now().toISOString();
    ctx.state.drillSeenAt = downAt;
    const back = await ctx.eventually(async () => {
      const d = await read();
      return { ok: !!d && d.length === 0, value: d ?? [] };
    }, { withinMs: 30 * MINUTE, everyMs: 15_000 });
    ctx.check(`${stopped.value.join(', ')} comes back up`, back.ok, { expected: 'every part up within 30 minutes', actual: back.value });
    ctx.note('Fault drill: record the alert against these times. A deployment admin should have had a notice and an email within 5 minutes of the part going down, and a "Cleared" notice after it came back.', {
      parts: stopped.value,
      downSeenAt: downAt,
      upSeenAt: back.ok ? ctx.now().toISOString() : undefined,
    });
  },
};
