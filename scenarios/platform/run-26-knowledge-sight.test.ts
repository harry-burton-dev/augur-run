// RUN-26 against a stand-in gateway: what passes when the fence holds, what fails when a lookup leaks a name,
// and that a release without the knowledge graph is "not available", not a failure.
import { describe, expect, it } from 'vitest';
import type { ScenarioContext } from '../../src/scenario.ts';
import { knowledgeSight } from './run-26-knowledge-sight.ts';

const READER = { key: 'reader', floors: [{ key: 'ops', id: 'f-ops', name: 'Operations' }] };
const KEEPER = { key: 'keeper', floors: [{ key: 'fin', id: 'f-fin', name: 'Finance' }] };

const deployment = (o: { meta?: number; leak?: boolean } = {}) => {
  const checks: { label: string; ok: boolean }[] = [];
  const calls: string[] = [];
  let kept: { key?: string; label?: string } = {};
  const answer = (status: number, body?: unknown) => ({ status, ok: status < 300, body });
  const reader = {
    get: async (path: string) => {
      calls.push(`GET ${path}`);
      if (path.endsWith('/meta')) return answer(o.meta ?? 200, {});
      if (path === '/api/identity/v1/me/workspaces') return answer(200, { workspaces: [{ id: 'f-org' }, { id: 'f-ops' }] });
      if (path === '/api/knowledge/v1/floors') return answer(200, { floors: [{ id: 'f-org', kind: 'org', sight: ['f-org'] }, { id: 'f-ops', kind: 'team', sight: ['f-ops', 'f-org'] }] });
      if (path.startsWith('/api/knowledge/v1/floors/f-fin/')) return answer(403, { detail: 'You can’t stand on that floor.' });
      if (path.includes('/lookup?')) {
        const value = decodeURIComponent(path.split('value=')[1]!);
        if (value !== kept.key) return answer(404, {});
        return answer(200, o.leak ? { kind: 'entity', id: 'ent_1', label: kept.label } : { kind: 'entity', id: `run-suite:${value}`, unseen: { reason: 'elsewhere', floorKind: 'team', message: 'Kept on a team floor.' } });
      }
      return answer(404, {});
    },
  };
  const keeper = {
    post: async (path: string, body: { entities: { label: string; identityKeys: { value: string }[] }[] }, opts: { floor: string; key: string }) => {
      calls.push(`POST ${path} on ${opts.floor} key=${opts.key ? 'yes' : 'no'}`);
      kept = { key: body.entities[0]!.identityKeys[0]!.value, label: body.entities[0]!.label };
      return answer(200, {});
    },
  };
  const ctx = {
    parts: { reader: { persona: READER, api: reader }, keeper: { persona: KEEPER, api: keeper } },
    seeded: { floors: { ops: { id: 'f-ops', name: 'Operations' }, fin: { id: 'f-fin', name: 'Finance' } } },
    state: {},
    now: () => new Date(Date.UTC(2026, 10, 12, 9)),
    random: () => 0.5,
    check: (label: string, ok: boolean) => (checks.push({ label, ok }), ok),
    note: () => {},
  } as unknown as ScenarioContext;
  return { ctx, checks, calls };
};

describe('RUN-26, the knowledge graph’s fence', () => {
  it('passes when the floor is refused and the lookup names only the kind of floor', async () => {
    const d = deployment();
    expect(await knowledgeSight.available!(d.ctx)).toEqual({ ok: true });
    expect(await knowledgeSight.run(d.ctx)).toBeUndefined();
    expect(d.checks.length).toBeGreaterThan(5);
    expect(d.checks.filter((c) => !c.ok)).toEqual([]);
    expect(d.calls).toContain('POST /api/knowledge/v1/actions/retain on f-fin key=yes');
    // The report is kept once; later runs look the same key up.
    await knowledgeSight.run(d.ctx);
    expect(d.calls.filter((c) => c.startsWith('POST'))).toHaveLength(1);
  });

  it('fails when a lookup beyond sight gives the name', async () => {
    const d = deployment({ leak: true });
    await knowledgeSight.run(d.ctx);
    expect(d.checks.filter((c) => !c.ok).map((c) => c.label)).toEqual(expect.arrayContaining(['it never gives the ship’s name']));
  });

  it('is not available on a release without the knowledge graph', async () => {
    expect(await knowledgeSight.available!(deployment({ meta: 404 }).ctx)).toMatchObject({ ok: false, why: expect.stringMatching(/no knowledge graph/) });
  });
});
