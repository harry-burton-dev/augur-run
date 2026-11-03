import type { Scenario } from '../../src/scenario.ts';
import { isSynthetic } from '../../src/synthetic.ts';
import { MINUTE, PATHS, type AuditEntry, type Floor } from './shared.ts';

/** An admin moves someone onto a floor and back; the person sees it, and Activity records both steps. */
export const adminActivity: Scenario = {
  id: 'RUN-03',
  title: 'An admin adds someone to a floor and takes them off again, and Activity shows both',
  owner: 'platform',
  goals: [12],
  cuj: 3,
  given: 'A sample admin, and a sample person who is not on some seeded floor.',
  when: 'The admin adds them to that floor, then takes them off it.',
  then: 'The person can reach the floor, then within 5 minutes cannot; Activity records who did each step, to whom and where.',
  cadence: { kind: 'every', minutes: 360 },
  needs: [{ as: 'admin', role: 'admin' }, { as: 'person', notSameAs: ['admin'] }],
  run: async (ctx) => {
    const admin = ctx.parts.admin!;
    const { persona, api } = ctx.parts.person!;
    // The suite changes only people the cast made.
    if (!ctx.check('the person is a sample person', isSynthetic(ctx.cast, persona), { actual: persona.username })) return;
    const floorsNow = async () => {
      const r = await api.get<{ workspaces: Floor[] }>(PATHS.workspaces);
      return r.ok ? new Set(r.body.workspaces.map((f) => f.id)) : undefined;
    };
    const before = await floorsNow();
    const target = Object.entries(ctx.seeded.floors ?? {}).find(([, f]) => before && !before.has(f.id));
    if (!target) {
      ctx.note(`${persona.key} is already on every seeded floor, so there is none to add them to.`);
      return;
    }
    const [, floor] = target;
    const since = ctx.now().toISOString();
    const added = await admin.api.put(PATHS.member(floor.id, persona.id));
    ctx.check(`the admin adds ${persona.key} to ${floor.name}`, added.ok, { actual: added.status });
    const on = await ctx.eventually(async () => {
      const f = await floorsNow();
      return { ok: !!f?.has(floor.id), value: f };
    }, { withinMs: 5 * MINUTE });
    ctx.check(`${persona.key} can reach ${floor.name} once added`, on.ok, { actual: `after ${Math.round(on.ms / 1000)} s` });
    // Taken off again however the steps above went, so the cast stays as the seed made it.
    const removed = await admin.api.delete(PATHS.member(floor.id, persona.id));
    ctx.check(`the admin takes ${persona.key} off ${floor.name}`, removed.ok, { actual: removed.status });
    const off = await ctx.eventually(async () => {
      const f = await floorsNow();
      return { ok: !!f && !f.has(floor.id), value: f };
    }, { withinMs: 5 * MINUTE });
    ctx.check(`${persona.key} can no longer reach ${floor.name} within 5 minutes`, off.ok, { expected: '≤ 300 s', actual: `${Math.round(off.ms / 1000)} s` });

    const log = await admin.api.get<AuditEntry[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&limit=100`);
    if (!ctx.check('Activity can be read by the admin', log.ok && Array.isArray(log.body), { actual: log.status })) return;
    const step = (action: string) => log.body.find((e) => e.action === action && e.target === floor.id && e.detail?.person === persona.id);
    for (const action of ['department.member-added', 'department.member-removed']) {
      const e = step(action);
      ctx.check(`Activity records ${action} for ${persona.key} on ${floor.name}`, !!e, { actual: log.body.map((x) => x.action) });
      if (e) ctx.check(`Activity says the admin did ${action}`, e.actor?.id === admin.persona.id, { expected: admin.persona.id, actual: e.actor?.id });
    }
  },
};
