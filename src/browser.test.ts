// The sign-in walk against a stand-in for the sign-in pages, in a real headless browser. It runs where a
// browser is installed (the dry run's job, or AUGUR_RUN_CHROMIUM locally) and is skipped elsewhere.
import { existsSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { browserApprover } from './browser.ts';

const executablePath = process.env.AUGUR_RUN_CHROMIUM;
const hasBrowser = executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath());

const page = (body: string) => `<!doctype html><html><body>${body}</body></html>`;
const login = (error = '') =>
  page(`${error && `<span id="input-error">${error}</span>`}<form method="post" action="/login"><input id="username" name="username"><input id="password" name="password" type="password"><input id="kc-login" type="submit" value="Sign in"></form>`);
const newPassword = page('<form method="post" action="/update"><input id="password-new" name="password-new" type="password"><input id="password-confirm" name="password-confirm" type="password"><input type="submit" value="Submit"></form>');
const grant = page('<form method="post" action="/grant"><input type="submit" name="accept" value="Yes"><input type="submit" name="cancel" value="No"></form>');
const done = page('<h1>Device Login Successful</h1>');

describe.skipIf(!hasBrowser)('approving a code on the sign-in page', () => {
  let server: Server;
  let base = '';
  let chosen = '';
  const seen: string[] = [];
  beforeAll(async () => {
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const form = new URLSearchParams(raw);
        if (req.url !== '/favicon.ico') seen.push(`${req.method} ${req.url?.split('?')[0]}`);
        res.setHeader('content-type', 'text/html');
        if (req.url?.startsWith('/device')) return res.end(login());
        if (req.url === '/login') {
          const pw = form.get('password');
          if (pw === 'temp') return res.end(newPassword);
          if (pw && pw === chosen) return res.end(grant);
          return res.end(login('Invalid username or password.'));
        }
        if (req.url === '/update') {
          chosen = form.get('password-new') ?? '';
          return res.end(form.get('password-new') === form.get('password-confirm') ? grant : newPassword);
        }
        if (req.url === '/grant') return res.end(form.has('accept') ? done : login());
        res.statusCode = 404;
        res.end('');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('signs in with the one-time password, sets the new one and grants, then signs in with the new one', async () => {
    const browser = browserApprover({ executablePath });
    try {
      const first = await browser.approve({ url: `${base}/device?user_code=X`, userCode: 'X', username: 't-ann', passwords: ['wrong', 'temp'], newPassword: 'N3w-pass' });
      expect(first).toEqual({ usedPassword: 'N3w-pass' });
      expect(seen).toEqual(['GET /device', 'POST /login', 'POST /login', 'POST /update', 'POST /grant']);
      const second = await browser.approve({ url: `${base}/device?user_code=Y`, userCode: 'Y', username: 't-ann', passwords: ['N3w-pass'], newPassword: 'unused' });
      expect(second).toEqual({ usedPassword: 'N3w-pass' });
      await expect(browser.approve({ url: `${base}/device?user_code=Z`, userCode: 'Z', username: 't-ann', passwords: ['nope'], newPassword: 'x' })).rejects.toThrow(/None of the passwords.*Invalid username or password/);
    } finally {
      await browser.close();
    }
  }, 30_000);
});

describe.skipIf(!hasBrowser)('opening AUGUR in a browser as a persona', () => {
  let server: Server;
  let base = '';
  const AUTH = '/sso/realms/platform/protocol/openid-connect/auth';
  const ACTION = '/sso/realms/platform/login-actions/authenticate';
  const signInForm = (error = '') => login(error).replace('action="/login"', `action="${ACTION}"`);
  beforeAll(async () => {
    // A shell that sends anyone without a session to the sign-in page from its script, as AUGUR's does.
    server = createServer((req, res) => {
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        res.setHeader('content-type', 'text/html');
        const signedIn = req.headers.cookie?.includes('session=ok');
        if (req.url === '/') return res.end(signedIn ? page('<div id="shell">AUGUR</div>') : page(`<script>setTimeout(() => location.assign('${AUTH}?client_id=platform-web'), 50)</script>`));
        if (req.url?.startsWith(AUTH)) return res.end(signInForm());
        if (req.url === ACTION) {
          if (new URLSearchParams(raw).get('password') !== 'mine') return res.end(signInForm('Invalid username or password.'));
          res.statusCode = 302;
          res.setHeader('set-cookie', 'session=ok; Path=/');
          res.setHeader('location', '/');
          return res.end();
        }
        res.statusCode = 404;
        res.end('');
      });
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('follows the shell to the sign-in page, tries the passwords it knows and comes back signed in', async () => {
    const browser = browserApprover({ executablePath });
    try {
      const b = await browser.browse({ url: `${base}/`, username: 't-ann', passwords: ['old', 'mine'] });
      expect(new URL(b.page.url()).pathname).toBe('/');
      await expect(b.page.locator('#shell').textContent()).resolves.toBe('AUGUR');
      await b.close();
      await expect(browser.browse({ url: `${base}/`, username: 't-ann', passwords: ['nope'] })).rejects.toThrow(/None of the passwords.*signs them in to AUGUR/);
    } finally {
      await browser.close();
    }
  }, 30_000);
});
