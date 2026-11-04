// A scenario is one thing a person does with AUGUR, written from a user journey (Given, When, Then), with
// the checks that say it worked. Each has a RUN-nn id and a row in traceability.md. Platform scenarios
// live in scenarios/platform/; an app's live in its own repository's run/ module, in this same shape.
import type { Page } from 'playwright';
import type { Api } from './api.ts';
import type { Browsing } from './browser.ts';
import type { Outcome, Recorder } from './evidence.ts';
import type { Ledger, LedgerClass } from './ledger.ts';
import { castParts, describeNeed, type Need, type Persona } from './personas.ts';
import type { Cast, SeedLedger } from './synthetic.ts';

/** When a scenario happens in the 48 hours. */
export type Cadence =
  /** Once, this many minutes after the run starts. */
  | { kind: 'once'; afterMinutes?: number }
  /** Again and again: every `minutes` in the working day, every `quietMinutes` outside it (never, if unset). */
  | { kind: 'every'; minutes: number; quietMinutes?: number }
  /** Every day at a UTC time, such as the 02:00 backup, checked `graceMinutes` after it is due. */
  | { kind: 'daily'; atUtc: string; graceMinutes?: number };

/** Whether this deployment can do what the scenario needs. A "no" is not a failure: it says why. */
export type Availability = { ok: true } | { ok: false; why: string; whoCanChange?: string; issue?: string };

export type Part = { persona: Persona; api: Api };

export type ScenarioContext = {
  scenario: Scenario;
  /** The personas playing each part the scenario named in `needs`, each with their own API client. */
  parts: Record<string, Part>;
  personas: Persona[];
  /** An API client for any persona, for a scenario that goes through the whole cast. */
  as: (persona: Persona) => Api;
  cast: Cast;
  seeded: SeedLedger;
  /**
   * Asks `probe` again every `everyMs` until it says yes or `withinMs` runs out, for something AUGUR
   * promises within a time, such as access gone within 5 minutes. Returns the last answer and how long it took.
   */
  eventually: <T>(probe: () => Promise<{ ok: boolean; value: T }>, o: { withinMs: number; everyMs?: number }) => Promise<{ ok: boolean; value: T; ms: number }>;
  /** Records a check. A failed check raises a ledger row (one per check, however often it fails). */
  check: (label: string, ok: boolean, detail?: { expected?: unknown; actual?: unknown; suggested?: LedgerClass }) => boolean;
  note: (text: string, data?: unknown) => void;
  random: () => number;
  now: () => Date;
  /** What the scenario keeps from one of its runs to the next, such as ids it made. Saved with the run. */
  state: Record<string, unknown>;
  /** The dry run does every scenario once and doesn't wait: a scenario can shorten its waits. */
  dry: boolean;
  sleep: (ms: number) => Promise<void>;
  /**
   * A browser page signed in to AUGUR as the persona, for what a person sees rather than what the API
   * answers. Closed when the scenario ends.
   */
  browse: (persona: Persona) => Promise<Page>;
  /** Whether this run has a browser for `browse`. */
  canBrowse: boolean;
};

export type Scenario = {
  /** `RUN-` and two or more digits; the id traceability.md uses. */
  id: string;
  title: string;
  /** `platform`, or the app id whose repository owns it. */
  owner: string;
  /** The alpha spec's goal numbers this scenario helps prove. */
  goals: number[];
  cuj?: number;
  given: string;
  when: string;
  then: string;
  cadence: Cadence;
  needs: Need[];
  /** What a failed check suggests for the ledger; a person decides. `failure` unless set. */
  suggests?: LedgerClass;
  available?: (ctx: ScenarioContext) => Promise<Availability>;
  run: (ctx: ScenarioContext) => Promise<void>;
};

export const ID = /^RUN-\d{2,}$/;

export const scenarioProblems = (list: Scenario[]): string[] => {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const s of list) {
    if (!ID.test(s.id)) problems.push(`"${s.id}" isn't a scenario id: use RUN- and two or more digits.`);
    if (seen.has(s.id)) problems.push(`${s.id} is used by two scenarios.`);
    seen.add(s.id);
    if (!s.goals.length) problems.push(`${s.id} names no goal it proves.`);
    if (!s.needs.length) problems.push(`${s.id} names no persona: every scenario is something a person does.`);
    const parts = new Set(s.needs.map((n) => n.as));
    if (parts.size !== s.needs.length) problems.push(`${s.id} names a part twice.`);
  }
  return problems;
};

/** A scenario that waits on work not yet in AUGUR: written now, so the work is built toward its checks. */
export const notYet = (why: string, issue?: string, whoCanChange?: string) => async (): Promise<Availability> => ({ ok: false, why, issue, whoCanChange });

export type RunDeps = {
  personas: Persona[];
  cast: Cast;
  seeded: SeedLedger;
  evidence: Recorder;
  ledger: Ledger;
  apiFor: (persona: Persona, scenario: string) => Api;
  release: () => string | undefined;
  random: () => number;
  now: () => Date;
  state: (scenario: string) => Record<string, unknown>;
  saveState: () => void;
  dry: boolean;
  sleep: (ms: number) => Promise<void>;
  /** Signs a persona in to AUGUR in a browser. A run without a browser leaves it out. */
  browse?: (persona: Persona) => Promise<Browsing>;
};

/** Runs one scenario once: casts its parts, asks whether it's available, runs it, and records how it ended. */
export const runScenario = async (scenario: Scenario, deps: RunDeps): Promise<{ outcome: Outcome; why?: string }> => {
  const started = performance.now();
  const done = (outcome: Outcome, why?: string, personas?: string[]) => {
    deps.evidence.scenario({ scenario: scenario.id, outcome, ms: Math.round(performance.now() - started), why, personas });
    deps.saveState();
    return { outcome, why };
  };
  const { chosen, unfilled } = castParts(deps.personas, scenario.needs, deps.random);
  if (unfilled.length) return done('no-persona', `Nobody in the cast can play ${unfilled.map((n) => `the ${n.as} (${describeNeed(n)})`).join(' or ')}. Add one to the seed's cast.`);
  const parts = Object.fromEntries(Object.entries(chosen).map(([as, persona]) => [as, { persona, api: deps.apiFor(persona, scenario.id) }]));
  const who = Object.values(chosen).map((p) => p.key);
  let failed = false;
  const open: Browsing[] = [];
  const ctx: ScenarioContext = {
    scenario,
    parts,
    personas: deps.personas,
    as: (p) => deps.apiFor(p, scenario.id),
    eventually: async (probe, { withinMs, everyMs = 15_000 }) => {
      const from = deps.now().getTime();
      for (;;) {
        const r = await probe();
        const ms = deps.now().getTime() - from;
        if (r.ok || ms + everyMs > withinMs) return { ...r, ms };
        await deps.sleep(everyMs);
      }
    },
    cast: deps.cast,
    seeded: deps.seeded,
    random: deps.random,
    now: deps.now,
    state: deps.state(scenario.id),
    dry: deps.dry,
    sleep: deps.sleep,
    canBrowse: !!deps.browse,
    browse: async (p) => {
      if (!deps.browse) throw new Error('This run has no browser, so nothing can be looked at as a person sees it.');
      const b = await deps.browse(p);
      open.push(b);
      return b.page;
    },
    note: (text, data) => void deps.evidence.note({ scenario: scenario.id, text, data }),
    check: (label, ok, detail = {}) => {
      const e = deps.evidence.check({ scenario: scenario.id, check: label, ok, expected: detail.expected, actual: detail.actual, persona: who.join(',') });
      if (!ok) {
        failed = true;
        deps.ledger.raise({ key: `${scenario.id}: ${label}`, what: `${scenario.title}: ${label}.`, scenario: scenario.id, release: deps.release(), suggested: detail.suggested ?? scenario.suggests ?? 'failure', evidence: [e.id] });
      }
      return ok;
    },
  };
  try {
    const can = scenario.available ? await scenario.available(ctx) : { ok: true as const };
    if (!can.ok) return done('not-available', [can.why, can.issue && `(${can.issue})`, can.whoCanChange].filter(Boolean).join(' '), who);
    await scenario.run(ctx);
    return done(failed ? 'failed' : 'passed', undefined, who);
  } catch (err) {
    const message = (err as Error).message;
    deps.ledger.raise({ key: `${scenario.id}: stopped`, what: `${scenario.title} stopped part way: ${message}`, scenario: scenario.id, release: deps.release(), suggested: scenario.suggests ?? 'failure' });
    return done('error', message, who);
  } finally {
    await Promise.all(open.map((b) => b.close().catch(() => {})));
  }
};
