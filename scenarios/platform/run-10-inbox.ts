import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type InboxCounts, type InboxItem } from './shared.ts';

/**
 * The Inbox (CUJ 6, ADR 0026): work an app puts on a person or their team, with a state and a history,
 * apart from notifications. The person checks that the count matches what is listed, then takes a team
 * item and gives it back, so the team's work is as it was.
 */
export const inbox: Scenario = {
  id: 'RUN-10',
  title: 'The Inbox holds work that waits on a person',
  owner: 'platform',
  goals: [14],
  cuj: 6,
  given: 'Apps that put work in people’s and teams’ Inboxes, such as Mandate’s back-briefs.',
  when: 'A person opens their Inbox, takes an item waiting on their team, then gives it back.',
  then: 'The count matches the lists; taking makes it theirs and giving it back returns it to the team, each kept in its history; none of it is a notification.',
  cadence: { kind: 'every', minutes: 120 },
  needs: [{ as: 'owner', floors: 'own' }],
  available: async (ctx) => {
    const counts = await ctx.parts.owner!.api.get<InboxCounts>(PATHS.inboxCounts);
    if (!ctx.check('the Inbox’s counts can be read', counts.ok, { actual: counts.status })) return { ok: false, why: `The Inbox can’t be read (${counts.status}).` };
    if (counts.body.you + counts.body.teams > 0) return { ok: true };
    return {
      ok: false,
      why: `Nothing waits on ${ctx.parts.owner!.persona.key} or their teams: no app has put work in their Inbox yet.`,
      whoCanChange: 'An admin, by allowing an app such as Mandate “Put work in people’s inboxes” (inbox:write); Mandate then puts a back-brief there when a part is passed down.',
    };
  },
  run: async (ctx) => {
    const { persona, api } = ctx.parts.owner!;
    const list = async (tab: 'you' | 'teams') => {
      const r = await api.get<InboxItem[]>(`${PATHS.inbox}?tab=${tab}&limit=100`);
      return r.ok && Array.isArray(r.body) ? r.body : undefined;
    };
    const counts = (await api.get<InboxCounts>(PATHS.inboxCounts)).body;
    const [mine, teams] = await Promise.all([list('you'), list('teams')]);
    if (!ctx.check('both tabs of the Inbox can be read', !!mine && !!teams)) return;
    if (mine!.length < 100) ctx.check('the count of items on them matches the For you tab', counts.you === mine!.length, { expected: mine!.length, actual: counts.you });
    const unstated = [...mine!, ...teams!].filter((i) => !['open', 'done', 'declined', 'withdrawn'].includes(i.state) || !i.owner);
    ctx.check('every item has an owner and a state', unstated.length === 0, { actual: unstated.map((i) => i.id) });
    const notes = await api.get<{ id: string }[]>(PATHS.notifications);
    const items = new Set([...mine!, ...teams!].map((i) => i.id));
    ctx.check('no Inbox item is also a notification', notes.ok && Array.isArray(notes.body) && !notes.body.some((n) => items.has(n.id)), { actual: notes.status });

    const item = teams!.find((i) => !i.redacted && !i.takenBy);
    // Half the journey isn't a pass: the next run, or another person, may find a team item to take.
    if (!item) return { ok: false, why: `Nothing waiting on ${persona.key}’s teams can be taken now, so taking and giving back wasn’t tried.` };
    const taken = await api.post<InboxItem>(PATHS.inboxStep(item.id, 'take'));
    if (!ctx.check(`${persona.key} takes a team item`, taken.ok, { actual: taken.status })) return;
    try {
      const nowMine = await list('you');
      ctx.check('a taken item is theirs, in the For you tab', !!nowMine?.some((i) => i.id === item.id && i.takenBy === persona.id), { actual: nowMine?.map((i) => i.id) });
    } finally {
      const back = await api.post<InboxItem>(PATHS.inboxStep(item.id, 'release'));
      ctx.check('they give it back to the team', back.ok, { actual: back.status });
    }
    const after = await api.get<InboxItem & { history: { action: string; by?: string }[] }>(PATHS.inboxItem(item.id));
    const steps = after.ok ? after.body.history.map((h) => h.action) : [];
    ctx.check('its history keeps the taking and the giving back', steps.includes('taken') && steps.includes('released'), { actual: steps });
    ctx.check('it is open to the team again', after.ok && after.body.state === 'open' && !after.body.takenBy, { actual: after.ok ? { state: after.body.state, takenBy: after.body.takenBy } : after.status });
  },
};
