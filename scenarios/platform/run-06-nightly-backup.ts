import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Status } from './shared.ts';

/** The daily backup at 02:00 UTC is the one time-based job of the run that a person can see (ADR 0050). */
export const nightlyBackup: Scenario = {
  id: 'RUN-06',
  title: 'The nightly backup runs',
  owner: 'platform',
  goals: [24, 36],
  given: 'Staging with its backup container, which backs up at 02:00 UTC.',
  when: 'An hour after each 02:00 UTC in the run, a sample admin opens Status.',
  then: 'It shows a backup that worked, taken in the last few hours.',
  cadence: { kind: 'daily', atUtc: '02:00', graceMinutes: 60 },
  needs: [{ as: 'admin', role: 'admin' }],
  available: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<Status>(PATHS.status);
    if (!ctx.check('Status can be read', r.ok, { actual: r.status })) return { ok: false, why: `Status answered ${r.status}.` };
    if (!r.body.backups) {
      // Backups that Status reported earlier in the run and no longer does are a fault, not a missing part.
      if (ctx.state.reported) ctx.check('Status still reports backups, as it did earlier in the run', false);
      return { ok: false, why: 'This deployment’s Status doesn’t report backups.', whoCanChange: 'A deployment admin, by running the backup container (augur docs/deploy.md).' };
    }
    ctx.state.reported = true;
    // A fresh install's first backup is at its first 02:00 UTC; on the timeline, a missing one is a failure.
    if (ctx.dry && !r.body.backups.lastBackup) return { ok: false, why: 'No backup has been taken on this install yet: its first is at 02:00 UTC.' };
    return { ok: true };
  },
  run: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<Status>(PATHS.status);
    const last = r.body.backups?.lastBackup;
    ctx.check('the last backup worked', !!last?.ok, { actual: last ?? r.body.backups?.problem });
    const age = last ? ctx.now().getTime() - Date.parse(last.at) : Infinity;
    // In a dry run on a fresh install there may be no night yet: only that it worked is checked.
    if (!ctx.dry) ctx.check('the last backup is from tonight', age < 3 * 60 * MINUTE, { expected: '< 3 hours old', actual: last?.at });
  },
};
