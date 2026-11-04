// RUN-13's look at the screen, against stand-in pages laid out as the shell and the app frame are. The
// browser part runs where a browser is installed (the dry run's job, or AUGUR_RUN_CHROMIUM locally).
import { existsSync } from 'node:fs';
import { chromium, type Browser } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lookAt, problemsIn, WIDTHS } from './run-13-app-frame.ts';

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

  it('lets a rail or drawer the person opened over the page cover it', () => {
    expect(problemsIn(look({ rail: box(0, 300), state: { shape: 'icons', rail: 'over', drawer: null } }))).toEqual([]);
  });
});

describe.skipIf(!hasBrowser)('looking at a page laid out as the shell and the frame', () => {
  let browser: Browser;
  beforeAll(async () => void (browser = await chromium.launch({ executablePath })));
  afterAll(() => browser.close());

  const shell = (o: { lane: boolean; railOver?: boolean }) => `<!doctype html><html><body style="margin:0">
    <main class="aerie-stage" style="position:fixed;top:0;bottom:0;left:0;right:${o.lane ? '72px' : '0'}">
      <div class="quill-frame" data-shape="wide" data-rail="${o.railOver ? 'over' : 'open'}" style="display:flex;height:100%">
        <nav class="quill-rail" style="width:240px;flex:none;${o.railOver ? 'position:absolute;z-index:1' : ''}">Rail</nav>
        <div class="quill-page" style="flex:1;min-width:0">Page</div>
      </div>
    </main>
    <nav class="aerie-gauge" style="position:fixed;top:0;right:0;width:64px;height:300px">Floors</nav>
  </body></html>`;

  it('finds nothing wrong when the stage ends at the gauge’s lane, at every width', async () => {
    const page = await browser.newPage();
    for (const w of WIDTHS) {
      await page.setViewportSize(w);
      await page.setContent(shell({ lane: true }));
      expect([w.name, problemsIn(await lookAt(page))]).toEqual([w.name, []]);
    }
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
