import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { castProblems, checkAllowed, isSynthetic, loadSeedLedger, marked, RunRefused } from './synthetic.ts';
import { cast, files, GATEWAY, seeded } from './test/fixtures.ts';

describe('what keeps a run synthetic', () => {
  it('refuses a cast whose mail could reach real people', () => {
    expect(castProblems(cast)).toEqual([]);
    expect(castProblems({ ...cast, synthetic: { ...cast.synthetic, emailDomain: 'example.com' } })[0]).toMatch(/could reach someone/);
    expect(castProblems({ ...cast, synthetic: { ...cast.synthetic, emailDomain: 'example.com', emailDomainDelivers: true } })).toEqual([]);
    expect(castProblems({ people: [] })[0]).toMatch(/synthetic/);
  });

  it('runs only where the deployment allows sample data, and says who can change that', () => {
    expect(() => checkAllowed({ seeding: { allowed: true } })).not.toThrow();
    expect(() => checkAllowed({ seeding: { allowed: false, why: 'Not here.', whoCanChange: 'A deployment admin.' } })).toThrow(/Not here\. A deployment admin\./);
    expect(() => checkAllowed({})).toThrow(RunRefused);
  });

  it('signs in only accounts the cast made', () => {
    expect(isSynthetic(cast, { username: 't-ann', email: 't-ann@test.augur.invalid' })).toBe(true);
    expect(isSynthetic(cast, { username: 't-ann', email: 'ann@example.com' })).toBe(false);
    expect(isSynthetic(cast, { username: 'ann', email: 't-ann@test.augur.invalid' })).toBe(false);
  });

  it('reads the seed ledger only for the deployment it was written for', () => {
    const { seedLedgerPath, dir } = files();
    expect(loadSeedLedger(seedLedgerPath, GATEWAY).people?.ann?.username).toBe('t-ann');
    expect(() => loadSeedLedger(seedLedgerPath, 'https://elsewhere.test')).toThrow(/not https:\/\/elsewhere/);
    writeFileSync(join(dir, 'other.json'), JSON.stringify({ ...seeded, schema: 'x' }));
    expect(() => loadSeedLedger(join(dir, 'other.json'), GATEWAY)).toThrow(/isn't a seed ledger/);
    expect(() => loadSeedLedger(join(dir, 'none.json'), GATEWAY)).toThrow(/pnpm seed/);
  });

  it('marks what the suite writes in the cast’s own words', () => {
    expect(marked(cast, 'A note. ')).toBe('A note.\n\nTest data.');
  });
});
