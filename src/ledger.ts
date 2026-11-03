// The run ledger (ADR 0050): one row per anomaly, each with a class. The run passes only when no row is a
// failure and none is left unclassified. The file is append-only JSON lines, so a run that stops half way
// loses nothing: a row is written when it is seen, and classifying it appends a second line.
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

/** The classes a row can have. Every class but `failure` is allowed in a passing run. */
export const CLASSES = ['no-action', 'documented-setting', 'patch', 'docs-gap', 'failure'] as const;
export type LedgerClass = (typeof CLASSES)[number];

/** What a failure is (ADR 0050): each one fails the run. */
export const FAILURE_KINDS = ['contract-change', 'undocumented-server-step', 'data-loss', 'missed-alert'] as const;
export type FailureKind = (typeof FAILURE_KINDS)[number];

export const CLASS_MEANING: Record<LedgerClass, string> = {
  'no-action': 'Seen and explained; nothing needs to change.',
  'documented-setting': 'Fixed by a setting the guides already describe.',
  patch: 'Fixed by a platform patch that changes no contract. The bake restarts for the patched release.',
  'docs-gap': 'The guides missed a step or a fact; they are corrected.',
  failure: 'A contract change, an undocumented server step, data loss or a missed alert. The run fails.',
};

export type LedgerRow = {
  id: string;
  /** When it was first seen, as an ISO time. */
  at: string;
  /** When it was last seen, for an anomaly that repeats; one row per incident, not per sighting. */
  lastSeen: string;
  times: number;
  /** The AUGUR release that was running, as the gateway reports it. */
  release?: string;
  scenario?: string;
  /** What happened, in a sentence a person can act on. */
  what: string;
  /** The class someone gave it; unset until then. */
  class?: LedgerClass;
  kind?: FailureKind;
  why?: string;
  by?: string;
  /** The class the suite suggests for a row it raised itself. Only a person classifies. */
  suggested?: LedgerClass;
  /** Evidence ids (see evidence.ts) that show it. */
  evidence: string[];
  /** Rows raised by a scenario's check are matched on this, so a repeat updates the same row. */
  key?: string;
};

type Line =
  | { op: 'raise'; row: Omit<LedgerRow, 'lastSeen' | 'times'> }
  | { op: 'seen'; id: string; at: string; evidence?: string }
  | { op: 'classify'; id: string; class: LedgerClass; kind?: FailureKind; why: string; by: string; at: string };

export class LedgerError extends Error {}

export type Ledger = ReturnType<typeof openLedger>;

/** Opens (or starts) the ledger at `path`. `now` is the clock, so tests can fake it. */
export const openLedger = (path: string, now: () => Date = () => new Date()) => {
  const lines: Line[] = existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter((l) => l.trim())
        .map((l) => JSON.parse(l) as Line)
    : [];
  const write = (line: Line) => {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(line)}\n`);
    lines.push(line);
  };

  const rows = (): LedgerRow[] => {
    const byId = new Map<string, LedgerRow>();
    for (const line of lines) {
      if (line.op === 'raise') byId.set(line.row.id, { ...line.row, lastSeen: line.row.at, times: 1, evidence: [...line.row.evidence] });
      const row = line.op === 'raise' ? undefined : byId.get(line.id);
      if (!row) continue;
      if (line.op === 'seen') {
        row.lastSeen = line.at;
        row.times += 1;
        if (line.evidence && !row.evidence.includes(line.evidence)) row.evidence.push(line.evidence);
      } else if (line.op === 'classify') {
        Object.assign(row, { class: line.class, kind: line.kind, why: line.why, by: line.by });
      }
    }
    return [...byId.values()];
  };

  const nextId = () => `L-${String(rows().length + 1).padStart(3, '0')}`;

  return {
    path,
    rows,
    /**
     * Raises an anomaly. With a `key`, a row that is still open for the same key is seen again instead,
     * so a check that fails every few minutes is one incident, not hundreds of rows.
     */
    raise(row: { what: string; scenario?: string; release?: string; suggested?: LedgerClass; evidence?: string[]; key?: string }): LedgerRow {
      const at = now().toISOString();
      if (row.key) {
        const open = rows().find((r) => r.key === row.key && r.class === undefined);
        if (open) {
          write({ op: 'seen', id: open.id, at, evidence: row.evidence?.[0] });
          return rows().find((r) => r.id === open.id)!;
        }
      }
      const id = nextId();
      write({ op: 'raise', row: { id, at, what: row.what, scenario: row.scenario, release: row.release, suggested: row.suggested, key: row.key, evidence: row.evidence ?? [] } });
      return rows().find((r) => r.id === id)!;
    },
    /** A person's judgement of a row. A failure needs its kind; every class needs a reason. */
    classify(id: string, cls: string, why: string, by: string, kind?: string): LedgerRow {
      const row = rows().find((r) => r.id === id);
      if (!row) throw new LedgerError(`There is no row ${id} in ${path}.`);
      if (!(CLASSES as readonly string[]).includes(cls)) throw new LedgerError(`"${cls}" isn't a class. Use one of: ${CLASSES.join(', ')}.`);
      if (cls === 'failure' && !(FAILURE_KINDS as readonly string[]).includes(kind ?? '')) {
        throw new LedgerError(`A failure needs its kind: one of ${FAILURE_KINDS.join(', ')}.`);
      }
      if (!why.trim()) throw new LedgerError('Say why, in a sentence: the ledger is the run’s record.');
      if (!by.trim()) throw new LedgerError('Say who classified it.');
      write({ op: 'classify', id, class: cls as LedgerClass, kind: cls === 'failure' ? (kind as FailureKind) : undefined, why: why.trim(), by: by.trim(), at: now().toISOString() });
      return rows().find((r) => r.id === id)!;
    },
  };
};

export type Verdict = { passed: boolean; failures: LedgerRow[]; unclassified: LedgerRow[]; allowed: LedgerRow[]; reason: string };

/** Whether the ledger lets the run pass: no failure, and nothing left for a person to classify. */
export const verdict = (rows: LedgerRow[]): Verdict => {
  const failures = rows.filter((r) => r.class === 'failure');
  const unclassified = rows.filter((r) => r.class === undefined);
  const allowed = rows.filter((r) => r.class !== undefined && r.class !== 'failure');
  const reason = failures.length
    ? `${failures.length} failure${failures.length > 1 ? 's' : ''} in the ledger (${failures.map((r) => r.id).join(', ')}): the run fails, and a new release needs a fresh run on a wiped server.`
    : unclassified.length
      ? `${unclassified.length} row${unclassified.length > 1 ? 's' : ''} still need a class (${unclassified.map((r) => r.id).join(', ')}).`
      : `No failure in the ledger${allowed.length ? `; ${allowed.length} allowed row${allowed.length > 1 ? 's' : ''}` : ''}.`;
  return { passed: !failures.length && !unclassified.length, failures, unclassified, allowed, reason };
};
