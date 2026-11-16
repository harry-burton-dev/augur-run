import type { Page } from 'playwright';
import type { Scenario } from '../../src/scenario.ts';
import { PATHS } from './shared.ts';

type App = { id: string; name: string; route: string };
type Box = { x: number; y: number; width: number; height: number };

/** Where WCAG 2.2's Reflow (1.4.10) applies: the narrowest width, a 1280 px screen at 400%. */
export const REFLOW_WIDTH = 320;

/**
 * Desktop, then a tablet held both ways: the widths alpha Goal 20 names. Then 320 px, a 1280 px screen at 400%,
 * where WCAG 2.2's Reflow (1.4.10) asks that nothing be cut off or need scrolling sideways.
 */
export const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet, landscape', width: 1024, height: 768 },
  { name: 'tablet, portrait', width: 768, height: 1024 },
  { name: '320 px (reflow)', width: REFLOW_WIDTH, height: 640 },
];

const overlaps = (a: Box, b: Box) => a.x < b.x + b.width - 1 && b.x < a.x + a.width - 1 && a.y < b.y + b.height - 1 && b.y < a.y + a.height - 1;
const inside = (a: Box, b: Box) => a.x >= b.x - 1 && a.x + a.width <= b.x + b.width + 1;
const box = async (page: Page, selector: string) => ((await page.locator(selector).count()) ? page.locator(selector).first().boundingBox() : null);

/** What one app shows at one width: where the shell's stage, the floor gauge and the app's frame are. */
export const lookAt = async (page: Page) => {
  const frame = page.locator('.aerie-stage .quill-frame').first();
  const shown = await frame.waitFor({ state: 'visible', timeout: 15_000 }).then(
    () => true,
    () => false,
  );
  const [stage, gauge, page_, rail, drawer] = await Promise.all(['.aerie-stage', '.aerie-gauge', '.quill-page', '.quill-rail', '.quill-drawer'].map((s) => box(page, s)));
  const state = shown ? await frame.evaluate((el) => ({ shape: el.getAttribute('data-shape'), rail: el.getAttribute('data-rail'), drawer: el.getAttribute('data-drawer') })) : undefined;
  const scroll = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth }));
  // Reflow is asked only at its width, once the app's data has come and the shell has settled.
  const narrow = page.viewportSize()?.width === REFLOW_WIDTH;
  if (narrow && shown) await page.waitForLoadState('networkidle', { timeout: 10_000 }).catch(() => undefined);
  const cut = narrow && shown ? await cutOff(page) : { past: [], sideways: [] };
  return { shown, stage, gauge, page: page_, rail, drawer, state, scroll, cut };
};

/**
 * What a person can't reach at 320 px, after AUGUR's own reflow contract test (`platform/contract/tests/reflow.spec.ts`,
 * which holds the shell alone; this holds every app in it). Two things count:
 *   - past: anything shown past either edge of the window that no box inside the shell cuts off on purpose
 *     (overflow hidden or clip). A box that scrolls doesn't excuse what's in it, unless it scrolls a table, a grid
 *     or preformatted text. Nothing excuses a fixed box, which only the window holds. The shell's own clip is
 *     the window's edge.
 *   - sideways: a box whose content runs sideways out of it, scrolled or cut. Words cut short with an ellipsis
 *     are allowed, and so is a box that scrolls a table, a grid or preformatted text, which Reflow exempts.
 * Text kept for screen readers only (a 1 px box) is skipped. Only the outermost of nested finds is named, ten at
 * most. With no shell on the page, that is the finding.
 */
export const cutOff = (page: Page) =>
  page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const shell = document.querySelector('.aerie-shell');
    if (!shell) return { past: ['no .aerie-shell on the page'], sideways: [] };
    const shown = (el: Element) => el.checkVisibility({ opacityProperty: true, visibilityProperty: true });
    const name = (el: Element) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} (${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)})`;
    const cuts = (el: Element) => ['hidden', 'clip'].includes(getComputedStyle(el).overflowX);
    const twoWay = (el: Element) => getComputedStyle(el).overflowX !== 'visible' && !cuts(el) && !!el.querySelector('table, [role="table"], [role="grid"], pre');
    const clipped = (el: Element) => {
      if (getComputedStyle(el).position === 'fixed') return false;
      for (let up = el.parentElement; up && up !== shell; up = up.parentElement) if (cuts(up) || twoWay(up)) return true;
      return false;
    };
    const tiny = (el: Element) => {
      const b = el.getBoundingClientRect();
      return b.width <= 1 || b.height <= 1;
    };
    const all = [...shell.querySelectorAll('*')].filter((el) => shown(el) && !tiny(el));
    const past = all.filter((el) => {
      const b = el.getBoundingClientRect();
      return b.width > 0 && (b.right > width + 1 || b.left < -1) && !clipped(el);
    });
    const sideways = all.filter((el) => {
      const style = getComputedStyle(el);
      return style.overflowX !== 'visible' && style.textOverflow !== 'ellipsis' && !twoWay(el) && el.scrollWidth > el.clientWidth + 1;
    });
    const outermost = (found: Element[]) => {
      const top = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
      return top.length > 10 ? [...top.slice(0, 10).map(name), `and ${top.length - 10} more`] : top.map(name);
    };
    return { past: outermost(past), sideways: outermost(sideways) };
  });

/** The ways a look breaks the one-layout rule (App patterns, in the AUGUR handbook), in words. */
export const problemsIn = (l: Awaited<ReturnType<typeof lookAt>>): string[] => {
  const out: string[] = [];
  if (!l.shown) return ['it shows no app frame'];
  if (!l.stage || !l.page) return ['the shell’s stage or the app’s page has no size'];
  if (l.gauge && overlaps(l.gauge, l.stage)) out.push('the floor gauge lies over the app’s stage');
  if (l.gauge && overlaps(l.gauge, l.page)) out.push('the floor gauge covers the page');
  if (!inside(l.page, l.stage)) out.push('the page runs past the shell’s stage');
  if (l.scroll.page > 1) out.push(`the window scrolls sideways by ${l.scroll.page}px`);
  if (l.cut.past.length) out.push(`past the window’s edge: ${l.cut.past.join(', ')}`);
  if (l.cut.sideways.length) out.push(`runs sideways out of its box: ${l.cut.sideways.join(', ')}`);
  // A rail or drawer opened over the page may cover it; one that's open beside it, or folded, may not.
  if (l.rail && l.state?.rail !== 'over' && overlaps(l.rail, l.page)) out.push('the rail covers the page');
  if (l.drawer && l.state?.drawer !== 'over' && overlaps(l.drawer, l.page)) out.push('the drawer covers the page');
  return out;
};

/** Every app keeps the app frame's one layout, and nothing covers it, on a desktop, on a tablet and at 320 px. */
export const appFrame: Scenario = {
  id: 'RUN-13',
  title: 'Every app shows the app frame, uncovered, at tablet width and at 320 px',
  owner: 'platform',
  goals: [20],
  given: 'The shell and every app the person is offered.',
  when: 'A sample person opens each app in a browser at desktop width, on a tablet held both ways, and at 320 px.',
  then: 'Each shows the app frame’s layout, and neither the floor gauge, the rail nor the drawer covers the page unless the person opened it over the page. Nothing is cut off past the window’s edge or runs sideways out of its box.',
  cadence: { kind: 'once', afterMinutes: 30 },
  needs: [{ as: 'anyone' }],
  available: async (ctx) =>
    ctx.canBrowse !== false ? { ok: true } : { ok: false, why: 'This run has no browser, so it can’t look at the screen.', whoCanChange: 'Whoever starts the run: give it Chromium (--chromium or AUGUR_RUN_CHROMIUM).' },
  run: async (ctx) => {
    const { persona, api } = ctx.parts.anyone!;
    const manifest = await api.get<App[]>(PATHS.manifest);
    if (!ctx.check(`${persona.key} is offered their apps`, manifest.ok && Array.isArray(manifest.body), { actual: manifest.status })) return;
    // Home, at the root, is the shell's own front page, not an app in a frame.
    const apps = manifest.body.filter((a) => a.route && a.route !== '/');
    ctx.note(`Looking at ${apps.length} apps`, apps.map((a) => a.id));
    const page = await ctx.browse(persona);
    const origin = new URL(page.url()).origin;
    for (const app of apps) {
      for (const w of WIDTHS) {
        await page.setViewportSize({ width: w.width, height: w.height });
        await page.goto(`${origin}${app.route}`);
        const look = await lookAt(page);
        const problems = problemsIn(look);
        ctx.check(`${app.name} keeps the app frame’s layout, uncovered, at ${w.name} width`, !problems.length, {
          expected: 'the app frame, with nothing over its page',
          actual: problems.length ? { problems, shape: look.state?.shape, width: w.width } : { shape: look.state?.shape, width: w.width },
        });
      }
    }
  },
};
