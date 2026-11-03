import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type Floor, type Me } from './shared.ts';

/** Every sample person signs in, as a person does: the first time, they choose their own password. */
export const signIn: Scenario = {
  id: 'RUN-01',
  title: 'Everyone in the cast signs in and finds their floors',
  owner: 'platform',
  goals: [11, 12, 36],
  cuj: 2,
  given: 'The seeded cast, each with the one-time password the seed was given.',
  when: 'Each person signs in on the sign-in page, choosing a new password the first time, and opens AUGUR.',
  then: 'AUGUR knows who they are, with their roles, and shows them the organisation and every floor the cast put them on.',
  cadence: { kind: 'once' },
  needs: [{ as: 'anyone' }],
  run: async (ctx) => {
    for (const p of ctx.personas) {
      const api = ctx.as(p);
      const me = await api.get<Me>(PATHS.me);
      ctx.check(`${p.key} is known to AUGUR as themself`, me.ok && me.body.id === p.id, { expected: p.id, actual: me.ok ? me.body.id : me.status });
      if (me.ok) {
        const missing = p.roles.filter((r) => !me.body.roles.includes(r));
        ctx.check(`${p.key} has the roles the cast gave them`, !missing.length, { expected: p.roles, actual: me.body.roles });
      }
      const floors = await api.get<{ workspaces: Floor[] }>(PATHS.workspaces);
      const ids = floors.ok ? floors.body.workspaces.map((f) => f.id) : [];
      ctx.check(`${p.key} is on the organisation's floor`, floors.ok && floors.body.workspaces.some((f) => f.kind === 'org'), { actual: floors.status });
      const expected = p.floors.filter((f) => f.id).map((f) => f.id!);
      ctx.check(`${p.key} is on every floor the cast put them on`, expected.every((id) => ids.includes(id)), { expected, actual: ids });
      const apps = await api.get<unknown[]>(PATHS.manifest);
      ctx.check(`${p.key} is offered their apps`, apps.ok && Array.isArray(apps.body), { actual: apps.status });
    }
  },
};
