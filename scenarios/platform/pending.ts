// Scenarios for work not yet in AUGUR, written first from the alpha spec's journeys so each workstream
// builds toward the checks that will judge it. Each says what it waits on. The thread that lands the work
// replaces `available` and `run` with the real steps, and its traceability row moves to Written.
import { notYet, type Scenario } from '../../src/scenario.ts';

const waiting = (s: Omit<Scenario, 'owner' | 'run' | 'available'> & { waitsOn: string; issue: string }): Scenario => {
  const { waitsOn, issue, ...rest } = s;
  return { ...rest, owner: 'platform', available: notYet(waitsOn, issue), run: async () => {} };
};

export const pending: Scenario[] = [
  waiting({
    id: 'RUN-07',
    title: 'A new person is invited and runs their own account',
    goals: [9, 11, 13],
    cuj: 2,
    given: 'An organisation with a mail relay (Mailpit for the run) and organisation settings.',
    when: 'An admin invites someone by email. They follow the mail, set a password and two-step sign-in, then change their notification preferences.',
    then: 'They land on Home with the organisation’s name, with no password passed by hand and no visit to the sign-in console.',
    cadence: { kind: 'every', minutes: 480 },
    needs: [{ as: 'admin', role: 'admin' }],
    waitsOn: 'Invites, email and the Account area aren’t in AUGUR yet.',
    issue: 'PER-189, PER-190 to PER-192',
  }),
  waiting({
    id: 'RUN-12',
    title: 'A failure alerts an absent admin',
    goals: [23],
    cuj: 4,
    given: 'Staging running normally, with Grafana alerting and the mail relay.',
    when: 'At 03:00 on the first night the operator stops one service (the fault drill), then starts it again.',
    then: 'A notice and an email reach a deployment admin within 5 minutes, one per incident, with a recovery notice after.',
    cadence: { kind: 'daily', atUtc: '03:00', graceMinutes: 10 },
    needs: [{ as: 'admin', role: 'admin' }],
    waitsOn: 'Alerts aren’t in AUGUR yet, and the drill needs the operator’s fault command.',
    issue: 'PER-220',
  }),
];
