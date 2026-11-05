// The platform scenarios against a stand-in AUGUR that answers as the real one does, in a dry run. The
// dry-run workflow then runs them against a real fresh install.
import { describe, expect, it } from 'vitest';
import { startRun } from '../../src/run.ts';
import { fakeFetch, files, GATEWAY, seeded } from '../../src/test/fixtures.ts';
import type { Clock } from '../../src/timeline.ts';
import { scenarios } from './index.ts';

const OIDC = '/sso/realms/platform/protocol/openid-connect';

/** A small AUGUR: people, floors and their members, Status and Activity. Tokens name the person. */
const augur = (o: { removalSticks?: boolean } = {}) => {
  const people = Object.values(seeded.people!);
  const members = new Map<string, Set<string>>([
    ['f-1', new Set(['p-1'])],
    ['f-1a', new Set(['p-2'])],
    ['f-2', new Set(['p-3'])],
  ]);
  const roles: Record<string, string[]> = { 'p-1': ['editor', 'publisher'], 'p-2': ['editor'], 'p-3': [], 'p-4': ['admin'] };
  const audit: unknown[] = [];
  // One app with one preview: on for chosen floors and the floors beneath them, else off.
  let preview: { mode: string; floors?: string[]; chosen: boolean } = { mode: 'off', chosen: false };
  const below = (floor: string, top: string) => floor === top || (top === 'f-1' && floor === 'f-1a');
  let org = { name: 'Org', timeZone: 'UTC', sender: { name: 'Org' } };
  let signingIn = '';
  const who = (h: Record<string, string>) => h.authorization?.replace('Bearer ', '') ?? '';
  const floorsOf = (id: string) => [
    { id: 'org', kind: 'org', name: org.name },
    ...[...members].filter(([, m]) => m.has(id)).map(([f]) => ({ id: f, kind: 'department', name: f })),
    // A team floor's people can reach the floor above it.
    ...(members.get('f-1a')!.has(id) && !members.get('f-1')!.has(id) ? [{ id: 'f-1', kind: 'department', name: 'f-1' }] : []),
  ];
  const routes: Parameters<typeof fakeFetch>[0] = {
    [`POST ${OIDC}/auth/device`]: () => ({ body: { device_code: 'd', user_code: 'U', verification_uri: 'x', interval: 1, expires_in: 60 } }),
    [`POST ${OIDC}/token`]: () => ({ body: { access_token: people.find((p) => p.username === signingIn)!.id, expires_in: 300 } }),
    'GET /api/gateway/v1/status': (_b, h) =>
      roles[who(h)]?.includes('admin')
        ? { body: { components: [{ name: 'gateway', state: 'up', version: '0.17.1' }, { name: 'identity', state: 'up' }], seeding: { allowed: true }, backups: { state: 'ok', lastBackup: { at: new Date().toISOString(), ok: true } } } }
        : { status: 403, body: { message: 'Only admins.' } },
    'GET /api/identity/v1/me': (_b, h) => ({ body: { id: who(h), roles: roles[who(h)] } }),
    'GET /api/identity/v1/me/workspaces': (_b, h) => ({ body: { workspaces: floorsOf(who(h)) } }),
    'GET /api/registry/v1/manifest': (_b, h) => (h['x-workspace-id'] && !floorsOf(who(h)).some((f) => f.id === h['x-workspace-id']) ? { status: 403, body: { error: 'forbidden', message: 'You’re not on that floor.' } } : { body: [] }),
    'GET /api/events/v1/notifications': () => ({ body: [] }),
    'GET /api/events/v1/audit': () => ({ body: audit }),
    'GET /api/registry/v1/feature-previews': (_b, h) => ({
      body: { apps: [{ app: 'folio', name: 'Artifacts', previews: [{ id: 'board-view', name: 'Board view', mode: preview.mode, ended: false, on: preview.mode === 'floors' && !!preview.floors?.some((f) => below(h['x-workspace-id'] ?? '', f)) }] }] },
    }),
    'GET /api/registry/v1/apps/folio/feature-previews': () => ({ body: { defaultMode: 'off', ring: 'production', previews: [{ id: 'board-view', name: 'Board view', ...preview, ended: false, optedIn: 0 }] } }),
    'PUT /api/registry/v1/apps/folio/feature-previews/board-view': (b, h) => {
      const { mode, floors } = b as { mode: string | null; floors?: string[] };
      preview = mode === null ? { mode: 'off', chosen: false } : { mode, floors, chosen: true };
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: 'app.preview-set', target: 'folio' });
      return { body: {} };
    },
    'GET /api/identity/v1/organisation': () => ({ body: org }),
    'PATCH /api/identity/v1/admin/organisation': (b, h) => {
      if (!roles[who(h)]?.includes('admin')) return { status: 403, body: { message: 'Only admins.' } };
      org = { ...org, ...(b as object) };
      audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: 'organisation.changed', target: 'org' });
      return { body: org };
    },
  };
  const member = (add: boolean) => (floor: string, person: string, h: Record<string, string>) => {
    if (add || !o.removalSticks) members.get(floor)![add ? 'add' : 'delete'](person);
    audit.unshift({ id: `a${audit.length}`, at: new Date().toISOString(), actor: { id: who(h) }, action: add ? 'department.member-added' : 'department.member-removed', target: floor, detail: { person } });
    return { status: 204 };
  };
  const base = fakeFetch(routes);
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const path = new URL(String(input)).pathname;
    const m = path.match(/^\/api\/identity\/v1\/admin\/departments\/([^/]+)\/members\/([^/]+)$/);
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    if (m && (init.method === 'PUT' || init.method === 'DELETE')) {
      const r = member(init.method === 'PUT')(m[1]!, m[2]!, headers);
      return new Response(null, { status: r.status });
    }
    return base.impl(input, init);
  }) as typeof fetch;
  return { impl, setSigningIn: (u: string) => (signingIn = u) };
};

describe('the platform scenarios in a dry run', () => {
  const dry = async (a: ReturnType<typeof augur>) => {
    const f = files();
    let t = Date.UTC(2026, 10, 10, 12);
    const clock: Clock = { now: () => t, sleep: async (ms) => void (t += ms) };
    const { summary } = await startRun({
      gateway: GATEWAY,
      issuer: `${GATEWAY}/sso/realms/platform`,
      castPath: f.castPath,
      seedLedgerPath: f.seedLedgerPath,
      scenarios,
      approve: async (o) => (a.setSigningIn(o.username), { usedPassword: o.passwords[0]! }),
      mode: 'dry',
      seed: 3,
      run: 'platform',
      workDir: `${f.dir}/.run`,
      outDir: `${f.dir}/runs`,
      fetchImpl: a.impl,
      clock,
      log: () => {},
    });
    return summary;
  };

  it('pass against an AUGUR that keeps its promises, and the waiting ones say what they wait on', async () => {
    const summary = await dry(augur());
    const outcome = (id: string) => Object.keys(summary.scenarios[id]?.outcomes ?? {});
    for (const id of ['RUN-01', 'RUN-02', 'RUN-03', 'RUN-04', 'RUN-05', 'RUN-06', 'RUN-09', 'RUN-11']) expect([id, outcome(id)]).toEqual([id, ['passed']]);
    for (const id of ['RUN-07', 'RUN-08', 'RUN-10', 'RUN-12', 'RUN-13', 'RUN-14']) expect([id, outcome(id)]).toEqual([id, ['not-available']]);
    expect(summary.ledger).toEqual([]);
    expect(summary.verdict.passed).toBe(true);
  });

  it('raise a ledger row when access isn’t gone within 5 minutes', async () => {
    const summary = await dry(augur({ removalSticks: true }));
    expect(summary.ledger.map((r) => r.what)).toEqual([expect.stringMatching(/RUN|takes them off.*can no longer reach .* within 5 minutes/)]);
    expect(summary.verdict.passed).toBe(false);
  });
});
