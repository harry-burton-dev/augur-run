// The run suite's command line (README, "Running it").
//   pnpm run-suite run --url <AUGUR> [--dry] [--hours 48] [--cast <file>] [--seed-ledger <file>] [--scenarios <module>]…
//   pnpm run-suite ledger <run folder>                                     lists the ledger's rows
//   pnpm run-suite ledger <run folder> classify <row> <class> --why <words> --by <name> [--kind <failure kind>]
//   pnpm run-suite token --url <AUGUR> --username <admin> --password-env <VAR> [--set-password]   prints an admin's access token
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { scenarios as platformScenarios } from '../scenarios/platform/index.ts';
import { browserApprover } from './browser.ts';
import { CLASS_MEANING, CLASSES, FAILURE_KINDS, LedgerError, openLedger } from './ledger.ts';
import { hostOf, reexport, startRun } from './run.ts';
import type { Scenario } from './scenario.ts';
import { openCredentials, signIn, type Approver } from './signin.ts';
import { checkAllowed, RunRefused } from './synthetic.ts';
import { readTraceability, writtenScenarios } from './traceability.ts';

type Args = { _: string[]; flags: Record<string, string[]> };

export const parseArgs = (argv: string[]): Args => {
  const out: Args = { _: [], flags: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) {
      out._.push(a);
      continue;
    }
    const name = a.slice(2);
    const value = argv[i + 1] !== undefined && !argv[i + 1]!.startsWith('--') ? argv[++i]! : 'true';
    (out.flags[name] ??= []).push(value);
  }
  return out;
};

const one = (a: Args, name: string) => a.flags[name]?.at(-1);
const need = (a: Args, name: string, what: string) => {
  const v = one(a, name);
  if (!v || v === 'true') throw new RunRefused(`--${name} is needed: ${what}.`);
  return v;
};

/** Where the gateway and its sign-in realm are, as `pnpm seed` works them out. */
export const addressesOf = (url: string | undefined, issuer?: string) =>
  url
    ? { gateway: url.replace(/\/$/, ''), issuer: issuer ?? `${url.replace(/\/$/, '')}/sso/realms/platform` }
    : { gateway: 'http://localhost:8080', issuer: issuer ?? 'http://localhost:8180/realms/platform' };

const commit = () => {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return undefined;
  }
};

/** An app's scenarios: a module exporting `scenarios`, such as an app repository's run/index.ts. Its shape is checked when the run starts. */
const loadScenarios = async (path: string): Promise<Scenario[]> => {
  const mod = (await import(pathToFileURL(resolve(path)).href)) as { scenarios?: Scenario[] };
  if (!Array.isArray(mod.scenarios)) throw new RunRefused(`${path} exports no \`scenarios\` list.`);
  return mod.scenarios;
};

/** AUGUR's checkout beside this one, whose seed and cast a run uses by default. */
const AUGUR_CHECKOUT = '../augur';

const run = async (a: Args) => {
  const { gateway, issuer } = addressesOf(one(a, 'url'), one(a, 'issuer'));
  const extra = (await Promise.all((a.flags.scenarios ?? []).map(loadScenarios))).flat();
  const only = one(a, 'only')?.split(',');
  const all = [...platformScenarios, ...extra].filter((s) => !only || only.includes(s.id));
  if (!all.length) throw new RunRefused('There are no scenarios to run.');
  const browser = browserApprover({ executablePath: one(a, 'chromium') ?? process.env.AUGUR_RUN_CHROMIUM });
  // Stopping the run (Ctrl-C) or a crash exports what it has, marked as a run that didn't reach its end.
  const stop = new AbortController();
  const signalled = (signal: string, code: number) => () => {
    stop.abort(`the operator stopped it (${signal}).`);
    process.exit(code);
  };
  const crashed = (err: unknown) => {
    stop.abort(`it crashed: ${err instanceof Error ? err.message : String(err)}`);
    console.error(`✗ ${err instanceof Error ? err.stack : String(err)}`);
    process.exit(1);
  };
  const handlers = [
    ['SIGINT', signalled('SIGINT', 130)],
    ['SIGTERM', signalled('SIGTERM', 143)],
    ['uncaughtException', crashed],
    ['unhandledRejection', crashed],
  ] as const;
  for (const [event, handler] of handlers) process.on(event, handler);
  try {
    const result = await startRun({
      gateway,
      issuer,
      castPath: resolve(one(a, 'cast') ?? `${AUGUR_CHECKOUT}/scripts/seed/cast.json`),
      seedLedgerPath: resolve(one(a, 'seed-ledger') ?? `${AUGUR_CHECKOUT}/.seed/${hostOf(gateway)}.json`),
      scenarios: all,
      approve: browser.approve,
      browse: browser.browse,
      mode: one(a, 'dry') ? 'dry' : 'timeline',
      hours: Number(one(a, 'hours') ?? 48),
      peakPerSecond: Number(one(a, 'peak') ?? 5),
      seed: one(a, 'seed') ? Number(one(a, 'seed')) : undefined,
      run: one(a, 'run'),
      outDir: one(a, 'out'),
      workDir: one(a, 'workdir'),
      suiteCommit: commit(),
      partial: only ? `only ${only.join(', ')}` : undefined,
      expected: writtenScenarios(readTraceability()),
      signal: stop.signal,
    });
    return result.summary.verdict.passed ? 0 : 1;
  } finally {
    for (const [event, handler] of handlers) process.off(event, handler);
    await browser.close();
  }
};

const ledger = (a: Args) => {
  const dir = a._[1];
  if (!dir) throw new RunRefused('Name the run’s working folder, such as .run/<host>/<run>.');
  const l = openLedger(join(dir, 'ledger.jsonl'));
  if (a._[2] === 'classify') {
    const [, , , id, cls] = a._;
    if (!id || !cls) throw new RunRefused(`Usage: ledger <run folder> classify <row> <class> --why <words> --by <name>. Classes:\n${CLASSES.map((c) => `  ${c}: ${CLASS_MEANING[c]}`).join('\n')}\nFailure kinds: ${FAILURE_KINDS.join(', ')}.`);
    const row = l.classify(id, cls, one(a, 'why') ?? '', one(a, 'by') ?? '', one(a, 'kind'));
    console.log(`${row.id} is now ${row.class}.`);
    const { summary, dir: out } = reexport(dir);
    console.log(`${summary.verdict.reason} Summary in ${out}.`);
    return 0;
  }
  for (const r of l.rows()) console.log(`${r.id}  ${r.class ?? `unclassified${r.suggested ? ` (suggested ${r.suggested})` : ''}`}  ×${r.times}  ${r.what}`);
  return 0;
};

/**
 * Signs an admin of a sample deployment in and prints their access token, for a script such as the dry run
 * that hands it to `pnpm seed`. It goes only where sample data is allowed, as the run does: Status says so,
 * and only an admin can read it, so the check comes after the sign-in. When the sign-in page asks for a
 * new password (a one-time password), it sets one only with --set-password, and keeps it where the run
 * keeps its own, `<workdir>/<host>/credentials.json`, saying so: it is never chosen and then thrown away.
 */
export const tokenCommand = async (
  a: Args,
  deps: { approve?: Approver; fetchImpl?: typeof fetch; wait?: (ms: number) => Promise<void>; out?: (s: string) => void; err?: (s: string) => void } = {},
) => {
  const { gateway, issuer } = addressesOf(one(a, 'url'), one(a, 'issuer'));
  const username = need(a, 'username', 'who to sign in');
  const password = process.env[need(a, 'password-env', 'the environment variable that holds their password')];
  if (!password) throw new RunRefused('That environment variable is empty.');
  const out = deps.out ?? ((s: string) => void process.stdout.write(s));
  const err = deps.err ?? ((s: string) => void process.stderr.write(s));
  const fetchImpl = deps.fetchImpl ?? fetch;
  const path = join(one(a, 'workdir') ?? '.run', hostOf(gateway), 'credentials.json');
  const credentials = openCredentials(path);
  const browser = deps.approve ? undefined : browserApprover({ executablePath: one(a, 'chromium') ?? process.env.AUGUR_RUN_CHROMIUM });
  const known = credentials.candidates(username, password);
  try {
    const t = await signIn({ issuer, username, credentials, temporaryPassword: password, approve: deps.approve ?? browser!.approve, fetchImpl, wait: deps.wait, allowNewPassword: one(a, 'set-password') === 'true' });
    const worked = credentials.candidates(username)[0];
    if (worked && !known.includes(worked)) err(`${username} chose a new password at this sign-in; it is kept in ${path}.\n`);
    // The guard: only where the deployment says sample data is allowed (the gateway's Status).
    const status = await fetchImpl(`${gateway}/api/gateway/v1/status`, { headers: { authorization: `Bearer ${t.access_token}`, accept: 'application/json' } });
    if (!status.ok) throw new RunRefused(`The gateway's Status answered ${status.status} to ${username}, so it can't be checked that sample data is allowed here.`);
    checkAllowed((await status.json()) as Parameters<typeof checkAllowed>[0]);
    out(`${t.access_token}\n`);
    return 0;
  } finally {
    await browser?.close();
  }
};

const token = (a: Args) => tokenCommand(a);

export const main = async (argv: string[]) => {
  const a = parseArgs(argv);
  const commands: Record<string, (a: Args) => number | Promise<number>> = { run, ledger, token };
  const command = commands[a._[0] ?? ''];
  if (!command) {
    console.log('Usage: pnpm run-suite run | ledger | token (see README, "Running it").');
    return a._[0] ? 2 : 0;
  }
  return command(a);
};

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (err) => {
      console.error(`✗ ${err instanceof RunRefused || err instanceof LedgerError ? err.message : (err as Error).stack}`);
      process.exit(1);
    },
  );
}
