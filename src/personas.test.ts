import { describe, expect, it } from 'vitest';
import { castParts, habitsOf, personasFrom, rng } from './personas.ts';
import { cast, seeded } from './test/fixtures.ts';

describe('personas', () => {
  it('are the seeded cast, with floors, roles and habits; the unseeded are left out with a reason', () => {
    const { personas, missing } = personasFrom(cast, seeded);
    expect(personas.map((p) => p.key)).toEqual(['ann', 'bo', 'cy', 'di']);
    expect(personas[0]).toMatchObject({ username: 't-ann', name: 'Ann A', id: 'p-1', floors: [{ key: 'one', id: 'f-1', name: 'Floor One' }], habits: ['reads', 'writes', 'publishes'] });
    expect(missing).toEqual([{ key: 'ed', why: expect.stringMatching(/pnpm seed/) }]);
  });

  it('leave out someone the seed made from a different cast', () => {
    const other = { ...seeded, people: { ...seeded.people, ann: { ...seeded.people!.ann!, username: 'x-ann' } } };
    expect(personasFrom(cast, other).missing[0]).toMatchObject({ key: 'ann', why: expect.stringMatching(/different casts/) });
  });

  it('take habits from roles, and everyone reads', () => {
    expect(habitsOf([])).toEqual(['reads']);
    expect(habitsOf(['admin', 'unknown'])).toEqual(['reads', 'administers']);
  });

  it('are cast into parts by need, never twice where a part says so, and say which part nobody can play', () => {
    const { personas } = personasFrom(cast, seeded);
    const random = rng(1);
    for (let i = 0; i < 20; i++) {
      const { chosen, unfilled } = castParts(personas, [{ as: 'writer', habit: 'writes', floors: 'own' }, { as: 'other', habit: 'writes', notSameAs: ['writer'] }], random);
      expect(unfilled).toEqual([]);
      expect(chosen.writer!.key).not.toBe(chosen.other!.key);
    }
    expect(castParts(personas, [{ as: 'boss', role: 'deployment-admin' }], random).unfilled).toEqual([{ as: 'boss', role: 'deployment-admin' }]);
  });

  it('choose the same way again from the same seed', () => {
    const a = rng(42);
    const b = rng(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
