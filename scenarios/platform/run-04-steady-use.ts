import type { Scenario } from '../../src/scenario.ts';
import { CALL_LIMIT_MS, PATHS } from './shared.ts';

/**
 * The background of the run: people opening AUGUR through the day, so the deployment carries the load the
 * spec sets (about 5 calls a second at peak), enough for the upgrade watch and the alerts to have counts.
 */
export const steadyUse: Scenario = {
  id: 'RUN-04',
  title: 'People open AUGUR through the day',
  owner: 'platform',
  goals: [36],
  given: 'The signed-in cast.',
  when: 'Someone opens AUGUR every 15 seconds or so in the working day, and every couple of minutes at night: their floors, their apps and their notifications.',
  then: 'Every answer comes, and within 5 seconds.',
  cadence: { kind: 'every', minutes: 0.25, quietMinutes: 2 },
  needs: [{ as: 'anyone' }],
  run: async (ctx) => {
    const { api } = ctx.parts.anyone!;
    for (const path of [PATHS.workspaces, PATHS.manifest, PATHS.notifications]) {
      const r = await api.get(path);
      ctx.check(`${path} answers`, r.ok, { actual: r.status });
      ctx.check(`${path} answers within 5 seconds`, r.ms <= CALL_LIMIT_MS, { expected: `≤ ${CALL_LIMIT_MS} ms`, actual: `${r.ms} ms`, suggested: 'no-action' });
    }
  },
};
