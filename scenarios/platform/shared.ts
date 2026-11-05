// What the platform scenarios share: AUGUR's API paths and the shapes they read. Once the platform's
// clients are generated from one source (alpha Goal 4), these come from the published contracts instead.
export const PATHS = {
  status: '/api/gateway/v1/status',
  me: '/api/identity/v1/me',
  preferences: '/api/identity/v1/me/preferences',
  sessions: '/api/identity/v1/me/sessions',
  signIns: '/api/identity/v1/me/sign-ins',
  myData: '/api/identity/v1/me/data',
  workspaces: '/api/identity/v1/me/workspaces',
  manifest: '/api/registry/v1/manifest',
  notifications: '/api/events/v1/notifications',
  notification: (id: string) => `/api/events/v1/notifications/${encodeURIComponent(id)}`,
  audit: '/api/events/v1/audit',
  inbox: '/api/events/v1/inbox',
  inboxCounts: '/api/events/v1/inbox/counts',
  inboxItem: (id: string) => `/api/events/v1/inbox/${encodeURIComponent(id)}`,
  inboxStep: (id: string, step: 'take' | 'release') => `/api/events/v1/inbox/${encodeURIComponent(id)}/${step}`,
  auditExport: '/api/events/v1/audit/export',
  organisation: '/api/identity/v1/organisation',
  adminOrganisation: '/api/identity/v1/admin/organisation',
  previews: '/api/registry/v1/feature-previews',
  appPreviews: (app: string) => `/api/registry/v1/apps/${encodeURIComponent(app)}/feature-previews`,
  appPreview: (app: string, preview: string) => `/api/registry/v1/apps/${encodeURIComponent(app)}/feature-previews/${encodeURIComponent(preview)}`,
  people: '/api/identity/v1/admin/people',
  invite: (id: string) => `/api/identity/v1/admin/people/${encodeURIComponent(id)}/invite`,
  person: (id: string) => `/api/identity/v1/admin/people/${encodeURIComponent(id)}`,
  leave: (id: string) => `/api/identity/v1/admin/people/${encodeURIComponent(id)}/leave`,
  member: (floor: string, person: string) => `/api/identity/v1/admin/departments/${encodeURIComponent(floor)}/members/${encodeURIComponent(person)}`,
};

export type Me = { id: string; name?: string; email?: string; roles: string[]; departments?: string[] };
export type Floor = { id: string; kind: string; name: string; path?: string[] };
export type Component = { name: string; kind?: string; state?: string; version?: string; problem?: string };
export type Status = {
  components?: Component[];
  backups?: {
    state: string;
    problem?: string;
    lastBackup?: { at: string; ok: boolean; problem?: string };
    pointInTime?: { at: string; ok: boolean; problem?: string; archivedAt?: string; copiedAt?: string; earliest?: string; lastTest?: { at: string; ok: boolean } };
  };
  email?: { state: 'off' | 'ok' | 'attention'; problem?: string; from?: string; checkedAt?: string };
  seeding?: { allowed: boolean };
};
export type Organisation = { name: string; timeZone: string; sender: { name: string; address?: string } };
export type PreviewsForMe = { apps: { app: string; name: string; previews: { id: string; name: string; mode: string; ended: boolean; on: boolean }[] }[] };
export type PreviewMode = 'off' | 'opt-in' | 'everyone' | 'floors';
export type PreviewsAdmin = { defaultMode: PreviewMode; previews: { id: string; mode: PreviewMode; ended: boolean; chosen: boolean; floors?: string[] }[] };
export type InboxCounts = { you: number; teams: number; overdue: number };
export type InboxItem = { id: string; app: string; kind: string; owner: { kind: 'person' | 'team'; id: string }; state: string; takenBy?: string; redacted?: boolean; title?: string };
export type AuditEntry = { id: string; at: string; actor?: { id: string }; app?: string; action: string; target?: string; detail?: Record<string, unknown> };

/** A service call should answer within this (alpha spec, non-functional requirements). */
export const CALL_LIMIT_MS = 5_000;

export const MINUTE = 60_000;
