import type { Scenario } from '../../src/scenario.ts';
import { PATHS, type AuditEntry } from './shared.ts';

/** Changes that say what they were before and after; `person.updated` keeps them per field. */
const BEFORE_AND_AFTER: Record<string, (detail: Record<string, unknown>) => boolean> = {
  'organisation.changed': (d) => typeof d.from === 'object' && typeof d.to === 'object',
  'person.updated': (d) => Object.entries(d).some(([k, v]) => k !== 'username' && !!v && typeof v === 'object' && 'from' in v && 'to' in v),
};

const CSV_HEADER = 'at,actor,actorKind,app,action,target,floor,detail';

/** An admin reads what changed during the run, with before and after, and downloads the same rows. */
export const activityExport: Scenario = {
  id: 'RUN-14',
  title: 'Activity shows before and after, and exports',
  owner: 'platform',
  goals: [12],
  given: 'Admin changes made during the run, such as RUN-09’s renaming of the organisation.',
  when: 'An admin opens Activity for the run so far and downloads it as JSON lines and as CSV.',
  then: 'Each change says what it was before and after; both downloads hold the same rows as Activity, and the download is itself recorded.',
  cadence: { kind: 'once', afterMinutes: 40 * 60 },
  needs: [{ as: 'admin', role: 'admin' }],
  run: async (ctx) => {
    const { api } = ctx.parts.admin!;
    const until = ctx.now().toISOString();
    const since = new Date(ctx.now().getTime() - 48 * 60 * 60_000).toISOString();
    const window = `since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}`;
    const page = await api.get<AuditEntry[]>(`${PATHS.audit}?${window}&limit=500`);
    if (!ctx.check('the admin reads Activity for the run so far', page.ok && Array.isArray(page.body), { actual: page.status })) return;

    const changes = page.body.filter((e) => e.action in BEFORE_AND_AFTER);
    ctx.check('Activity holds admin changes from the run', changes.length > 0, { actual: [...new Set(page.body.map((e) => e.action))] });
    const bare = changes.filter((e) => !BEFORE_AND_AFTER[e.action]!(e.detail ?? {}));
    ctx.check('every change says what it was before and after', bare.length === 0, { actual: bare.map((e) => `${e.action} ${e.id}`) });

    const jsonl = await api.download(`${PATHS.auditExport}?${window}&format=jsonl`);
    if (!ctx.check('Activity downloads as JSON lines', jsonl.ok && typeof jsonl.body === 'string', { actual: jsonl.status })) return;
    const rows = (() => {
      try {
        return jsonl.body.split('\n').filter(Boolean).map((line) => JSON.parse(line) as AuditEntry);
      } catch {
        return undefined;
      }
    })();
    if (!ctx.check('each downloaded line is an entry', !!rows, { actual: jsonl.body.slice(0, 200) }) || !rows) return;
    const ids = new Set(rows.map((r) => r.id));
    const missing = page.body.filter((e) => !ids.has(e.id));
    ctx.check('the download holds every row Activity shows', missing.length === 0, { actual: missing.map((e) => e.id) });
    // A page holds at most 500; when it isn't full, the download is exactly the same rows.
    if (page.body.length < 500) ctx.check('the download holds no row Activity doesn’t', rows.length === page.body.length, { expected: page.body.length, actual: rows.length });

    const csv = await api.download(`${PATHS.auditExport}?${window}&format=csv`);
    if (ctx.check('Activity downloads as CSV', csv.ok && typeof csv.body === 'string', { actual: csv.status })) {
      ctx.check('the CSV has its columns first', csv.body.split('\n')[0] === CSV_HEADER, { expected: CSV_HEADER, actual: csv.body.split('\n')[0] });
    }

    const after = await api.get<AuditEntry[]>(`${PATHS.audit}?since=${encodeURIComponent(until)}&limit=50`);
    const exported = after.ok && Array.isArray(after.body) ? after.body.filter((e) => e.action === 'audit.exported') : [];
    ctx.check('each download is recorded in Activity as audit.exported', exported.length >= 2 && exported.every((e) => e.actor?.id === ctx.parts.admin!.persona.id), { actual: after.ok ? after.body.map((e) => e.action) : after.status });
  },
};
