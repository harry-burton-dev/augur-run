// A tiny cast and seed ledger for tests, in the seed's shapes. The run itself reads the seed's own files.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Cast, SeedLedger } from '../synthetic.ts';

export const GATEWAY = 'http://augur.test:8080';

export const cast: Cast = {
  synthetic: { emailDomain: 'test.augur.invalid', usernamePrefix: 't-', note: 'Test data.' },
  floors: [{ key: 'one', name: 'Floor One', teams: [{ key: 'one-a', name: 'Team A' }] }, { key: 'two', name: 'Floor Two' }],
  people: [
    { key: 'ann', firstName: 'Ann', lastName: 'A', floors: ['one'], roles: ['editor', 'publisher'] },
    { key: 'bo', firstName: 'Bo', lastName: 'B', floors: ['one-a'], roles: ['editor'] },
    { key: 'cy', firstName: 'Cy', lastName: 'C', floors: ['two'] },
    { key: 'di', firstName: 'Di', lastName: 'D', floors: [], roles: ['admin'] },
    { key: 'ed', firstName: 'Ed', lastName: 'E', floors: ['two'] },
  ],
};

const person = (key: string, n: number) => ({ id: `p-${n}`, username: `t-${key}`, email: `t-${key}@test.augur.invalid`, temporaryPassword: `temp-${key}` });

export const seeded: SeedLedger = {
  schema: 'augur.seed-ledger/v1',
  gateway: GATEWAY,
  floors: { one: { id: 'f-1', name: 'Floor One' }, 'one-a': { id: 'f-1a', name: 'Team A' }, two: { id: 'f-2', name: 'Floor Two' } },
  // Ed is in the cast but wasn't seeded.
  people: { ann: person('ann', 1), bo: person('bo', 2), cy: person('cy', 3), di: person('di', 4) },
};

export const tempDir = () => mkdtempSync(join(tmpdir(), 'augur-run-test-'));

export const files = () => {
  const dir = tempDir();
  writeFileSync(join(dir, 'cast.json'), JSON.stringify(cast));
  writeFileSync(join(dir, 'seed.json'), JSON.stringify(seeded));
  return { dir, castPath: join(dir, 'cast.json'), seedLedgerPath: join(dir, 'seed.json') };
};

/** A fake fetch from a table of `METHOD path` to answers; anything else is a 404. */
export const fakeFetch = (routes: Record<string, (body: unknown, headers: Record<string, string>) => { status?: number; body?: unknown }>) => {
  const calls: { method: string; path: string; headers: Record<string, string> }[] = [];
  const impl = (async (input: string | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const method = init.method ?? 'GET';
    const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ method, path: url.pathname + url.search, headers });
    const route = routes[`${method} ${url.pathname}`];
    const body = init.body instanceof URLSearchParams ? Object.fromEntries(init.body) : typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    const answer = route ? route(body, headers) : { status: 404, body: { error: 'not_found' } };
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), { status: answer.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
  return { impl, calls };
};
