// Approves a persona's sign-in code on AUGUR's real sign-in page with a headless browser (Playwright,
// decision 0002), the way a person would: name and password, a new password the first time, then the
// grant. It reads the page by its form fields, not by its words, so the sign-in theme can change.
import { chromium, type Browser, type Page } from 'playwright';
import type { Approver } from './signin.ts';
import { RunRefused } from './synthetic.ts';

/** What the sign-in page is showing, by the fields it holds. */
export type Step = 'credentials' | 'new-password' | 'two-step' | 'user-code' | 'grant' | 'done' | 'error' | 'unknown';

const visible = async (page: Page, selector: string) => (await page.locator(selector).count()) > 0 && (await page.locator(selector).first().isVisible());

export const stepOf = async (page: Page): Promise<Step> => {
  if (await visible(page, '#password-new')) return 'new-password';
  if (await visible(page, '#username')) return 'credentials';
  if (await visible(page, '#otp, input[name="otp"], input[name="totp"]')) return 'two-step';
  if (await visible(page, 'input[name="device_user_code"], #device-user-code')) return 'user-code';
  if (await visible(page, 'input[name="accept"], button[name="accept"]')) return 'grant';
  if (await visible(page, '#input-error, .kc-feedback-text, .pf-m-danger, .alert-error')) return 'error';
  // Keycloak's last page after a device grant has no form left on it.
  if ((await page.locator('form').count()) === 0) return 'done';
  return 'unknown';
};

const errorText = async (page: Page) =>
  (await page.locator('#input-error, .kc-feedback-text, .pf-m-danger, .alert-error').first().textContent().catch(() => ''))?.trim() || 'the page showed an error';

/** Clicks and waits for the page it leads to, so the next look is at the new page, not the old one. */
const clickThrough = async (page: Page, selector: string) => {
  await Promise.all([page.waitForNavigation({ waitUntil: 'domcontentloaded' }), page.locator(selector).first().click()]);
};
const submit = (page: Page) => clickThrough(page, '#kc-login, [type="submit"]');

/** Walks the sign-in pages for one code. Throws, with what the page said, when it can't get through. */
export const approveOn = async (page: Page, o: Parameters<Approver>[0]): Promise<{ usedPassword: string }> => {
  await page.goto(o.url);
  const passwords = [...o.passwords];
  let used = passwords[0] ?? '';
  let tried = 0;
  for (let steps = 0; steps < 20; steps++) {
    if (o.granted?.()) return { usedPassword: used };
    const step = await stepOf(page);
    if (step === 'done') return { usedPassword: used };
    if (step === 'credentials') {
      // A wrong password brings the same page back with an error: the next candidate is tried.
      const pw = passwords[tried++];
      if (pw === undefined) throw new RunRefused(`None of the passwords the run knows for ${o.username} signs them in (${await errorText(page)}).`);
      used = pw;
      await page.fill('#username', o.username);
      await page.fill('#password', pw);
      await submit(page);
    } else if (step === 'new-password') {
      await page.fill('#password-new', o.newPassword);
      await page.fill('#password-confirm', o.newPassword);
      await submit(page);
      used = o.newPassword;
    } else if (step === 'user-code') {
      await page.fill('input[name="device_user_code"], #device-user-code', o.userCode);
      await submit(page);
    } else if (step === 'grant') {
      await clickThrough(page, 'input[name="accept"], button[name="accept"]');
    } else if (step === 'two-step') {
      throw new RunRefused(`${o.username} is asked for a two-step code, which the run can't give yet. Two-step sign-in for sample admins arrives with the Account area (ADR 0038).`);
    } else if (step === 'error') {
      // An error above the sign-in form is handled as a wrong password; anywhere else it stops.
      if (await visible(page, '#username')) continue;
      throw new RunRefused(`The sign-in page stopped ${o.username}: ${await errorText(page)}.`);
    } else if (o.granted) {
      // A page with nothing to answer, such as the last one after the grant: the code may be granted already.
      await page.waitForTimeout(1000);
    } else {
      throw new RunRefused(`The sign-in page showed something the run doesn't know how to answer, at ${page.url().split('?')[0]}.`);
    }
  }
  throw new RunRefused(`${o.username}'s sign-in went round too many pages without finishing.`);
};

/** One browser for the whole run; each sign-in gets a clean context, so no cookie carries over. */
export const browserApprover = (o: { executablePath?: string } = {}) => {
  let browser: Promise<Browser> | undefined;
  const approve: Approver = async (args) => {
    browser ??= chromium.launch({ headless: true, executablePath: o.executablePath });
    const context = await (await browser).newContext();
    try {
      return await approveOn(await context.newPage(), args);
    } finally {
      await context.close();
    }
  };
  const close = async () => {
    if (browser) await (await browser).close();
  };
  return { approve, close };
};
