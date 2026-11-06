import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openLedger, verdict } from './ledger.ts';
import { tempDir } from './test/fixtures.ts';

describe('the run ledger', () => {
  it('keeps one row per incident: a repeat of an open row is seen again, not raised again', () => {
    const l = openLedger(join(tempDir(), 'ledger.jsonl'));
    const a = l.raise({ key: 'RUN-01: x', what: 'x failed', suggested: 'failure', evidence: ['E-1'] });
    const b = l.raise({ key: 'RUN-01: x', what: 'x failed', evidence: ['E-9'] });
    expect(b.id).toBe(a.id);
    expect(l.rows()).toHaveLength(1);
    expect(l.rows()[0]).toMatchObject({ times: 2, evidence: ['E-1', 'E-9'] });
    // Once someone has classified it, the next sighting is a new incident.
    l.classify(a.id, 'no-action', 'A one-off restart.', 'tester');
    expect(l.raise({ key: 'RUN-01: x', what: 'x failed' }).id).not.toBe(a.id);
  });

  it('asks for a reason, a name, a real class, and a failure kind for a failure', () => {
    const l = openLedger(join(tempDir(), 'ledger.jsonl'));
    const { id } = l.raise({ what: 'y' });
    expect(() => l.classify(id, 'fine', 'ok', 'me')).toThrow(/isn't a class/);
    expect(() => l.classify(id, 'failure', 'lost rows', 'me')).toThrow(/kind/);
    expect(() => l.classify(id, 'docs-gap', ' ', 'me')).toThrow(/why/);
    expect(() => l.classify('L-404', 'docs-gap', 'x', 'me')).toThrow(/no row/);
    expect(l.classify(id, 'failure', 'Rows were lost.', 'me', 'data-loss')).toMatchObject({ class: 'failure', kind: 'data-loss' });
  });

  it('reads back what was written, so a run that stopped carries on', () => {
    const path = join(tempDir(), 'ledger.jsonl');
    const first = openLedger(path);
    first.raise({ what: 'one' });
    first.classify('L-001', 'docs-gap', 'deploy.md missed it.', 'me');
    const again = openLedger(path);
    expect(again.rows()).toMatchObject([{ id: 'L-001', class: 'docs-gap' }]);
    expect(again.raise({ what: 'two' }).id).toBe('L-002');
  });

  it('passes only with no failure and nothing unclassified', () => {
    const l = openLedger(join(tempDir(), 'ledger.jsonl'));
    expect(verdict(l.rows())).toMatchObject({ passed: true });
    l.raise({ what: 'a' });
    expect(verdict(l.rows())).toMatchObject({ passed: false, reason: expect.stringMatching(/needs? a class/) });
    l.classify('L-001', 'patch', 'Fixed in a patch.', 'me');
    expect(verdict(l.rows()).passed).toBe(true);
    l.raise({ what: 'b' });
    l.classify('L-002', 'failure', 'The alert never came.', 'me', 'missed-alert');
    expect(verdict(l.rows())).toMatchObject({ passed: false, reason: expect.stringMatching(/failure/) });
  });

  it('never passes a run that stopped early, ran only some scenarios, or proved nothing', () => {
    expect(verdict([], { stopped: 'Stopped by the operator (SIGINT).' })).toMatchObject({ passed: false, reason: expect.stringMatching(/didn’t reach its end.*SIGINT/) });
    expect(verdict([], { partial: 'only RUN-01' })).toMatchObject({ passed: false, reason: expect.stringMatching(/only RUN-01/) });
    expect(verdict([], { proved: 0 })).toMatchObject({ passed: false, reason: expect.stringMatching(/No scenario passed/) });
    expect(verdict([], { proved: 3 })).toMatchObject({ passed: true });
    // A dry run says what it didn't prove, without failing for it.
    expect(verdict([], { proved: 3, notProved: ['RUN-12'] })).toMatchObject({ passed: true, reason: expect.stringMatching(/RUN-12/) });
  });
});
