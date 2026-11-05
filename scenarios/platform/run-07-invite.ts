import { notYet, type Scenario } from '../../src/scenario.ts';
import { PATHS, type AuditEntry, type Status } from './shared.ts';

type Invite = { method: string; sentTo?: string; sentAt?: string; expiresAt?: string; expired?: boolean; count?: number; error?: string };
type Added = { person: { id: string; email?: string }; invite?: Invite; temporaryPassword?: string };
type Person = { id: string; state?: string; invite?: Invite };

/** How long an invite's link lasts (PER-194's spec): Admin says Invite expired after it. */
const INVITE_HOURS = 72;

/**
 * Inviting someone by email (CUJ 2): an admin adds a person with only their name and email, and AUGUR mails
 * them the way in. No password is passed by hand. The suite can't read the mail (the relay isn't behind the
 * gateway), so the operator follows an invite in Mailpit once in the run, and the ledger takes their note.
 * Each run invites a new sample address and turns off the one before: an invite can't be withdrawn, and
 * deleting someone needs a deployment admin, which no sample person is. The last one is left on for the
 * operator to follow, and expires by itself.
 */
export const invite: Scenario = {
  id: 'RUN-07',
  title: 'A new person is invited by email, with no password passed by hand',
  owner: 'platform',
  goals: [9, 11, 13],
  cuj: 2,
  given: 'An organisation whose email works (Status), and a sample admin.',
  when: 'The admin invites someone by name and email, then sends the invite again.',
  then: 'AUGUR mails them an invite that lasts 72 hours, with no one-time password in the answer; Admin shows them as invited; Activity records person.added by email and the resend; the one invited the time before is turned off.',
  cadence: { kind: 'every', minutes: 480 },
  needs: [{ as: 'admin', role: 'admin' }],
  // PER-194's last part. When it merges, this becomes: available while Status says email works.
  available: notYet('Inviting someone by email isn’t in AUGUR yet: adding someone still gives them a one-time password.', 'PER-194 (email invites)'),
  run: async (ctx) => {
    const { persona, api } = ctx.parts.admin!;
    const before = ctx.state.invited as string | undefined;
    if (before) {
      const off = await api.post(PATHS.leave(before), {});
      if (ctx.check('the person invited the time before is turned off', off.ok || off.status === 404, { actual: off.status })) delete ctx.state.invited;
    }
    const status = await api.get<Status>(PATHS.status);
    if (!ctx.check('Status says email can be sent', status.ok && status.body.email?.state === 'ok', { expected: 'ok', actual: status.body?.email })) return;

    // A new sample address each run, in the cast's own domain, so nobody real is ever mailed.
    const stamp = ctx.now().toISOString().replace(/\D/g, '').slice(0, 12);
    const email = `${ctx.cast.synthetic.usernamePrefix}invite-${stamp}@${ctx.cast.synthetic.emailDomain}`;
    const since = ctx.now().toISOString();
    const added = await api.post<Added>(PATHS.people, { firstName: 'Invited', lastName: `Run ${stamp}`, email, start: 'email' });
    if (!ctx.check(`${persona.key} invites ${email}`, added.status === 201, { expected: 201, actual: added.status })) return;
    const id = added.body.person.id;
    ctx.state.invited = id;
    const sent = added.body.invite;
    ctx.check('the invite goes by email', sent?.method === 'email' && !sent.error, { actual: sent });
    ctx.check('no one-time password is handed back', added.body.temporaryPassword === undefined);
    const hours = sent?.expiresAt ? (Date.parse(sent.expiresAt) - Date.parse(since)) / 3_600_000 : NaN;
    ctx.check(`the invite lasts ${INVITE_HOURS} hours`, Math.abs(hours - INVITE_HOURS) < 1, { expected: INVITE_HOURS, actual: Number.isNaN(hours) ? sent?.expiresAt : Math.round(hours) });

    const shown = await api.get<Person>(PATHS.person(id));
    ctx.check('Admin shows them as invited', shown.ok && shown.body.state === 'invited' && shown.body.invite?.count === 1, { actual: shown.ok ? { state: shown.body.state, invite: shown.body.invite } : shown.status });

    const again = await api.post<{ invite?: Invite }>(PATHS.invite(id));
    ctx.check('the admin sends the invite again', again.ok && again.body.invite?.method === 'email', { actual: again.status });

    const log = await api.get<AuditEntry[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&person=${encodeURIComponent(id)}&limit=100`);
    if (ctx.check('Activity can be read by the admin', log.ok && Array.isArray(log.body), { actual: log.status })) {
      const add = log.body.find((e) => e.action === 'person.added' && e.target === id);
      ctx.check('Activity records person.added, by email', add?.actor?.id === persona.id && add.detail?.method === 'email', { actual: add ?? log.body.map((e) => e.action) });
      ctx.check('Activity records the resend', log.body.some((e) => e.action === 'person.invite-resent' && e.target === id), { actual: log.body.map((e) => e.action) });
    }
    ctx.note(`An invite went to ${email}. Once in the run, open it in Mailpit, set a password and two-step sign-in, and say in the ledger whether Home opened with the organisation's name.`, { person: id, email });
  },
};
