// Signing personas in, as a person would: the OAuth 2.0 device grant (RFC 8628) on the realm's
// `platform-cli` client, the same way `pnpm seed` signs its admin in (ADR 0056), with the code approved on
// the real sign-in page by a browser (browser.ts). A persona's first sign-in chooses a new password, as
// every new person does. Passwords live only in the run's working folder, readable by the operator only.
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { RunRefused } from './synthetic.ts';

export type Tokens = { access_token: string; refresh_token?: string; expires_in?: number };

/** Approves a device code on the sign-in page as this person. Says which password worked. */
export type Approver = (o: {
  url: string;
  userCode: string;
  username: string;
  passwords: string[];
  newPassword: string;
  granted?: () => boolean;
  /** `false` stops the walk when the page asks for a new password, rather than set one nobody else knows. */
  allowNewPassword?: boolean;
}) => Promise<{ usedPassword: string }>;

export type Fetch = typeof fetch;

/** The passwords the run knows for each persona: the one that works, and one being set right now. */
export type Credentials = ReturnType<typeof openCredentials>;

/**
 * The run's password store, `.run/<host>/credentials.json`, mode 0600. A new password is written before
 * it is typed into the page, so a run that stops half way through a password change can still sign in.
 */
export const openCredentials = (path: string) => {
  const data: Record<string, { password?: string; next?: string }> = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
  const save = () => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    chmodSync(path, 0o600);
  };
  return {
    /** The passwords to try, best first: the last one that worked, one being set, the seed's one-time one. */
    candidates: (username: string, temporary?: string) => {
      const d = data[username] ?? {};
      return [...new Set([d.password, d.next, temporary].filter((p): p is string => !!p))];
    },
    /** A new password for the first sign-in, kept before it is used. */
    propose: (username: string) => {
      const next = `${randomBytes(12).toString('base64url')}-Aa1`;
      data[username] = { ...data[username], next };
      save();
      return next;
    },
    worked: (username: string, password: string) => {
      data[username] = { password };
      save();
    },
  };
};

const form = (fields: Record<string, string>) => ({
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(fields),
});

/**
 * One persona's sign-in: starts a device code, has the approver confirm it on the sign-in page, and polls
 * the token endpoint until the code is granted.
 */
export const signIn = async (o: {
  issuer: string;
  clientId?: string;
  username: string;
  credentials: Credentials;
  temporaryPassword?: string;
  approve: Approver;
  fetchImpl?: Fetch;
  wait?: (ms: number) => Promise<void>;
  /** Whether the walk may choose a new password when the page asks for one (the run's personas: yes). */
  allowNewPassword?: boolean;
}): Promise<Tokens> => {
  const { issuer, clientId = 'platform-cli', username, credentials, approve, fetchImpl = fetch, wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = o;
  const base = `${issuer.replace(/\/$/, '')}/protocol/openid-connect`;
  const passwords = credentials.candidates(username, o.temporaryPassword);
  if (!passwords.length) throw new RunRefused(`The run knows no password for ${username}: the seed's ledger has no one-time password for them, and the run hasn't signed them in before.`);
  const start = await fetchImpl(`${base}/auth/device`, form({ client_id: clientId, scope: 'openid' }));
  if (!start.ok) throw new RunRefused(`The sign-in service won't sign anyone in from a script (${start.status}). Its realm needs the ${clientId} client (augur docs/upgrade.md, "Sample data, where you allow it").`);
  const code = (await start.json()) as { device_code: string; user_code: string; verification_uri: string; verification_uri_complete?: string; interval?: number; expires_in?: number };
  const newPassword = credentials.propose(username);
  // The page is walked while the token endpoint is asked, so the walk stops as soon as the code is granted,
  // whatever the last page looks like.
  let granted = false;
  let approval: { usedPassword: string } | Error | undefined;
  const approving = approve({ url: code.verification_uri_complete ?? code.verification_uri, userCode: code.user_code, username, passwords, newPassword, granted: () => granted, allowNewPassword: o.allowNewPassword }).then(
    (r) => void (approval = r),
    (err: unknown) => void (approval = err instanceof Error ? err : new Error(String(err))),
  );
  let interval = (code.interval ?? 5) * 1000;
  const until = Date.now() + (code.expires_in ?? 300) * 1000;
  let pollsSinceFailure = 0;
  for (let first = true; Date.now() < until; first = false) {
    if (!first) await wait(interval);
    // A walk that failed gets two more polls, in case the code was granted before the page went wrong.
    if (approval instanceof Error && pollsSinceFailure++ >= 2) throw approval;
    const res = await fetchImpl(`${base}/token`, form({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', device_code: code.device_code, client_id: clientId }));
    const body = (await res.json().catch(() => ({}))) as Tokens & { error?: string };
    if (res.ok) {
      granted = true;
      await approving;
      // The password that worked is kept; after a walk that went wrong, the one being set stays a candidate.
      if (approval && !(approval instanceof Error)) credentials.worked(username, approval.usedPassword);
      return body;
    }
    if (body.error === 'authorization_pending') continue;
    if (body.error === 'slow_down') {
      interval += 5000;
      continue;
    }
    await approving;
    throw approval instanceof Error ? approval : new RunRefused(`${username}'s sign-in failed (${body.error ?? res.status}).`);
  }
  throw new RunRefused(`${username}'s sign-in code ran out before it was granted.`);
};

/** A fresh access token on each call, refreshed a little before it runs out; signs in again if that fails. */
export const tokenKeeper = (o: { issuer: string; clientId?: string; first: Tokens; again: () => Promise<Tokens>; fetchImpl?: Fetch; now?: () => number }) => {
  const { issuer, clientId = 'platform-cli', again, fetchImpl = fetch, now = Date.now } = o;
  let current = o.first;
  let expires = now() + (current.expires_in ?? 60) * 1000;
  const keep = (t: Tokens) => {
    current = t;
    expires = now() + (t.expires_in ?? 60) * 1000;
  };
  return async () => {
    if (now() > expires - 30_000) {
      const res = current.refresh_token
        ? await fetchImpl(`${issuer.replace(/\/$/, '')}/protocol/openid-connect/token`, form({ grant_type: 'refresh_token', refresh_token: current.refresh_token, client_id: clientId }))
        : undefined;
      if (res?.ok) keep((await res.json()) as Tokens);
      else keep(await again());
    }
    return current.access_token;
  };
};
