import type { Page } from 'playwright';
import type { Scenario } from '../../src/scenario.ts';
import { PATHS } from './shared.ts';

type App = { id: string; name: string; route: string };
type Box = { x: number; y: number; width: number; height: number };

/** Where WCAG 2.2's Reflow (1.4.10) applies: the narrowest width, a 1280 px screen at 400%. */
export const REFLOW_WIDTH = 320;

/**
 * Desktop, then a tablet held both ways: the widths alpha Goal 20 names. Then 320 px, a 1280 px screen at 400%,
 * where WCAG 2.2's Reflow (1.4.10) asks that nothing need scrolling sideways.
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
  // Reflow is asked only at its width. It waits for the layout to settle, so the boxes below are read after it.
  const reflow = shown && page.viewportSize()?.width === REFLOW_WIDTH ? await reflowOf(page) : null;
  const [stage, gauge, page_, rail, drawer] = await Promise.all(['.aerie-stage', '.aerie-gauge', '.quill-page', '.quill-rail', '.quill-drawer'].map((s) => box(page, s)));
  const state = shown ? await frame.evaluate((el) => ({ shape: el.getAttribute('data-shape'), rail: el.getAttribute('data-rail'), drawer: el.getAttribute('data-drawer') })) : undefined;
  const scroll = await page.evaluate(() => ({ page: document.documentElement.scrollWidth - window.innerWidth }));
  return { shown, stage, gauge, page: page_, rail, drawer, state, scroll, reflow };
};

/**
 * Whether the app makes a person scroll sideways at 320 px (WCAG 2.2 Reflow, 1.4.10). The shell's stage is the
 * app's scroll box, so the app reflows when the stage doesn't scroll sideways. A table, a code block or a reel
 * that scrolls in its own box doesn't widen the stage, and a crop made on purpose doesn't either. Waits for the
 * stage's width to settle (data arriving, the shell's transitions), then gives how far it scrolls sideways and,
 * as evidence, the outermost parts that run past its right edge outside any box of their own that scrolls or
 * clips, five at most. The shell's own parts are held by AUGUR's reflow contract test.
 */
export const reflowOf = async (page: Page) => {
  const over = () => page.evaluate(() => {
    const stage = document.querySelector('.aerie-stage');
    return stage ? stage.scrollWidth - stage.clientWidth : null;
  });
  let last = await over();
  for (let steady = 0, tries = 0; steady < 2 && tries < 20; tries++) {
    await page.waitForTimeout(250);
    const now = await over();
    steady = now === last ? steady + 1 : 0;
    last = now;
  }
  if (last === null) return { stage: false, over: 0, widest: [] };
  if (last <= 1) return { stage: true, over: 0, widest: [] };
  const widest = await page.evaluate(() => {
    const stage = document.querySelector('.aerie-stage')!;
    const edge = stage.getBoundingClientRect().right + 1;
    const own = (el: Element) => {
      for (let up = el.parentElement; up && up !== stage; up = up.parentElement) if (getComputedStyle(up).overflowX !== 'visible') return true;
      return false;
    };
    const found = [...stage.querySelectorAll('*')].filter((el) => el.getBoundingClientRect().right > edge && !own(el));
    const top = found.filter((el) => !found.some((other) => other !== el && other.contains(el)));
    return top.slice(0, 5).map((el) => `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').split(' ')[0]} (${(el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 30)})`);
  });
  return { stage: true, over: last, widest };
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
  if (l.reflow && l.reflow.over > 1) out.push(`the app scrolls sideways by ${l.reflow.over}px${l.reflow.widest.length ? `, past the edge: ${l.reflow.widest.join(', ')}` : ''}`);
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
  then: 'Each shows the app frame’s layout, and neither the floor gauge, the rail nor the drawer covers the page unless the person opened it over the page. At 320 px the app reflows: nothing in it needs scrolling sideways.',
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
