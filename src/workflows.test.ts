// Every third-party Action is pinned to a commit, as augur's are: a moved tag must not run in a job here.
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const dir = new URL('../.github/workflows/', import.meta.url);

describe('the workflows', () => {
  it('pin every Action they use to a full commit, with the version beside it', () => {
    const loose = readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .flatMap((f) => [...readFileSync(new URL(f, dir), 'utf8').matchAll(/uses:\s*(\S+)(.*)$/gm)].map((m) => ({ f, uses: m[1]!, rest: m[2]! })))
      // AUGUR's own Review workflow follows AUGUR's main, so every repository checks with the same rules.
      .filter((u) => !u.uses.startsWith('./') && u.uses !== 'harry-burton-dev/augur/.github/workflows/review.yml@main')
      .filter((u) => !(/@[0-9a-f]{40}$/.test(u.uses) && (/#\s*v\d/.test(u.rest) || u.uses.startsWith('harry-burton-dev/'))))
      .map((u) => `${u.f}: ${u.uses}`);
    expect(loose).toEqual([]);
  });
});
