import type { Scenario } from '../../src/scenario.ts';
import { isSynthetic, marked } from '../../src/synthetic.ts';
import { MINUTE, PATHS, type AuditEntry } from './shared.ts';

/**
 * The leaver flow (CUJ 3): an admin says someone is leaving and who takes on their work. Within 5 minutes
 * the leaver can do nothing more, and Activity says who did it and who was handed the work. Their sign-in
 * is turned on again afterwards, so the cast stays as the seed made it.
 */
export const leaver: Scenario = {
  id: 'RUN-08',
  title: 'A leaver is turned off and their work handed on',
  owner: 'platform',
  goals: [12],
  cuj: 3,
  given: 'A sample person who writes, and another who can take on their work.',
  when: 'An admin runs the leaver flow on them, handing their work to the successor.',
  then: 'Within 5 minutes the leaver can no longer use AUGUR; Activity records person.left, by the admin, handing over to the successor.',
  cadence: { kind: 'once', afterMinutes: 24 * 60 },
  needs: [{ as: 'admin', role: 'admin' }, { as: 'leaver', habit: 'writes', notSameAs: ['admin'] }, { as: 'successor', habit: 'writes', notSameAs: ['admin', 'leaver'] }],
  run: async (ctx) => {
    const admin = ctx.parts.admin!;
    const gone = ctx.parts.leaver!;
    const successor = ctx.parts.successor!;
    // The suite turns off only people the cast made.
    if (!ctx.check('the leaver is a sample person', isSynthetic(ctx.cast, gone.persona), { actual: gone.persona.username })) return;
    const before = await gone.api.get(PATHS.me);
    if (!ctx.check(`${gone.persona.key} can use AUGUR before they leave`, before.ok, { actual: before.status })) return;
    const since = ctx.now().toISOString();
    const left = await admin.api.post(PATHS.leave(gone.persona.id), { handOverTo: successor.persona.id, note: marked(ctx.cast, 'Leaving, in the proving run.') });
    if (!ctx.check(`the admin runs the leaver flow on ${gone.persona.key}`, left.ok, { actual: left.status })) return;
    try {
      // A refused sign-in is the leaver locked out too, so it counts as gone.
      const out = await ctx.eventually<number | string>(async () => {
        try {
          const r = await gone.api.get(PATHS.me);
          return { ok: r.status === 401 || r.status === 403, value: r.status };
        } catch (err) {
          return { ok: true, value: (err as Error).message };
        }
      }, { withinMs: 5 * MINUTE });
      ctx.check(`${gone.persona.key} can no longer use AUGUR within 5 minutes`, out.ok, { expected: '401 within 300 s', actual: { answer: out.value, after: `${Math.round(out.ms / 1000)} s` } });
      const log = await admin.api.get<AuditEntry[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&person=${encodeURIComponent(gone.persona.id)}&limit=100`);
      if (ctx.check('Activity can be read by the admin', log.ok && Array.isArray(log.body), { actual: log.status })) {
        const entry = log.body.find((e) => e.action === 'person.left' && e.target === gone.persona.id);
        ctx.check('Activity records person.left by the admin', entry?.actor?.id === admin.persona.id, { actual: log.body.map((e) => e.action) });
        ctx.check(`Activity says the work goes to ${successor.persona.key}`, entry?.detail?.handOverTo === successor.persona.id, { expected: successor.persona.id, actual: entry?.detail });
      }
    } finally {
      const back = await admin.api.patch(PATHS.person(gone.persona.id), { enabled: true });
      ctx.check(`${gone.persona.key}’s sign-in is turned on again for the rest of the run`, back.ok, { actual: back.status });
    }
    ctx.note('Apps hand on what the leaver owned when they hear platform.person.left; each pillar’s own run module checks its part.');
  },
};
