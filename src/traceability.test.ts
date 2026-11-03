// traceability.md and the scenarios must agree: it is the run gate's checklist.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { scenarios } from '../scenarios/platform/index.ts';
import { scenarioProblems } from './scenario.ts';

type Row = { goals: string[]; runs: string[]; status: string };

/** "29, 30, 33a" or "35 to 38" → the goal numbers it covers. */
const goalsIn = (cell: string) =>
  cell.split(',').flatMap((part) => {
    const range = part.trim().match(/^(\d+) to (\d+)$/);
    if (!range) return [part.trim()];
    const out: string[] = [];
    for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
    return out;
  });

const rows = (): Row[] =>
  readFileSync(new URL('../traceability.md', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => /^\| \d/.test(l))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      return { goals: goalsIn(cells[1] ?? ''), runs: (cells[4] ?? '').match(/RUN-\d{2,}/g) ?? [], status: cells[5] ?? '' };
    });

describe('traceability.md', () => {
  it('has rows, each with a known status', () => {
    expect(rows().length).toBeGreaterThan(10);
    for (const r of rows()) expect(['Written', 'Waiting', 'Elsewhere', 'Green']).toContain(r.status);
  });

  it('names only scenarios that exist', () => {
    const known = new Set(scenarios.map((s) => s.id));
    const unknown = rows().flatMap((r) => r.runs).filter((id) => !known.has(id));
    expect(unknown).toEqual([]);
  });

  it('has a row for every scenario, naming every goal it proves', () => {
    const missing: string[] = [];
    for (const s of scenarios) {
      const mine = rows().filter((r) => r.runs.includes(s.id));
      if (!mine.length) missing.push(`${s.id} has no row`);
      for (const g of s.goals) if (!mine.some((r) => r.goals.includes(String(g)))) missing.push(`${s.id}'s goal ${g} is in none of its rows`);
    }
    expect(missing).toEqual([]);
  });

  it('marks a scenario Waiting exactly when it waits on work not yet in AUGUR', async () => {
    const wrong: string[] = [];
    for (const s of scenarios) {
      const waits = !!s.available && (await s.available({} as never).catch(() => ({ ok: true }))).ok === false;
      for (const r of rows().filter((x) => x.runs.length === 1 && x.runs[0] === s.id)) {
        if (waits !== (r.status === 'Waiting')) wrong.push(`${s.id} is ${r.status} but ${waits ? 'waits' : 'runs'}`);
      }
    }
    expect(wrong).toEqual([]);
  });
});

describe('the platform scenarios', () => {
  it('have good ids, goals and parts', () => {
    expect(scenarioProblems(scenarios)).toEqual([]);
  });
});
