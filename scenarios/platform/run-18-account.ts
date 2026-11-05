import type { Scenario } from '../../src/scenario.ts';
import { PATHS } from './shared.ts';

type Prefs = Record<string, unknown> & { reduceMotion?: boolean };

/**
 * A person runs their own account (Account, W2.3): changes a preference and finds it kept, sees where they
 * are signed in and their recent sign-ins, and downloads what AUGUR keeps about them. Their preferences
 * are put back as they were.
 */
export const account: Scenario = {
  id: 'RUN-18',
  title: 'A person runs their own account',
  owner: 'platform',
  goals: [11],
  given: 'A sample person who has signed in.',
  when: 'They open Account, change how AUGUR looks for them, look at their sessions and sign-ins, and download their data.',
  then: 'The change is kept; their sessions and sign-ins are listed; the download says who they are and names any part it couldn’t read.',
  cadence: { kind: 'every', minutes: 480 },
  needs: [{ as: 'person' }],
  run: async (ctx) => {
    const { persona, api } = ctx.parts.person!;
    const before = await api.get<Prefs>(PATHS.preferences);
    if (!ctx.check('their preferences can be read', before.ok, { actual: before.status })) return;
    const was = before.body ?? {};
    const changed = { ...was, reduceMotion: !was.reduceMotion };
    const put = await api.put(PATHS.preferences, changed);
    if (ctx.check('they change a preference', put.ok, { actual: put.status })) {
      try {
        const after = await api.get<Prefs>(PATHS.preferences);
        ctx.check('the change is kept', after.ok && after.body?.reduceMotion === changed.reduceMotion, { expected: changed.reduceMotion, actual: after.body?.reduceMotion });
      } finally {
        const back = await api.put(PATHS.preferences, was);
        ctx.check('their preferences are put back as they were', back.ok, { actual: back.status });
      }
    }
    const sessions = await api.get<unknown[]>(PATHS.sessions);
    ctx.check('they see where they are signed in, this sign-in among them', sessions.ok && Array.isArray(sessions.body) && sessions.body.length > 0, { actual: sessions.ok ? (sessions.body as unknown[]).length : sessions.status });
    const signIns = await api.get<unknown[]>(PATHS.signIns);
    ctx.check('they see their recent sign-ins', signIns.ok && Array.isArray(signIns.body), { actual: signIns.status });
    const data = await api.get<{ you?: { id?: string }; missing?: unknown[] }>(PATHS.myData);
    if (ctx.check('they download what AUGUR keeps about them', data.ok && !!data.body, { actual: data.status })) {
      ctx.check('the download says who they are', data.body.you?.id === persona.id, { expected: persona.id, actual: data.body.you?.id });
      const missing = Array.isArray(data.body.missing) ? data.body.missing : [];
      if (missing.length) ctx.note(`Parts of ${persona.key}’s data couldn’t be read, and the download says so.`, missing);
    }
  },
};
