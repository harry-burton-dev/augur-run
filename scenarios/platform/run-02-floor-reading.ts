import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type Floor } from './shared.ts';

/** A person reads where their floor allows, and is turned away, with a reason, everywhere else. */
export const floorReading: Scenario = {
  id: 'RUN-02',
  title: 'People read only where their floors allow',
  owner: 'platform',
  goals: [29, 30, 36],
  cuj: 6,
  given: 'Seeded floors, and a person on a team floor.',
  when: 'They open their apps on their own floor, then ask for a floor they are not on.',
  then: 'Their own floor answers; the other is refused with a reason, and nothing of it is shown.',
  cadence: { kind: 'every', minutes: 60, quietMinutes: 240 },
  needs: [{ as: 'member', floors: 'own' }],
  run: async (ctx) => {
    const { persona, api } = ctx.parts.member!;
    const floors = await api.get<{ workspaces: Floor[] }>(PATHS.workspaces);
    if (!ctx.check('their floors can be read', floors.ok, { actual: floors.status })) return;
    const mine = new Set(floors.body.workspaces.map((f) => f.id));
    const own = persona.floors.find((f) => f.id && mine.has(f.id));
    if (own) {
      const here = await api.get(`${PATHS.manifest}?workspace=${encodeURIComponent(own.id!)}`, { floor: own.id });
      ctx.check(`their own floor (${own.name}) answers`, here.ok, { actual: here.status });
    }
    const elsewhere = Object.entries(ctx.seeded.floors ?? {}).find(([, f]) => !mine.has(f.id));
    if (!elsewhere) {
      ctx.note(`${persona.key} can reach every seeded floor, so there is no other floor to be refused.`);
      return;
    }
    const [, other] = elsewhere;
    const there = await api.get<{ message?: string }>(`${PATHS.manifest}?workspace=${encodeURIComponent(other.id)}`, { floor: other.id });
    ctx.check(`a floor they are not on (${other.name}) is refused`, there.status === 403, { expected: 403, actual: there.status });
    ctx.check('the refusal says why', typeof there.body?.message === 'string' && there.body.message.length > 0, { actual: there.body });
  },
};
