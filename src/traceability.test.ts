// traceability.md and the scenarios must agree: it is the run gate's checklist.
import { describe, expect, it } from 'vitest';
import { scenarios } from '../scenarios/platform/index.ts';
import { scenarioProblems } from './scenario.ts';
import { readTraceability, traceRows, writtenScenarios } from './traceability.ts';

const rows = () => traceRows(readTraceability());

describe('traceability.md', () => {
  it('has rows, each with a known status', () => {
    expect(rows().length).toBeGreaterThan(10);
    for (const r of rows()) expect(['Written', 'Waiting', 'Waiting on an app', 'Elsewhere', 'Green']).toContain(r.status);
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
    expect(written).toEqual(expect.arrayContaining(['RUN-01', 'RUN-08']));
    for (const s of scenarios) expect(written).toContain(s.id);
  });

  it('leaves out a scenario whose app is out of AUGUR, which waits on that app and says why', () => {
    const md = [
      '| 1 | One | Run | RUN-01 | Written | |',
      "| 2 | Two | Run | RUN-15, in augur-folio's `run/` module | Waiting on an app | Artifacts was taken out of AUGUR to be redesigned |",
    ].join('\n');
    expect(writtenScenarios(md)).toEqual(['RUN-01']);
    const wrong = rows()
      .filter((r) => r.status === 'Waiting on an app')
      .filter((r) => !r.app || !r.evidence)
      .map((r) => r.runs.join(' '));
    expect(wrong).toEqual([]);
  });

  // Artifacts (augur-folio), Data Atlas (augur-atlas) and Mandate (augur-mandate) were taken out of AUGUR to be
  // redesigned under the app contract, so no deployment can run their scenarios until each is installable again.
  // Remove an app's repository from here, and its rows' status, in the pull request that makes it installable again.
  const OUT = ['augur-folio', 'augur-atlas', 'augur-mandate'];
  it('expects no scenario of an app taken out of AUGUR', () => {
    const expected = rows().filter((r) => r.status === 'Written' && OUT.some((repo) => r.scenario.includes(repo)));
    expect(expected.map((r) => r.runs.join(' '))).toEqual([]);
  });
});

describe('the platform scenarios', () => {
  it('have good ids, goals and parts', () => {
    expect(scenarioProblems(scenarios)).toEqual([]);
  });
});
