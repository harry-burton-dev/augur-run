import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Organisation, type Status } from './shared.ts';

/** AUGUR can send mail through the organisation's relay (Mailpit for the run), from the organisation's sender. */
export const emailSender: Scenario = {
  id: 'RUN-16',
  title: 'AUGUR can send email',
  owner: 'platform',
  goals: [9],
  given: 'A deployment with its mail relay set (SMTP_*; Mailpit for the run) and an organisation sender.',
  when: 'A sample admin opens Status, and the organisation’s settings, through the run.',
  then: 'Status says email is ok, checked in the last 15 minutes, from the organisation’s sender address.',
  cadence: { kind: 'every', minutes: 360 },
  needs: [{ as: 'admin', role: 'admin' }],
  run: async (ctx) => {
    const { api } = ctx.parts.admin!;
    const status = await api.get<Status>(PATHS.status);
    if (!ctx.check('Status can be read by the admin', status.ok, { actual: status.status })) return;
    const email = status.body.email;
    ctx.check('Status says email can be sent', email?.state === 'ok', { expected: 'ok', actual: email ? { state: email.state, problem: email.problem } : 'no email part' });
    // Checked at most every 5 minutes: three missed checks is the relay check itself stopping.
    const age = email?.checkedAt ? ctx.now().getTime() - Date.parse(email.checkedAt) : Infinity;
    if (!ctx.dry) ctx.check('the relay was checked in the last 15 minutes', age < 15 * MINUTE, { expected: '< 15 minutes ago', actual: email?.checkedAt });
    const org = await api.get<Organisation>(PATHS.organisation);
    ctx.check('the organisation has a sender address', !!org.body?.sender?.address, { actual: org.body?.sender, suggested: 'documented-setting' });
    if (email?.from && org.body?.sender?.address) ctx.check('mail comes from the organisation’s sender', email.from === org.body.sender.address, { expected: org.body.sender.address, actual: email.from });
    ctx.note('Whether each mail arrives isn’t checked by the run yet: the suite reaches AUGUR only through the gateway, and Mailpit isn’t behind it.');
  },
};
