import type { Scenario } from '../../src/scenario.ts';
import { MINUTE, PATHS, type Floor, type PreviewsAdmin, type PreviewsForMe } from './shared.ts';

/**
 * An admin turns one app's feature preview on for one floor; within 5 minutes people on that floor get it
 * and people on another floor don't, with no release. Who got it before is put back after.
 */
export const floorPreview: Scenario = {
  id: 'RUN-11',
  title: 'A feature preview is turned on for one floor',
  owner: 'platform',
  goals: [28],
  given: 'An app that offers a feature preview, and two people on different floors who can open it.',
  when: 'An admin turns the preview on for one floor only.',
  then: 'Within 5 minutes the person on that floor gets it and the person on the other floor doesn’t, with no release; Activity records the change, and the preview goes back to how it was.',
  cadence: { kind: 'once', afterMinutes: 120 },
  needs: [{ as: 'admin', role: 'admin' }, { as: 'on', floors: 'own', notSameAs: ['admin'] }, { as: 'off', floors: 'own', notSameAs: ['admin', 'on'] }],
  available: async (ctx) => {
    const r = await ctx.parts.admin!.api.get<PreviewsForMe>(PATHS.previews);
    if (!r.ok) return { ok: false, why: `Feature previews can’t be read (${r.status}).` };
    const offered = r.body.apps.some((a) => a.previews.some((p) => !p.ended));
    return offered ? { ok: true } : { ok: false, why: 'No app on this deployment offers a feature preview that hasn’t ended.', whoCanChange: 'An app team, by listing `previews` in its manifest.' };
  },
  run: async (ctx) => {
    const admin = ctx.parts.admin!;
    const on = ctx.parts.on!;
    const off = ctx.parts.off!;
    // A floor for each, where neither can reach the other's: a preview on a floor reaches the floors beneath it.
    const reach = async (part: typeof on) => {
      const r = await part.api.get<{ workspaces: Floor[] }>(PATHS.workspaces);
      return new Set(r.ok ? r.body.workspaces.map((f) => f.id) : []);
    };
    const [onReach, offReach] = await Promise.all([reach(on), reach(off)]);
    const onFloor = on.persona.floors.find((f) => f.id && onReach.has(f.id) && !offReach.has(f.id));
    const offFloor = off.persona.floors.find((f) => f.id && offReach.has(f.id) && !onReach.has(f.id));
    if (!onFloor || !offFloor) {
      ctx.note(`${on.persona.key} and ${off.persona.key} can reach each other’s floors, so there is no floor for one and not the other.`);
      return;
    }
    const listed = await admin.api.get<PreviewsForMe>(PATHS.previews);
    const choice = listed.body.apps.flatMap((a) => a.previews.filter((p) => !p.ended).map((p) => ({ app: a.app, preview: p.id }))).at(0)!;
    const before = await admin.api.get<PreviewsAdmin>(PATHS.appPreviews(choice.app));
    if (!ctx.check(`the admin reads who gets ${choice.app}’s previews`, before.ok, { actual: before.status })) return;
    const was = before.body.previews.find((p) => p.id === choice.preview);
    const since = ctx.now().toISOString();
    const set = await admin.api.put(PATHS.appPreview(choice.app, choice.preview), { mode: 'floors', floors: [onFloor.id] });
    if (!ctx.check(`the admin turns ${choice.app}’s ${choice.preview} on for ${onFloor.name} only`, set.ok, { actual: set.status })) return;
    try {
      const isOn = async (part: typeof on, floor: string) => {
        const r = await part.api.get<PreviewsForMe>(PATHS.previews, { floor });
        return r.ok ? r.body.apps.find((a) => a.app === choice.app)?.previews.find((p) => p.id === choice.preview)?.on : undefined;
      };
      const seen = await ctx.eventually(async () => {
        const [a, b] = await Promise.all([isOn(on, onFloor.id!), isOn(off, offFloor.id!)]);
        return { ok: a === true && b === false, value: { [onFloor.name]: a, [offFloor.name]: b } };
      }, { withinMs: 5 * MINUTE });
      ctx.check(`${on.persona.key} on ${onFloor.name} gets it and ${off.persona.key} on ${offFloor.name} doesn’t, within 5 minutes`, seen.ok, { expected: { [onFloor.name]: true, [offFloor.name]: false }, actual: seen.value });
      const log = await admin.api.get<{ action: string; actor?: { id: string } }[]>(`${PATHS.audit}?since=${encodeURIComponent(since)}&limit=100`);
      const entry = log.ok && Array.isArray(log.body) ? log.body.find((e) => e.action === 'app.preview-set') : undefined;
      ctx.check('Activity records app.preview-set by the admin', entry?.actor?.id === admin.persona.id, { actual: log.ok ? log.body.map((e) => e.action) : log.status });
    } finally {
      const back = await admin.api.put(PATHS.appPreview(choice.app, choice.preview), was?.chosen ? { mode: was.mode, ...(was.mode === 'floors' ? { floors: was.floors } : {}) } : { mode: null });
      ctx.check(`${choice.preview} goes back to how it was`, back.ok, { actual: back.status });
    }
  },
};
