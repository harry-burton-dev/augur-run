// traceability.md and the scenarios must agree: it is the run gate's checklist.
import { describe, expect, it } from 'vitest';
import { scenarios } from '../scenarios/platform/index.ts';
import { scenarioProblems } from './scenario.ts';
import { readTraceability, traceRows, writtenScenarios } from './traceability.ts';

const rows = () => traceRows(readTraceability());

describe('traceability.md', () => {
  it('has rows, each with a known status', () => {
    expect(rows().length).toBeGreaterThan(10);
    for (const r of rows()) expect(['Written', 'Waiting', 'Elsewhere', 'Green']).toContain(r.status);
  });

  it('names only scenarios that exist', () => {
    const known = new Set(scenarios.map((s) => s.id));
    const unknown = rows().filter((r) => !r.app).flatMap((r) => r.runs).filter((id) => !known.has(id));
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

describe('what a full run must include', () => {
  it('is every scenario in a Written row, the apps’ included', () => {
    const written = writtenScenarios(readTraceability());
    expect(written).toEqual(expect.arrayContaining(['RUN-01', 'RUN-08', 'RUN-15', 'RUN-19', 'RUN-20']));
    for (const s of scenarios) expect(written).toContain(s.id);
  });
});

describe('the platform scenarios', () => {
  it('have good ids, goals and parts', () => {
    expect(scenarioProblems(scenarios)).toEqual([]);
  });
});
