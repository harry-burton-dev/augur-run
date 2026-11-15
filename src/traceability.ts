// traceability.md, read as the run gate's checklist: which goal each scenario proves, and its status. A
// timed run must include every scenario marked Written, its own and the apps' (README, "An app's scenarios").
import { readFileSync } from 'node:fs';

/** `repo` is the repository whose `run/` module holds an app's scenario; `app` says there is one. */
export type TraceRow = { goals: string[]; runs: string[]; status: string; app: boolean; repo?: string; evidence: string };

/** "29, 30, 33a" or "35 to 38" → the goal numbers it covers. */
export const goalsIn = (cell: string) =>
  cell.split(',').flatMap((part) => {
    const range = part.trim().match(/^(\d+) to (\d+)$/);
    if (!range) return [part.trim()];
    const out: string[] = [];
    for (let n = Number(range[1]); n <= Number(range[2]); n++) out.push(String(n));
    return out;
  });

export const traceRows = (markdown: string): TraceRow[] =>
  markdown
    .split('\n')
    .filter((l) => /^\| \d/.test(l))
    .map((l) => {
      const cells = l.split('|').map((c) => c.trim());
      // A scenario an app owns lives in that app's repository, named here with its `run/` module.
      const scenario = cells[4] ?? '';
      const repo = scenario.match(/in ([\w.-]+)'s `run\/` module/)?.[1];
      return { goals: goalsIn(cells[1] ?? ''), runs: scenario.match(/RUN-\d{2,}/g) ?? [], status: cells[5] ?? '', app: !!repo, repo, evidence: cells[6] ?? '' };
    });

/** The scenario ids a full run must include: every one in a Written row. A row Waiting on an app (its app is out of AUGUR) isn't. */
export const writtenScenarios = (markdown: string) => [...new Set(traceRows(markdown).filter((r) => r.status === 'Written').flatMap((r) => r.runs))];

export const TRACEABILITY = new URL('../traceability.md', import.meta.url);

export const readTraceability = () => readFileSync(TRACEABILITY, 'utf8');
