import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Floor, type Organisation } from './shared.ts';

/**
 * An admin renames the organisation in Admin → Organisation; within 5 minutes everyone reads the new name,
 * as the organisation's settings and as their top floor's name. The name is put back straight after.
 */
export const organisationSettings: Scenario = {
  id: 'RUN-09',
  title: 'Organisation settings are read everywhere',
  owner: 'platform',
  goals: [13],
  given: 'An organisation name, time zone and email sender set in Admin → Organisation.',
  when: 'An admin changes the organisation’s name, and people open Home.',
  then: 'Within 5 minutes everyone reads the new name, from the organisation’s settings and as their top floor; the change is in Activity, and the old name is put back.',
  cadence: { kind: 'once', afterMinutes: 60 },
  needs: [{ as: 'admin', role: 'admin' }, { as: 'reader', notSameAs: ['admin'] }],
  run: async (ctx) => {
    const admin = ctx.parts.admin!;
    const reader = ctx.parts.reader!;
    const before = await reader.api.get<Organisation>(PATHS.organisation);
    if (!ctx.check('anyone signed in can read the organisation’s settings', before.ok && typeof before.body?.name === 'string', { actual: before.status })) return;
    ctx.check('the settings carry a time zone and an email sender', !!before.body.timeZone && !!before.body.sender?.name, { actual: before.body });
    const old = before.body.name;
    // A name made from the old one and this run's clock, so it is the deployment's own name, marked.
    const renamed = `${old} ${ctx.now().toISOString().slice(11, 16).replace(':', '')}`.slice(0, 100);
    const since = ctx.now().toISOString();
    const changed = await admin.api.patch<Organisation>(PATHS.adminOrganisation, { name: renamed });
    if (!ctx.check('the admin renames the organisation', changed.ok && changed.body?.name === renamed, { expected: renamed, actual: changed.ok ? changed.body?.name : changed.status })) return;
    try {
      const seen = await ctx.eventually(async () => {
        const [org, floors] = await Promise.all([reader.api.get<Organisation>(PATHS.organisation), reader.api.get<{ workspaces: Floor[] }>(PATHS.workspaces)]);
        const top = floors.ok ? floors.body.workspaces.find((f) => f.kind === 'org')?.name : undefined;
        return { ok: org.body?.name === renamed && top === renamed, value: { settings: org.body?.name, floor: top } };
      }, { withinMs: 5 * MINUTE });
      ctx.check(`${reader.persona.key} reads the new name in the settings and as their top floor within 5 minutes`, seen.ok, { expected: renamed, actual: seen.value });
      const log = await admin.api.get<{ action: string; actor?: { id: string } }[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&limit=100`);
      const entry = log.ok && Array.isArray(log.body) ? log.body.find((e) => e.action === 'organisation.changed') : undefined;
      ctx.check('Activity records organisation.changed by the admin', entry?.actor?.id === admin.persona.id, { actual: log.ok ? log.body.map((e) => e.action) : log.status });
    } finally {
      const back = await admin.api.patch<Organisation>(PATHS.adminOrganisation, { name: old });
      ctx.check('the organisation’s name is put back', back.ok && back.body?.name === old, { expected: old, actual: back.ok ? back.body?.name : back.status });
    }
    ctx.note('The sign-in page and email show this name too; the run doesn’t check them yet (a browser step on the sign-in page, and Mailpit, would).');
  },
};
