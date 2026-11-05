import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Status } from './shared.ts';

const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** The database can be restored to a moment (ADR 0064): WAL is archived and copied off the server, and the weekly test passes. */
export const pointInTime: Scenario = {
  id: 'RUN-17',
  title: 'The database can be restored to a point in time',
  owner: 'platform',
  goals: [24],
  given: 'Staging with its backup container keeping nightly base backups and the WAL archive.',
  when: 'A sample admin opens Status through the run.',
  then: 'Point in time is ok, looked at in the last 2 hours, with changes archived and copied off the server in the last hour or two, and the last weekly test passed.',
  cadence: { kind: 'every', minutes: 360 },
  needs: [{ as: 'admin', role: 'admin' }],
  available: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<Status>(PATHS.status);
    if (!r.ok || !r.body.backups?.pointInTime) return { ok: false, why: 'This deployment’s Status doesn’t report point-in-time restore.', whoCanChange: 'A deployment admin, by upgrading past 0.18 and starting the backup container again (im-platform docs/deploy.md, Restore to a point in time).' };
    return { ok: true };
  },
  run: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<Status>(PATHS.status);
    const pit = r.body.backups!.pointInTime!;
    const ago = (at?: string) => (at ? ctx.now().getTime() - Date.parse(at) : Infinity);
    ctx.check('Status says the database can be restored to a point in time', pit.ok, { actual: pit.problem ?? pit });
    if (ctx.dry) return;
    ctx.check('the backup container looked in the last 2 hours', ago(pit.at) < 2 * HOUR, { expected: '< 2 hours ago', actual: pit.at });
    ctx.check('a change was archived in the last hour', ago(pit.archivedAt) < HOUR, { expected: '< 1 hour ago', actual: pit.archivedAt });
    ctx.check('the archive was copied off the server in the last 2 hours', ago(pit.copiedAt) < 2 * HOUR, { expected: '< 2 hours ago', actual: pit.copiedAt });
    // A fresh install's first weekly test may not have run; one that ran must have passed, within 8 days.
    if (pit.lastTest) ctx.check('the last weekly replay test passed, in the last 8 days', pit.lastTest.ok && ago(pit.lastTest.at) < 8 * DAY, { actual: pit.lastTest });
    else ctx.note('The weekly replay test hasn’t run on this install yet.');
  },
};
