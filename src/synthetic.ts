// What makes a run synthetic, and keeps it off deployments where real people work. The cast is the seed's
// (im-platform scripts/seed/cast.json, ADR 0056), read from its file, never copied here. The seed's ledger
// says which sample people exist on this deployment, with their one-time passwords.
import { existsSync, readFileSync } from 'node:fs';

/** The seed's cast, as much of it as the suite reads. The seed's own check (`pnpm seed --check`) is the full one. */
export type Cast = {
  synthetic: { emailDomain: string; emailDomainDelivers?: boolean; usernamePrefix: string; note: string };
  floors?: CastFloor[];
  people?: CastPerson[];
  documents?: { floor: string; library?: string; items?: { title: string; filename: string; text: string }[] }[];
  entities?: { type: string; label: string; aliases?: string[]; description?: string; floor?: string }[];
};
export type CastFloor = { key: string; name: string; teams?: CastFloor[] };
export type CastPerson = { key: string; firstName: string; lastName: string; floors?: string[]; roles?: string[] };

/** The seed's ledger for one deployment (`.seed/<host>.json`, written by `pnpm seed`). */
export type SeedLedger = {
  schema: 'augur.seed-ledger/v1';
  gateway: string;
  floors?: Record<string, { id: string; name: string }>;
  people?: Record<string, { id: string; username: string; email: string; temporaryPassword?: string }>;
  documents?: Record<string, { id: string; library: string }>;
  entities?: Record<string, { id: string }>;
};

/** The floor every cast can name without making it: the organisation's own (as in the seed). */
export const ORG = 'org';

/** Thrown when the suite won't run, with the reason and who can change it. */
export class RunRefused extends Error {}

export const castProblems = (cast: unknown): string[] => {
  const c = cast as Partial<Cast> | null;
  if (!c || typeof c !== 'object') return ['The cast must be one JSON object, as `pnpm seed` reads it.'];
  const problems: string[] = [];
  const s = c.synthetic;
  if (!s) return ['The cast has no "synthetic" block, so its people and texts can’t be told apart from real ones.'];
  if (!s.emailDomain?.endsWith('.invalid') && !s.emailDomainDelivers) problems.push(`The cast's email domain ${s.emailDomain} isn't under .invalid, so mail to sample people could reach someone.`);
  if (!s.usernamePrefix) problems.push('The cast has no username prefix, so sample people can’t be told apart by their usernames.');
  if (!s.note?.trim()) problems.push('The cast has no note to mark sample texts with.');
  if (!c.people?.length) problems.push('The cast has no people, so the run has nobody to sign in.');
  return problems;
};

export const loadCast = (path: string): Cast => {
  if (!existsSync(path)) throw new RunRefused(`There is no cast at ${path}. Pass --cast with the seed's cast file (im-platform scripts/seed/cast.json).`);
  const cast = JSON.parse(readFileSync(path, 'utf8')) as Cast;
  const problems = castProblems(cast);
  if (problems.length) throw new RunRefused(`${path} can't be used for a run:\n  - ${problems.join('\n  - ')}`);
  return cast;
};

const sameDeployment = (a: string, b: string) => new URL(a).host === new URL(b).host;

export const loadSeedLedger = (path: string, gateway: string): SeedLedger => {
  if (!existsSync(path)) throw new RunRefused(`There is no seed ledger at ${path}. Run \`pnpm seed --url ${gateway}\` in im-platform first; it writes one.`);
  const ledger = JSON.parse(readFileSync(path, 'utf8')) as SeedLedger;
  if (ledger.schema !== 'augur.seed-ledger/v1') throw new RunRefused(`${path} isn't a seed ledger this suite reads (it says ${ledger.schema ?? 'nothing'}).`);
  if (!sameDeployment(ledger.gateway, gateway)) throw new RunRefused(`${path} is the seed ledger for ${ledger.gateway}, not ${gateway}.`);
  return ledger;
};

export const usernameOf = (cast: Cast, person: CastPerson) => `${cast.synthetic.usernamePrefix}${person.key}`;

/** True only for an account the cast made: the suite signs in nobody else. */
export const isSynthetic = (cast: Cast, account: { username?: string; email?: string }) =>
  !!account.username?.startsWith(cast.synthetic.usernamePrefix) && !!account.email?.endsWith(`@${cast.synthetic.emailDomain}`);

/** A text the suite writes, marked as sample data in the cast's own words, as the seed marks its texts. */
export const marked = (cast: Cast, words: string) => `${words.trim()}\n\n${cast.synthetic.note}`;

/** Every floor in the cast, top down, with its parent's key. */
export const floorsOf = (cast: Cast) => {
  const out: { key: string; name: string; parent?: string }[] = [];
  const walk = (list: CastFloor[] | undefined, parent?: string) => {
    for (const f of list ?? []) {
      out.push({ key: f.key, name: f.name, parent });
      walk(f.teams, f.key);
    }
  };
  walk(cast.floors);
  return out;
};

type Status = { seeding?: { allowed: boolean; why?: string; whoCanChange?: string } };

/**
 * The run's guard, the same as the seed's: it goes ahead only where the deployment says sample data is
 * allowed (`SEED_ALLOWED=true`, shown on the gateway's Status). Where it isn't, real people may work there.
 */
export const checkAllowed = (status: Status) => {
  const s = status.seeding;
  if (!s) throw new RunRefused('This AUGUR doesn’t say whether it allows sample data, so the run won’t touch it. Upgrade it first.');
  if (!s.allowed) throw new RunRefused(`${s.why ?? 'This deployment doesn’t allow sample data.'} ${s.whoCanChange ?? ''} The run uses sample people, so it goes only where seeding is allowed.`.trim());
};
