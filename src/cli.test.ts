import { describe, expect, it } from 'vitest';
import { addressesOf, parseArgs } from './cli.ts';

describe('the command line', () => {
  it('reads commands, flags and repeated flags', () => {
    expect(parseArgs(['run', '--url', 'https://a.test', '--dry', '--scenarios', 'x', '--scenarios', 'y'])).toEqual({ _: ['run'], flags: { url: ['https://a.test'], dry: ['true'], scenarios: ['x', 'y'] } });
  });

  it('finds the sign-in realm the way pnpm seed does', () => {
    expect(addressesOf('https://augur.example.ts.net/')).toEqual({ gateway: 'https://augur.example.ts.net', issuer: 'https://augur.example.ts.net/sso/realms/platform' });
    expect(addressesOf(undefined)).toEqual({ gateway: 'http://localhost:8080', issuer: 'http://localhost:8180/realms/platform' });
  });
});
