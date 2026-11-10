import { createHash } from 'node:crypto';
import type { Availability, Scenario } from '../../src/scenario.ts';
import { PATHS } from './shared.ts';

const KG = '/api/knowledge/v1';
type KgFloor = { id: string; kind: string; sight: string[] };
type Problem = { detail?: string; message?: string };
type Unseen = { kind: string; id: string; unseen?: { reason: string; floorKind: string; message: string }; label?: string };

/** Whether the deployment's release has the knowledge graph: the gateway answers 404 for a service it doesn't know. */
const hasKnowledge = async (api: { get: (p: string) => Promise<{ status: number }> }): Promise<Availability> => {
  const meta = await api.get(`${KG}/meta`);
  if (meta.status === 404)
    return { ok: false, why: 'This deployment’s release has no knowledge graph yet.', whoCanChange: 'A deployment admin, by upgrading in Deployment to a release with the knowledge service.' };
  return { ok: true };
};

/**
 * The knowledge graph's fence on a real deployment (AUGUR's knowledge service, plan PR 9): a person reads the
 * floors they stand on, is refused a floor they are not on, and asking for something kept beyond their sight
 * says only what kind of floor keeps it, never its name.
 */
export const knowledgeSight: Scenario = {
  id: 'RUN-26',
  title: 'The knowledge graph shows people only what their floors see',
  owner: 'platform',
  goals: [29, 30],
  cuj: 6,
  given: 'Seeded floors, a person on one team floor, and another person on a team floor outside the first one’s sight.',
  when: 'The second keeps a report naming a ship by its identity key; the first reads their floors, asks for the other floor, and looks the key up.',
  then: 'Their floors answer; the other floor is refused with a reason; the lookup says only the kind of floor that keeps the ship, never its name.',
  cadence: { kind: 'every', minutes: 240, quietMinutes: 480 },
  needs: [
    { as: 'reader', floors: 'own' },
    { as: 'keeper', floors: 'own', notSameAs: ['reader'] },
  ],
  available: async (ctx) => hasKnowledge(ctx.parts.reader!.api),
  run: async (ctx) => {
    const { persona: reader, api } = ctx.parts.reader!;
    const { persona: keeper, api: keeperApi } = ctx.parts.keeper!;
    const mine = await api.get<{ workspaces: { id: string }[] }>(PATHS.workspaces);
    if (!ctx.check('their floors can be read from identity', mine.ok, { actual: mine.status })) return;
    const onFloors = new Set(mine.body.workspaces.map((f) => f.id));
    const home = reader.floors.find((f) => f.id && onFloors.has(f.id));
    if (!home) return { ok: false, why: `${reader.key} stands on none of their cast floors, so there is no floor of theirs to read from.` };

    // Their floors, as the knowledge graph sees them, and everything those floors see.
    const floors = await api.get<{ floors: KgFloor[] }>(`${KG}/floors`, { floor: home.id });
    if (!ctx.check(`the knowledge graph answers on their floor (${home.name})`, floors.ok, { actual: floors.status })) return;
    ctx.check('their floor is among the ones they stand on', floors.body.floors.some((f) => f.id === home.id), { actual: floors.body.floors.map((f) => f.id) });
    const sight = new Set(floors.body.floors.flatMap((f) => [f.id, ...f.sight]));

    // A floor they are not on is refused, saying why.
    const other = Object.values(ctx.seeded.floors ?? {}).find((f) => !onFloors.has(f.id) && !sight.has(f.id));
    if (other) {
      const there = await api.get<Problem>(`${KG}/floors/${encodeURIComponent(other.id)}/entities?limit=1`, { floor: other.id });
      ctx.check(`a floor they are not on (${other.name}) is refused`, there.status === 403, { expected: 403, actual: there.status });
      ctx.check('the refusal says why', typeof (there.body?.detail ?? there.body?.message) === 'string', { actual: there.body });
    } else ctx.note(`${reader.key} sees every seeded floor, so no floor is refused this time.`);

    // Something kept beyond their sight: the keeper's report, on a floor of theirs the reader doesn't see.
    const away = keeper.floors.find((f) => f.id && !sight.has(f.id));
    if (!away) return { ok: false, why: `Every floor of ${keeper.key}'s is in ${reader.key}'s sight, so nothing is kept beyond it this time.` };
    const key = (ctx.state[`key:${away.id}`] as string | undefined) ?? `RUN26-${ctx.now().getTime()}-${Math.floor(ctx.random() * 1e9).toString(36)}`;
    if (!ctx.state[`key:${away.id}`]) {
      const title = `Run suite report ${key}`;
      const retained = await keeperApi.post(
        `${KG}/actions/retain`,
        {
          source: { app: 'run-suite', ref: key, version: '1', contentSha256: createHash('sha256').update(title).digest('hex'), title },
          extractor: 'run-suite',
          entities: [{ ref: 'ship', label: `MV ${key}`, class: 'kg:Ship', identityKeys: [{ scheme: 'run-suite', value: key }] }],
          observations: [{ subject: 'ship', predicate: 'kg:capacity', kind: 'property', value: { v: 120, unit: 'TEU' }, quote: '120 TEU', modality: 'reported' }],
        },
        { floor: away.id!, key },
      );
      if (!ctx.check(`${keeper.key} keeps a report on ${away.name}`, retained.ok, { actual: retained.status })) return;
      ctx.state[`key:${away.id}`] = key;
    }
    const seen = await api.get<Unseen>(`${KG}/floors/${encodeURIComponent(home.id!)}/lookup?scheme=run-suite&value=${encodeURIComponent(key)}`, { floor: home.id });
    if (!ctx.check('the lookup answers', seen.ok, { actual: seen.status })) return;
    ctx.check('it says the ship is kept beyond their sight', seen.body?.unseen?.reason === 'elsewhere', { actual: seen.body });
    ctx.check('it names only the kind of floor that keeps it', seen.body?.unseen?.floorKind === 'team' && !JSON.stringify(seen.body).includes(away.id!), { actual: seen.body });
    ctx.check('it never gives the ship’s name', !JSON.stringify(seen.body).includes(`MV ${key}`), { actual: seen.body });
  },
};
