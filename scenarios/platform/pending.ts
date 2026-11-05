// Scenarios for work not yet in AUGUR, written first from the alpha spec's journeys so each workstream
// builds toward the checks that will judge it. Each says what it waits on. The thread that lands the work
// replaces `available` and `run` with the real steps, and its traceability row moves to Written.
import { notYet, type Scenario } from '../../src/scenario.ts';

export const waiting = (s: Omit<Scenario, 'owner' | 'run' | 'available'> & { waitsOn: string; issue: string }): Scenario => {
  const { waitsOn, issue, ...rest } = s;
  return { ...rest, owner: 'platform', available: notYet(waitsOn, issue), run: async () => {} };
};

/** None waiting now: RUN-07 (email invites) has its real steps and waits on PER-194 through its own `available`. */
export const pending: Scenario[] = [];
