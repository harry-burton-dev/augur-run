import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type Status } from './shared.ts';

type NoticeChoice = { email?: boolean; digest?: 'off' | 'daily' | 'weekly'; quietHours?: { from: string; to: string } };
type Prefs = Record<string, unknown> & { notifications?: NoticeChoice };
type Notification = { id: string; title?: string };

/**
 * A person chooses how their notices reach them by email (Account → Notifications, ADR 0044 D7): an email for
 * each thing that needs them, a daily digest and quiet hours, and finds the choice kept. The link in a notice
 * email opens one of their notifications, read or not. Their preferences are put back as they were.
 */
export const noticeEmail: Scenario = {
  id: 'RUN-25',
  title: 'A person chooses how notices reach them by email',
  owner: 'platform',
  goals: [9, 11],
  cuj: 2,
  given: 'A sample person who has signed in, on a deployment whose mail relay is set.',
  when: 'They open Account, Notifications, choose email for what needs them, a daily digest and quiet hours, and open a notification as a notice email’s link does.',
  then: 'Their choice is kept; the link opens that notification; Status says whether email can be sent, which Account shows them.',
  cadence: { kind: 'every', minutes: 480 },
  needs: [{ as: 'person' }],
  run: async (ctx) => {
    const { api } = ctx.parts.person!;
    const before = await api.get<Prefs>(PATHS.preferences);
    if (!ctx.check('their preferences can be read', before.ok, { actual: before.status })) return;
    const was = before.body ?? {};
    const chosen: NoticeChoice = { email: true, digest: 'daily', quietHours: { from: '19:00', to: '08:00' } };
    const put = await api.put(PATHS.preferences, { ...was, notifications: chosen });
    if (ctx.check('they choose how notices reach them', put.ok, { actual: put.status })) {
      try {
        const after = await api.get<Prefs>(PATHS.preferences);
        const kept = after.body?.notifications;
        ctx.check('their choice is kept', after.ok && kept?.email === true && kept?.digest === 'daily' && kept?.quietHours?.from === '19:00' && kept?.quietHours?.to === '08:00', {
          expected: chosen,
          actual: kept,
        });
      } finally {
        const back = await api.put(PATHS.preferences, was);
        ctx.check('their preferences are put back as they were', back.ok, { actual: back.status });
      }
    }
    const list = await api.get<Notification[]>(PATHS.notifications);
    if (ctx.check('their notifications can be read', list.ok && Array.isArray(list.body), { actual: list.status })) {
      const first = list.body[0];
      if (first) {
        const one = await api.get<Notification>(PATHS.notification(first.id));
        ctx.check('a notice email’s link opens the notification', one.ok && one.body?.id === first.id, { expected: first.id, actual: one.ok ? one.body?.id : one.status });
      } else ctx.note('They had no unread notification to open, so the link wasn’t followed this time.');
    }
    const status = await api.get<Status>(PATHS.status);
    if (status.ok && status.body.email) ctx.check('email can be sent, so Account says it reaches them', status.body.email.state === 'ok', { expected: 'ok', actual: status.body.email.state });
    else ctx.note('Status’s email part isn’t shown to this person; RUN-16 checks it as an admin.', { status: status.status });
    ctx.note('Whether each notice email or digest arrives isn’t checked here: Mailpit isn’t behind the gateway. RUN-23 checks one arrives, by the operator.');
  },
};
