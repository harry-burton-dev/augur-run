import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type Status } from './shared.ts';

/** An admin looks at Status every quarter of an hour, as the alert path will: every part answers. */
export const statusHealthy: Scenario = {
  id: 'RUN-05',
  title: 'Every part of AUGUR stays up',
  owner: 'platform',
  goals: [23, 24, 36],
  cuj: 4,
  given: 'Staging running the release under test.',
  when: 'A sample admin opens Status every 15 minutes, day and night.',
  then: 'Every service and app answers its health check, and sample data is still allowed.',
  cadence: { kind: 'every', minutes: 15, quietMinutes: 15 },
  needs: [{ as: 'admin', role: 'admin' }],
  run: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<Status>(PATHS.status);
    if (!ctx.check('Status answers the admin', r.ok, { actual: r.status })) return;
    for (const c of r.body.components ?? []) {
      ctx.check(`${c.name} is up`, c.state !== 'down', { expected: 'up', actual: c.problem ? `${c.state}: ${c.problem}` : c.state });
    }
    ctx.check('sample data is still allowed', r.body.seeding?.allowed === true, { actual: r.body.seeding });
  },
};
