import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { exportRun, openRecorder, pathShape, readEvidence, redact } from './evidence.ts';
import { tempDir } from './test/fixtures.ts';

describe('evidence', () => {
  it('never writes a secret, however it is named or nested', () => {
    expect(redact({ temporaryPassword: 'x', nested: [{ access_token: 'y', refresh_token: 'z' }], user_code: 'ABCD', note: 'Bearer abc', ok: 'kept', passed: 3 })).toEqual({
      temporaryPassword: '[redacted]',
      nested: [{ access_token: '[redacted]', refresh_token: '[redacted]' }],
      user_code: '[redacted]',
      note: '[redacted]',
      ok: 'kept',
      passed: 3,
    });
  });

  it('groups calls by their shape, without ids or query values', () => {
    expect(pathShape('/api/identity/v1/people/3f2c1b9a-1111-2222-3333-444455556666?limit=10&q=ann')).toBe('/api/identity/v1/people/:id?limit=…&q=…');
    expect(pathShape('/api/folio/v1/libraries/42/documents')).toBe('/api/folio/v1/libraries/:id/documents');
  });

  it('exports a summary and a report with the verdict first', () => {
    const dir = tempDir();
    const rec = openRecorder(join(dir, 'evidence.jsonl'));
    rec.release({ release: '0.17.1' });
    rec.call({ scenario: 'RUN-01', persona: 'ann', method: 'GET', path: '/api/identity/v1/me', status: 200, ms: 12, trace: 't' });
    rec.check({ scenario: 'RUN-01', check: 'sees themself', ok: true });
    rec.scenario({ scenario: 'RUN-01', outcome: 'passed', ms: 20 });
    rec.scenario({ scenario: 'RUN-02', outcome: 'not-available', ms: 1, why: 'Not built yet.' });
    expect(readEvidence(rec.path)).toHaveLength(5);
    const { summary, dir: out } = exportRun({ run: 'r1', gateway: 'http://x', mode: 'dry', evidencePath: rec.path, ledger: [], outDir: join(dir, 'runs') });
    expect(summary.scenarios['RUN-01']).toMatchObject({ runs: 1, outcomes: { passed: 1 }, checks: { passed: 1, failed: 0 } });
    expect(summary.calls['GET /api/identity/v1/me']).toMatchObject({ count: 1, statuses: { 200: 1 } });
    expect(summary.releases).toEqual([{ at: expect.any(String), release: '0.17.1' }]);
    const report = readFileSync(join(out, 'report.md'), 'utf8');
    expect(report).toMatch(/^# Run r1\n\n\*\*Passed\.\*\*/);
    expect(report).toContain('| RUN-02 | 1 | not-available 1 | 0 | 0 | Not built yet. |');
  });
});
