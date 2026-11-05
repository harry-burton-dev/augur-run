// AUGUR's own scenarios, in RUN-id order. Each has a row in traceability.md; `pnpm test` checks they agree.
import type { Scenario } from '../../src/scenario.ts';
import { pending } from './pending.ts';
import { signIn } from './run-01-sign-in.ts';
import { floorReading } from './run-02-floor-reading.ts';
import { adminActivity } from './run-03-admin-activity.ts';
import { steadyUse } from './run-04-steady-use.ts';
import { statusHealthy } from './run-05-status.ts';
import { nightlyBackup } from './run-06-nightly-backup.ts';
import { invite } from './run-07-invite.ts';
import { leaver } from './run-08-leaver.ts';
import { organisationSettings } from './run-09-organisation.ts';
import { inbox } from './run-10-inbox.ts';
import { floorPreview } from './run-11-floor-preview.ts';
import { faultDrill } from './run-12-fault-drill.ts';
import { appFrame } from './run-13-app-frame.ts';
import { activityExport } from './run-14-activity-export.ts';
import { emailSender } from './run-16-email.ts';
import { pointInTime } from './run-17-point-in-time.ts';
import { account } from './run-18-account.ts';

export const scenarios: Scenario[] = [signIn, floorReading, adminActivity, steadyUse, statusHealthy, nightlyBackup, invite, leaver, organisationSettings, inbox, floorPreview, faultDrill, appFrame, activityExport, emailSender, pointInTime, account, ...pending];
