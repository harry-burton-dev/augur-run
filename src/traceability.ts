// traceability.md, read as the run gate's checklist: which goal each scenario proves, and its status. A
// timed run must include every scenario marked Written, its own and the apps' (README, "An app's scenarios").
import { readFileSync } from 'node:fs';

export type TraceRow = { goals: string[]; runs: string[]; status: string; app: boolean };

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
      return { goals: goalsIn(cells[1] ?? ''), runs: (cells[4] ?? '').match(/RUN-\d{2,}/g) ?? [], status: cells[5] ?? '', app: /`run\/` module/.test(cells[4] ?? '') };
    });

/** The scenario ids a full run must include: every one in a Written row. */
export const writtenScenarios = (markdown: string) => [...new Set(traceRows(markdown).filter((r) => r.status === 'Written').flatMap((r) => r.runs))];

export const TRACEABILITY = new URL('../traceability.md', import.meta.url);

export const readTraceability = () => readFileSync(TRACEABILITY, 'utf8');
