// Personas: the seed's sample people, as the run uses them. Who someone is (name, floors, roles) comes
// from the cast and the seed's ledger; what they tend to do comes from their roles, so a deployment that
// seeds its own cast gets personas that fit it without a change here.
import { floorsOf, ORG, usernameOf, type Cast, type SeedLedger } from './synthetic.ts';

/** What a persona does in the run, from their roles. Everyone reads. */
export type Habit = 'reads' | 'writes' | 'publishes' | 'administers';

export type Persona = {
  key: string;
  username: string;
  name: string;
  /** The person's id in AUGUR, from the seed's ledger. */
  id: string;
  email: string;
  /** Cast floor keys, and their AUGUR ids where the seed made them. */
  floors: { key: string; id?: string; name: string }[];
  roles: string[];
  habits: Habit[];
  /** The one-time password the seed was given, until the persona's first sign-in replaces it. */
  temporaryPassword?: string;
};

const HABIT_OF_ROLE: Record<string, Habit> = { editor: 'writes', publisher: 'publishes', admin: 'administers' };

export const habitsOf = (roles: string[]): Habit[] => ['reads', ...new Set(roles.map((r) => HABIT_OF_ROLE[r]).filter((h): h is Habit => !!h))];

/** Every cast person the seed made on this deployment; the rest are listed with the reason they're left out. */
export const personasFrom = (cast: Cast, seeded: SeedLedger) => {
  const floors = floorsOf(cast);
  const personas: Persona[] = [];
  const missing: { key: string; why: string }[] = [];
  for (const p of cast.people ?? []) {
    const made = seeded.people?.[p.key];
    if (!made) {
      missing.push({ key: p.key, why: 'the seed’s ledger has no such person on this deployment; run `pnpm seed` again.' });
      continue;
    }
    if (made.username !== usernameOf(cast, p)) {
      missing.push({ key: p.key, why: `the seed made ${made.username}, but the cast names ${usernameOf(cast, p)}: they're from different casts.` });
      continue;
    }
    personas.push({
      key: p.key,
      username: made.username,
      name: `${p.firstName} ${p.lastName}`,
      id: made.id,
      email: made.email,
      floors: (p.floors ?? []).map((key) => ({ key, id: seeded.floors?.[key]?.id, name: floors.find((f) => f.key === key)?.name ?? key })),
      roles: p.roles ?? [],
      habits: habitsOf(p.roles ?? []),
      temporaryPassword: made.temporaryPassword,
    });
  }
  return { personas, missing };
};

/** What a scenario asks of the person who plays a part in it. */
export type Need = {
  /** A name for the part, such as "admin" or "reader", used in evidence. */
  as: string;
  habit?: Habit;
  role?: string;
  /** `own`: on at least one cast floor. `none`: on no floor but the organisation's. */
  floors?: 'own' | 'none';
  /** Must not be the same person as these other parts. */
  notSameAs?: string[];
};

/** A small seeded random generator (mulberry32), so a run's choices can be replayed from its seed. */
export const rng = (seed: number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const fits = (p: Persona, need: Need) =>
  (!need.habit || p.habits.includes(need.habit)) &&
  (!need.role || p.roles.includes(need.role)) &&
  (need.floors !== 'own' || p.floors.some((f) => f.key !== ORG && f.id)) &&
  (need.floors !== 'none' || p.floors.length === 0);

/**
 * Casts each part of a scenario: a persona for every need, chosen at random among those who fit. Returns
 * the parts that nobody in the cast can play, so the scenario says so instead of failing.
 */
export const castParts = (personas: Persona[], needs: Need[], random: () => number) => {
  const chosen: Record<string, Persona> = {};
  const unfilled: Need[] = [];
  for (const need of needs) {
    const taken = new Set((need.notSameAs ?? []).map((as) => chosen[as]?.key));
    const options = personas.filter((p) => fits(p, need) && !taken.has(p.key));
    const pick = options[Math.floor(random() * options.length)];
    if (pick) chosen[need.as] = pick;
    else unfilled.push(need);
  }
  return { chosen, unfilled };
};

export const describeNeed = (n: Need) =>
  [n.role ? `the ${n.role} role` : n.habit ? `someone who ${n.habit}` : 'anyone', n.floors === 'own' ? 'on a floor of their own' : n.floors === 'none' ? 'on no team floor' : '', n.notSameAs?.length ? `other than the ${n.notSameAs.join(' and ')}` : '']
    .filter(Boolean)
    .join(' ');
