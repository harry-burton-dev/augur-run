// AUGUR's own scenarios, in RUN-id order. Each has a row in traceability.md; `pnpm test` checks they agree.
import type { Scenario } from '../../src/scenario.ts';
import { pending } from './pending.ts';
import { signIn } from './run-01-sign-in.ts';
import { floorReading } from './run-02-floor-reading.ts';
import { adminActivity } from './run-03-admin-activity.ts';
import { steadyUse } from './run-04-steady-use.ts';
import { statusHealthy } from './run-05-status.ts';
import { nightlyBackup } from './run-06-nightly-backup.ts';
import { organisationSettings } from './run-09-organisation.ts';
import { floorPreview } from './run-11-floor-preview.ts';
import { appFrame } from './run-13-app-frame.ts';
import { activityExport } from './run-14-activity-export.ts';

export const scenarios: Scenario[] = [signIn, floorReading, adminActivity, steadyUse, statusHealthy, nightlyBackup, organisationSettings, floorPreview, appFrame, activityExport, ...pending];
