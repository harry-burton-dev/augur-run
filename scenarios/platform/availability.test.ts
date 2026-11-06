// "Not available" is only for what a deployment lacks. A call that fails while a scenario asks is a failed
// check, so the fault is in the ledger instead of quietly taking the scenario out of the run.
import { describe, expect, it } from 'vitest';
import type { Scenario, ScenarioContext } from '../../src/scenario.ts';
import { invite } from './run-07-invite.ts';
import { nightlyBackup } from './run-06-nightly-backup.ts';
import { inbox } from './run-10-inbox.ts';
import { floorPreview } from './run-11-floor-preview.ts';
import { faultDrill } from './run-12-fault-drill.ts';
import { pointInTime } from './run-17-point-in-time.ts';

const asking = (answer: { status: number; body?: unknown }, o: { dry?: boolean; state?: Record<string, unknown> } = {}) => {
  const failed: string[] = [];
  const api = { get: async () => ({ ok: answer.status >= 200 && answer.status < 300, status: answer.status, body: answer.body }) };
  const part = { persona: { key: 'di' }, api };
  const ctx = {
    parts: { admin: part, watcher: part, owner: part },
    dry: o.dry ?? false,
    state: o.state ?? {},
    check: (label: string, ok: boolean) => (ok || failed.push(label), ok),
  } as unknown as ScenarioContext;
  return { ctx, failed };
};

const ask = async (s: Scenario, answer: { status: number; body?: unknown }, o?: Parameters<typeof asking>[1]) => {
  const { ctx, failed } = asking(answer, o);
  return { can: await s.available!(ctx), failed };
};

describe('asking whether a scenario can run', () => {
  it('fails a check when Status, the Inbox or the previews don’t answer', async () => {
    for (const s of [nightlyBackup, invite, inbox, floorPreview, faultDrill, pointInTime]) {
      const { can, failed } = await ask(s, { status: 502, body: { message: 'Bad gateway' } });
      expect([s.id, can.ok, failed.length]).toEqual([s.id, false, 1]);
    }
  });

  it('says "not available" only for what the deployment lacks', async () => {
    expect(await ask(nightlyBackup, { status: 200, body: {} })).toMatchObject({ can: { ok: false, why: expect.stringMatching(/doesn’t report backups/) }, failed: [] });
    expect(await ask(pointInTime, { status: 200, body: { backups: { state: 'ok' } } })).toMatchObject({ can: { ok: false }, failed: [] });
    expect(await ask(invite, { status: 200, body: { email: { state: 'off' } } })).toMatchObject({ can: { ok: false, whoCanChange: expect.stringContaining('SMTP_') }, failed: [] });
    // Email that is set up but failing is a fault: the invite runs, and its checks say what broke.
    expect(await ask(invite, { status: 200, body: { email: { state: 'attention', problem: 'The relay refused.' } } })).toMatchObject({ can: { ok: true }, failed: [] });
  });

  it('fails when something Status reported earlier in the run is gone', async () => {
    const state: Record<string, unknown> = {};
    expect((await ask(pointInTime, { status: 200, body: { backups: { state: 'ok', pointInTime: { ok: true } } } }, { state })).can.ok).toBe(true);
    const gone = await ask(pointInTime, { status: 200, body: { backups: { state: 'ok' } } }, { state });
    expect(gone.failed).toEqual(['Status still reports point-in-time restore, as it did earlier in the run']);
    const backups: Record<string, unknown> = {};
    await ask(nightlyBackup, { status: 200, body: { backups: { state: 'ok', lastBackup: { ok: true, at: '2026-11-10T02:00:00Z' } } } }, { state: backups });
    expect((await ask(nightlyBackup, { status: 200, body: {} }, { state: backups })).failed).toEqual(['Status still reports backups, as it did earlier in the run']);
  });
});
