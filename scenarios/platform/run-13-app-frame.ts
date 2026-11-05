import type { Page } from 'playwright';
import type { Scenario } from '../../src/scenario.ts';
import { PATHS } from './shared.ts';

type App = { id: string; name: string; route: string };
type Box = { x: number; y: number; width: number; height: number };

/** Desktop, then a tablet held both ways: the widths alpha Goal 20 names. */
export const WIDTHS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet, landscape', width: 1024, height: 768 },
  { name: 'tablet, portrait', width: 768, height: 1024 },
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
  return { shown, stage, gauge, page: page_, rail, drawer, state, scroll };
};

/** The ways a look breaks the one-layout rule (App patterns, in the AUGUR handbook), in words. */
export const problemsIn = (l: Awaited<ReturnType<typeof lookAt>>): string[] => {
  const out: string[] = [];
  if (!l.shown) return ['it shows no app frame'];
  if (!l.stage || !l.page) return ['the shell’s stage or the app’s page has no size'];
  if (l.gauge && overlaps(l.gauge, l.stage)) out.push('the floor gauge lies over the app’s stage');
  if (l.gauge && overlaps(l.gauge, l.page)) out.push('the floor gauge covers the page');
  if (!inside(l.page, l.stage)) out.push('the page runs past the shell’s stage');
  if (l.scroll.page > 1) out.push(`the window scrolls sideways by ${l.scroll.page}px`);
  // A rail or drawer opened over the page may cover it; one that's open beside it, or folded, may not.
  if (l.rail && l.state?.rail !== 'over' && overlaps(l.rail, l.page)) out.push('the rail covers the page');
  if (l.drawer && l.state?.drawer !== 'over' && overlaps(l.drawer, l.page)) out.push('the drawer covers the page');
  return out;
};

/** Every app keeps the app frame's one layout, and nothing covers it, on a desktop and on a tablet. */
export const appFrame: Scenario = {
  id: 'RUN-13',
  title: 'Every app shows the app frame, uncovered, at tablet width',
  owner: 'platform',
  goals: [20],
  given: 'The shell and every app the person is offered.',
  when: 'A sample person opens each app in a browser at desktop width and on a tablet held both ways.',
  then: 'Each shows the app frame’s layout, and neither the floor gauge, the rail nor the drawer covers the page unless the person opened it over the page.',
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
