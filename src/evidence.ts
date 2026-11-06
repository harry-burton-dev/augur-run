// The evidence recorder: every call the suite makes and every check a scenario runs, as JSON lines under
// the run's working folder. Secrets never reach it: tokens, passwords and one-time codes are redacted
// before a line is written. `exportRun` condenses it into the summary kept in runs/.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { verdict, type LedgerRow, type RunFacts } from './ledger.ts';

export type CallEvidence = {
  type: 'call';
  id: string;
  at: string;
  scenario?: string;
  persona?: string;
  method: string;
  /** The path without its query string's values, so ids and names group together in the summary. */
  path: string;
  status: number;
  ms: number;
  /** The W3C trace id sent with the call, so the deployment's own traces can be found for it. */
  trace: string;
  floor?: string;
};

export type CheckEvidence = {
  type: 'check';
  id: string;
  at: string;
  scenario: string;
  persona?: string;
  check: string;
  ok: boolean;
  expected?: unknown;
  actual?: unknown;
};

export type ScenarioEvidence = {
  type: 'scenario';
  id: string;
  at: string;
  scenario: string;
  outcome: Outcome;
  ms: number;
  why?: string;
  personas?: string[];
};

export type NoteEvidence = { type: 'note'; id: string; at: string; scenario?: string; text: string; data?: unknown };
export type ReleaseEvidence = { type: 'release'; id: string; at: string; release: string; components?: unknown };

export type Evidence = CallEvidence | CheckEvidence | ScenarioEvidence | NoteEvidence | ReleaseEvidence;
/** How one run of a scenario ended. `not-available` is not a failure: the release doesn't have it yet. */
export type Outcome = 'passed' | 'failed' | 'error' | 'not-available' | 'no-persona';

const SECRET_KEY = /password|secret|token|authorization|cookie|otp|credential|^(.*_)?code$/i;

/** A copy of `value` with every secret-looking field replaced, however deep it is. */
export const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 20) return '[deep]';
  if (Array.isArray(value)) return value.map((v) => redact(v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SECRET_KEY.test(k) ? '[redacted]' : redact(v, depth + 1)]));
  }
  if (typeof value === 'string' && /^(Bearer\s|ey[A-Za-z0-9_-]{10,}\.)/.test(value)) return '[redacted]';
  return value;
};

/** A path with ids and query values taken out: `/api/identity/v1/people/:id?limit=…`. */
export const pathShape = (path: string) => {
  const [p = '', q] = path.split('?');
  const shaped = p
    .split('/')
    .map((seg) => (/^[0-9a-f]{8}-[0-9a-f]{4}-|^\d+$|^[A-Za-z0-9_-]{20,}$/.test(seg) ? ':id' : seg))
    .join('/');
  return q ? `${shaped}?${[...new URLSearchParams(q).keys()].map((k) => `${k}=…`).join('&')}` : shaped;
};

export const newTraceId = () => randomBytes(16).toString('hex');

export type Recorder = ReturnType<typeof openRecorder>;

/** Opens (or carries on) the evidence file at `path`. */
export const openRecorder = (path: string, now: () => Date = () => new Date()) => {
  let n = existsSync(path) ? readFileSync(path, 'utf8').split('\n').filter(Boolean).length : 0;
  mkdirSync(dirname(path), { recursive: true });
  const write = <T extends Evidence>(e: Omit<T, 'id' | 'at'>): T => {
    n += 1;
    const line = { id: `E-${n}`, at: now().toISOString(), ...(redact(e) as object) } as T;
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    return line;
  };
  return {
    path,
    call: (e: Omit<CallEvidence, 'id' | 'at' | 'type'>) => write<CallEvidence>({ type: 'call', ...e, path: pathShape(e.path) }),
    check: (e: Omit<CheckEvidence, 'id' | 'at' | 'type'>) => write<CheckEvidence>({ type: 'check', ...e }),
    scenario: (e: Omit<ScenarioEvidence, 'id' | 'at' | 'type'>) => write<ScenarioEvidence>({ type: 'scenario', ...e }),
    note: (e: Omit<NoteEvidence, 'id' | 'at' | 'type'>) => write<NoteEvidence>({ type: 'note', ...e }),
    release: (e: Omit<ReleaseEvidence, 'id' | 'at' | 'type'>) => write<ReleaseEvidence>({ type: 'release', ...e }),
  };
};

export const readEvidence = (path: string): Evidence[] =>
  existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Evidence)
    : [];

const p95 = (values: number[]) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
};

export type ScenarioSummary = { runs: number; outcomes: Partial<Record<Outcome, number>>; checks: { passed: number; failed: number }; lastWhy?: string };

/** What a run's evidence adds up to: per scenario, per call shape, and the releases seen. */
export const summarise = (evidence: Evidence[]) => {
  const scenarios: Record<string, ScenarioSummary> = {};
  const of = (id: string) => (scenarios[id] ??= { runs: 0, outcomes: {}, checks: { passed: 0, failed: 0 } });
  const calls: Record<string, { count: number; statuses: Record<string, number>; ms: number[] }> = {};
  const releases: { at: string; release: string }[] = [];
  let first: string | undefined;
  let last: string | undefined;
  for (const e of evidence) {
    first ??= e.at;
    last = e.at;
    if (e.type === 'scenario') {
      const s = of(e.scenario);
      s.runs += 1;
      s.outcomes[e.outcome] = (s.outcomes[e.outcome] ?? 0) + 1;
      if (e.why) s.lastWhy = e.why;
    } else if (e.type === 'check') {
      of(e.scenario).checks[e.ok ? 'passed' : 'failed'] += 1;
    } else if (e.type === 'call') {
      const key = `${e.method} ${e.path}`;
      const c = (calls[key] ??= { count: 0, statuses: {}, ms: [] });
      c.count += 1;
      c.statuses[e.status] = (c.statuses[e.status] ?? 0) + 1;
      c.ms.push(e.ms);
    } else if (e.type === 'release' && releases.at(-1)?.release !== e.release) {
      releases.push({ at: e.at, release: e.release });
    }
  }
  return {
    from: first,
    to: last,
    releases,
    scenarios,
    calls: Object.fromEntries(Object.entries(calls).map(([k, c]) => [k, { count: c.count, statuses: c.statuses, p95ms: p95(c.ms) }])),
  };
};

export type RunSummary = ReturnType<typeof summarise> & {
  schema: 'augur.run-summary/v1';
  run: string;
  gateway: string;
  suiteCommit?: string;
  mode: 'dry' | 'timeline';
  evidenceSha256: string;
  evidenceLines: number;
  verdict: ReturnType<typeof verdict>;
  ledger: LedgerRow[];
};

/** Which scenarios passed at least once, and which never did. */
export const proof = (scenarios: Record<string, ScenarioSummary>) => {
  const ids = Object.keys(scenarios).sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
  return { proved: ids.filter((id) => scenarios[id]!.outcomes.passed), notProved: ids.filter((id) => !scenarios[id]!.outcomes.passed) };
};

/**
 * Writes runs/<run>/summary.json and report.md: what a reader of the run needs, with no secret in it.
 * `stopped` says why a run didn't reach its end; `partial` that only some of its scenarios ran.
 */
export const exportRun = (o: { run: string; gateway: string; mode: 'dry' | 'timeline'; evidencePath: string; ledger: LedgerRow[]; outDir: string; suiteCommit?: string } & Pick<RunFacts, 'stopped' | 'partial'>) => {
  const raw = existsSync(o.evidencePath) ? readFileSync(o.evidencePath) : Buffer.from('');
  const evidence = readEvidence(o.evidencePath);
  const summed = summarise(evidence);
  const { proved, notProved } = proof(summed.scenarios);
  const summary: RunSummary = {
    schema: 'augur.run-summary/v1',
    run: o.run,
    gateway: o.gateway,
    suiteCommit: o.suiteCommit,
    mode: o.mode,
    evidenceSha256: createHash('sha256').update(raw).digest('hex'),
    evidenceLines: evidence.length,
    ...summed,
    verdict: verdict(o.ledger, { stopped: o.stopped, partial: o.partial, proved: proved.length, notProved: o.mode === 'dry' ? notProved : undefined }),
    ledger: o.ledger,
  };
  const dir = join(o.outDir, o.run);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(join(dir, 'report.md'), report(summary));
  return { dir, summary };
};

const cell = (s: unknown) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');

/** The run in words, for people: verdict first, then scenarios, the ledger and the busiest calls. */
export const report = (s: RunSummary) => {
  const lines = [
    `# Run ${s.run}`,
    '',
    `**${s.verdict.passed ? 'Passed' : 'Not passed'}.** ${s.verdict.reason}`,
    '',
    `- Deployment: ${s.gateway}`,
    `- ${s.mode === 'dry' ? 'Dry run: every scenario once' : 'Timeline run'}, ${s.from ?? '?'} to ${s.to ?? '?'}`,
    `- Releases seen: ${s.releases.map((r) => `${r.release} (from ${r.at})`).join(', ') || 'none reported'}`,
    `- Suite commit: ${s.suiteCommit ?? 'unknown'}`,
    `- Evidence: ${s.evidenceLines} lines, sha256 ${s.evidenceSha256}`,
    '',
    '## Scenarios',
    '',
    '| Scenario | Runs | Outcomes | Checks passed | Checks failed | Last reason |',
    '| --- | --- | --- | --- | --- | --- |',
    ...Object.entries(s.scenarios)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([id, x]) => `| ${id} | ${x.runs} | ${Object.entries(x.outcomes).map(([k, v]) => `${k} ${v}`).join(', ')} | ${x.checks.passed} | ${x.checks.failed} | ${cell(x.lastWhy)} |`),
    '',
    '## Ledger',
    '',
    ...(s.ledger.length
      ? ['| Row | First seen | Times | Scenario | What | Class | Why |', '| --- | --- | --- | --- | --- | --- | --- |', ...s.ledger.map((r) => `| ${r.id} | ${r.at} | ${r.times} | ${r.scenario ?? ''} | ${cell(r.what)} | ${r.class ? `${r.class}${r.kind ? ` (${r.kind})` : ''}` : `unclassified${r.suggested ? `, suggested ${r.suggested}` : ''}`} | ${cell(r.why)} |`)]
      : ['No anomalies.']),
    '',
    '## Calls',
    '',
    '| Call | Count | Statuses | p95 ms |',
    '| --- | --- | --- | --- |',
    ...Object.entries(s.calls)
      .sort(([, a], [, b]) => b.count - a.count)
      .slice(0, 40)
      .map(([k, c]) => `| ${cell(k)} | ${c.count} | ${Object.entries(c.statuses).map(([st, n]) => `${st}×${n}`).join(' ')} | ${c.p95ms} |`),
    '',
  ];
  return lines.join('\n');
};
