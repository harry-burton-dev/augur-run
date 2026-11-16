// RUN-13's look at the screen, against stand-in pages laid out as the shell and the app frame are. The
// browser part runs where a browser is installed (the dry run's job, or AUGUR_RUN_CHROMIUM locally).
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cutOff, lookAt, problemsIn, WIDTHS } from './run-13-app-frame.ts';

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
  cut: { past: [], sideways: [] },
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

  it('names what is cut off past the window’s edge or runs sideways out of its box', () => {
    expect(problemsIn(look({ cut: { past: ['p.aerie-name (Reference)'], sideways: ['div.quill-table ()'] } }))).toEqual([
      'past the window’s edge: p.aerie-name (Reference)',
      'runs sideways out of its box: div.quill-table ()',
    ]);
  });

  it('lets a rail or drawer the person opened over the page cover it', () => {
    expect(problemsIn(look({ rail: box(0, 300), state: { shape: 'icons', rail: 'over', drawer: null } }))).toEqual([]);
  });
});

describe.skipIf(!hasBrowser)('looking at a page laid out as the shell and the frame', () => {
  let browser: Browser;
  beforeAll(async () => void (browser = await chromium.launch({ executablePath })));
  afterAll(() => browser.close());

  const shell = (o: { lane: boolean; railOver?: boolean }) => `<!doctype html><html><body style="margin:0"><div class="aerie-shell" style="position:fixed;inset:0;overflow:hidden">
    <main class="aerie-stage" style="position:absolute;top:0;bottom:0;left:0;right:${o.lane ? '72px' : '0'};overflow:auto">
      <div class="quill-frame" data-shape="wide" data-rail="${o.railOver ? 'over' : 'open'}" style="display:flex;height:100%">
        <nav class="quill-rail" style="width:min(240px, 30%);flex:none;${o.railOver ? 'position:absolute;z-index:1' : ''}">Rail</nav>
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

  /** A page at 320 px with the shell's frame: what's inside the stage, which scrolls, is the app's. */
  const narrow = async (app: string) => {
    const page = await browser.newPage();
    await page.setViewportSize(WIDTHS[3]!);
    await page.setContent(`<!doctype html><html><body style="margin:0"><div class="aerie-shell" style="position:fixed;inset:0;overflow:hidden">
      <main class="aerie-stage" style="position:absolute;inset:0;overflow:auto">${app}</main></div></body></html>`);
    const found = await cutOff(page);
    await page.close();
    return found;
  };

  it('finds a heading past the edge though the stage scrolls, but not one an app cuts off on purpose', async () => {
    expect(await narrow('<h1 class="title" style="width:400px;margin:0">REFERENCE</h1>')).toEqual({ past: ['h1.title (REFERENCE)'], sideways: ['main.aerie-stage (REFERENCE)'] });
    expect(await narrow('<div class="clip" style="overflow:hidden;width:300px"><p style="width:400px;margin:0">cut on purpose</p></div>')).toEqual({ past: [], sideways: ['div.clip (cut on purpose)'] });
  });

  it('finds a fixed menu past the edge, whatever it sits in', async () => {
    expect(await narrow('<div style="overflow:hidden"><ul class="menu" style="position:fixed;left:200px;width:200px;margin:0">Menu</ul></div>')).toEqual({ past: ['ul.menu (Menu)'], sideways: [] });
  });

  it('lets a table scroll sideways in its own box, and skips text kept for screen readers', async () => {
    expect(
      await narrow(`<div class="wrap" style="overflow-x:auto;width:300px"><table style="width:600px"><tr><td>wide</td></tr></table></div>
        <a class="skip" href="#main" style="position:absolute;left:-10000px;width:1px;height:1px;overflow:hidden">Skip to content</a>`),
    ).toEqual({ past: [], sideways: [] });
  });

  it('names only the outermost of what runs past, and says when there is no shell', async () => {
    expect(await narrow('<div class="row" style="width:500px"><span style="display:block;width:480px">a</span><span style="display:block;width:480px">b</span></div>')).toEqual({
      past: ['div.row (ab)'],
      sideways: ['main.aerie-stage (ab)'],
    });
    const page = await browser.newPage();
    await page.setContent('<p>no shell</p>');
    expect(await cutOff(page)).toEqual({ past: ['no .aerie-shell on the page'], sideways: [] });
    await page.close();
  });

  it('finds the gauge over the app when the stage runs under it', async () => {
    const page = await browser.newPage();
    await page.setViewportSize(WIDTHS[2]!);
    await page.setContent(shell({ lane: false }));
    expect(problemsIn(await lookAt(page))).toEqual(['the floor gauge lies over the app’s stage', 'the floor gauge covers the page']);
    await page.close();
  });
});
