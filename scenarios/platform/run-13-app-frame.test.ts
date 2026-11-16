// RUN-13's look at the screen, against stand-in pages laid out as the shell and the app frame are. The
// browser part runs where a browser is installed (the dry run's job, or AUGUR_RUN_CHROMIUM locally).
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookAt, problemsIn, reflowOf, WIDTHS } from './run-13-app-frame.ts';

const executablePath = process.env.AUGUR_RUN_CHROMIUM;
const hasBrowser = executablePath ? existsSync(executablePath) : existsSync(chromium.executablePath());

const box = (x: number, width: number) => ({ x, y: 0, width, height: 600 });
const look = (o: Partial<Parameters<typeof problemsIn>[0]> = {}): Parameters<typeof problemsIn>[0] => ({
  shown: true,
  stage: box(0, 1380),
  gauge: box(1390, 50),
  page: box(260, 1100),
  rail: box(0, 250),
  drawer: null,
  state: { shape: 'wide', rail: 'open', drawer: null },
  scroll: { page: 0 },
  reflow: null,
  ...o,
});

describe('what breaks the one-layout rule', () => {
  it('passes a frame whose page nothing covers', () => {
    expect(problemsIn(look())).toEqual([]);
  });

  it('names each way the page is covered or missing', () => {
    expect(problemsIn(look({ shown: false }))).toEqual(['it shows no app frame']);
    expect(problemsIn(look({ stage: box(0, 1440), page: box(260, 1180), scroll: { page: 40 } }))).toEqual([
      'the floor gauge lies over the app’s stage',
      'the floor gauge covers the page',
      'the window scrolls sideways by 40px',
    ]);
    expect(problemsIn(look({ rail: box(0, 300) }))).toEqual(['the rail covers the page']);
  });

  it('names how far the app scrolls sideways at 320 px, and what runs past the edge', () => {
    expect(problemsIn(look({ reflow: { over: 80, widest: ['h1.title (REFERENCE)'] } }))).toEqual(['the app scrolls sideways by 80px, past the edge: h1.title (REFERENCE)']);
    expect(problemsIn(look({ reflow: { over: 0, widest: [] } }))).toEqual([]);
  });

  it('lets a rail or drawer the person opened over the page cover it', () => {
    expect(problemsIn(look({ rail: box(0, 300), state: { shape: 'icons', rail: 'over', drawer: null } }))).toEqual([]);
  });
});

describe.skipIf(!hasBrowser)('looking at a page laid out as the shell and the frame', () => {
  let browser: Browser;
  beforeAll(async () => void (browser = await chromium.launch({ executablePath })));
  afterAll(() => browser.close());

  // The rail folds to its icons on a narrow window, as the kit's frame does (its `icons` shape).
  const shell = (o: { lane: boolean; railOver?: boolean }) => `<!doctype html><html><body style="margin:0"><style>:root { --rail: 240px } @media (max-width: 400px) { :root { --rail: 56px } }</style><div class="aerie-shell" style="position:fixed;inset:0;overflow:hidden">
    <main class="aerie-stage" style="position:absolute;top:0;bottom:0;left:0;right:${o.lane ? '72px' : '0'};overflow:auto">
      <div class="quill-frame" data-shape="wide" data-rail="${o.railOver ? 'over' : 'open'}" style="display:flex;height:100%">
        <nav class="quill-rail" style="width:var(--rail);flex:none;${o.railOver ? 'position:absolute;z-index:1' : ''}">Rail</nav>
        <div class="quill-page" style="flex:1;min-width:0">Page</div>
      </div>
    </main>
    <nav class="aerie-gauge" style="position:absolute;top:0;right:0;width:64px;height:300px">Floors</nav>
  </div></body></html>`;

  it('finds nothing wrong when the stage ends at the gauge’s lane, at every width', async () => {
    const page = await browser.newPage();
    for (const w of WIDTHS) {
      await page.setViewportSize(w);
      await page.setContent(shell({ lane: true }));
      expect([w.name, problemsIn(await lookAt(page))]).toEqual([w.name, []]);
    }
    await page.close();
  });

  /** A page at 320 px with the shell's frame: the stage, which scrolls, holds the app. */
  const narrow = async (app: string) => {
    const page = await browser.newPage();
    await page.setViewportSize(WIDTHS[3]!);
    await page.setContent(`<!doctype html><html><body style="margin:0"><div class="aerie-shell" style="position:fixed;inset:0;overflow:hidden">
      <main class="aerie-stage" style="position:absolute;inset:0;overflow:auto">${app}</main></div></body></html>`);
    const found = await reflowOf(page);
    await page.close();
    return found;
  };

  it('finds a heading that makes the app scroll sideways, though a table beside it scrolls in its own box', async () => {
    expect(
      await narrow(`<h1 class="title" style="width:400px;margin:0">REFERENCE</h1>
        <div class="wrap" style="overflow-x:auto"><table style="width:600px"><tr><td>wide</td></tr></table></div>`),
    ).toEqual({ over: 80, widest: ['h1.title (REFERENCE)'] });
  });

  it('lets a table scroll in its own box, a crop cut on purpose, and text kept for screen readers', async () => {
    expect(
      await narrow(`<div class="wrap" style="overflow-x:auto"><table style="width:600px"><tr><td>wide</td></tr></table></div>
        <div class="avatar" style="overflow:hidden;width:40px"><div style="width:400px">img</div></div>
        <a class="skip" href="#main" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden">Skip to content</a>`),
    ).toEqual({ over: 0, widest: [] });
  });

  it('finds a menu placed past the edge, and names only the outermost of what runs past', async () => {
    const found = await narrow(`<div style="position:relative"><ul class="menu" style="position:absolute;left:200px;width:200px;margin:0">Menu</ul></div>
      <div class="row" style="width:500px"><span style="display:block;width:480px">a</span></div>`);
    expect(found).toEqual({ over: 180, widest: ['ul.menu (Menu)', 'div.row (a)'] });
  });

  it('waits for content that arrives late', { timeout: 20_000 }, async () => {
    expect(await narrow(`<div id="late"></div><script>setTimeout(() => { document.getElementById('late').style.width = '420px'; }, 1500);</script>`)).toEqual({
      over: 100,
      widest: ['div#late'],
    });
  });

  it('finds the gauge over the app when the stage runs under it', async () => {
    const page = await browser.newPage();
    await page.setViewportSize(WIDTHS[2]!);
    await page.setContent(shell({ lane: false }));
    expect(problemsIn(await lookAt(page))).toEqual(['the floor gauge lies over the app’s stage', 'the floor gauge covers the page']);
    await page.close();
  });
});
