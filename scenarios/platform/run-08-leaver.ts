import type { Scenario } from '../../src/scenario.ts';
import type { Persona } from '../../src/personas.ts';
import { isSynthetic, marked } from '../../src/synthetic.ts';
import { MINUTE, PATHS, type AuditEntry } from './shared.ts';

type Added = { person: { id: string; username?: string; email?: string }; temporaryPassword?: string };

/**
 * The leaver flow (CUJ 3): an admin says someone is leaving and who takes on their work. Within 5 minutes
 * the leaver can do nothing more, and Activity says who did it and who was handed the work. A leaver never
 * comes back (identity refuses to turn their sign-in on again), so the leaver is a sample person the
 * scenario adds for the purpose, as RUN-07 does: the seed's cast stays whole for every other scenario and
 * for later runs. The leaver is removed with the deployment's other leavers when its retention ends. They
 * own nothing, so this proves the platform's part: each pillar's own run module checks handing work on.
 */
export const leaver: Scenario = {
  id: 'RUN-08',
  title: 'A leaver is turned off and their work handed on',
  owner: 'platform',
  goals: [12],
  cuj: 3,
  given: 'A sample person added for the purpose, who has signed in, and someone in the cast who can take on their work.',
  when: 'An admin runs the leaver flow on them, handing their work to the successor.',
  then: 'Within 5 minutes the leaver can no longer use AUGUR; Activity records person.left, by the admin, handing over to the successor.',
  cadence: { kind: 'once', afterMinutes: 24 * 60 },
  needs: [{ as: 'admin', role: 'admin' }, { as: 'successor', habit: 'writes', notSameAs: ['admin'] }],
  run: async (ctx) => {
    const admin = ctx.parts.admin!;
    const successor = ctx.parts.successor!;
    // A new sample person each run, in the cast's own names and domain, so nobody real is touched.
    const stamp = ctx.now().toISOString().replace(/\D/g, '').slice(0, 14);
    const username = `${ctx.cast.synthetic.usernamePrefix}leaver-${stamp}`;
    const email = `${username}@${ctx.cast.synthetic.emailDomain}`;
    const added = await admin.api.post<Added>(PATHS.people, { username, firstName: 'Leaver', lastName: `Run ${stamp}`, email, start: 'temporary-password' });
    if (!ctx.check(`the admin adds ${username}, who will leave`, added.status === 201 && !!added.body.temporaryPassword, { expected: 201, actual: added.status })) return;
    const persona: Persona = { key: `leaver-${stamp}`, username, name: `Leaver Run ${stamp}`, id: added.body.person.id, email, floors: [], roles: [], habits: ['reads'], temporaryPassword: added.body.temporaryPassword };
    // The suite turns off only people the cast's marks say it made.
    if (!ctx.check('the leaver is a sample person', isSynthetic(ctx.cast, persona), { actual: username })) return;
    const gone = ctx.as(persona);
    const before = await gone.get(PATHS.me);
    if (!ctx.check(`${username} can use AUGUR before they leave`, before.ok, { actual: before.status })) return;
    const since = ctx.now().toISOString();
    const left = await admin.api.post(PATHS.leave(persona.id), { handOverTo: successor.persona.id, note: marked(ctx.cast, 'Leaving, in the proving run.') });
    if (!ctx.check(`the admin runs the leaver flow on ${username}`, left.ok, { actual: left.status })) return;
    // A refused sign-in is the leaver locked out too, so it counts as gone.
    const out = await ctx.eventually<number | string>(async () => {
      try {
        const r = await gone.get(PATHS.me);
        return { ok: r.status === 401 || r.status === 403, value: r.status };
      } catch (err) {
        return { ok: true, value: (err as Error).message };
      }
    }, { withinMs: 5 * MINUTE });
    ctx.check(`${username} can no longer use AUGUR within 5 minutes`, out.ok, { expected: '401 within 300 s', actual: { answer: out.value, after: `${Math.round(out.ms / 1000)} s` } });
    const log = await admin.api.get<AuditEntry[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&person=${encodeURIComponent(persona.id)}&limit=100`);
    if (ctx.check('Activity can be read by the admin', log.ok && Array.isArray(log.body), { actual: log.status })) {
      const entry = log.body.find((e) => e.action === 'person.left' && e.target === persona.id);
      ctx.check('Activity records person.left by the admin', entry?.actor?.id === admin.persona.id, { actual: log.body.map((e) => e.action) });
      ctx.check(`Activity says the work goes to ${successor.persona.key}`, entry?.detail?.handOverTo === successor.persona.id, { expected: successor.persona.id, actual: entry?.detail });
    }
    ctx.note('Apps hand on what the leaver owned when they hear platform.person.left; each pillar’s own run module checks its part.', { leaver: persona.id });
  },
};
