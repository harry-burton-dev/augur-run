// What the platform scenarios share: AUGUR's API paths and the shapes they read. Once the platform's
// clients are generated from one source (alpha Goal 4), these come from the published contracts instead.
export const PATHS = {
  status: '/api/gateway/v1/status',
  me: '/api/identity/v1/me',
  workspaces: '/api/identity/v1/me/workspaces',
  manifest: '/api/registry/v1/manifest',
  notifications: '/api/events/v1/notifications',
  audit: '/api/events/v1/audit',
  member: (floor: string, person: string) => `/api/identity/v1/admin/departments/${encodeURIComponent(floor)}/members/${encodeURIComponent(person)}`,
};

export type Me = { id: string; name?: string; email?: string; roles: string[]; departments?: string[] };
export type Floor = { id: string; kind: string; name: string; path?: string[] };
export type Component = { name: string; kind?: string; state?: string; version?: string; problem?: string };
export type Status = {
  components?: Component[];
  backups?: { state: string; problem?: string; lastBackup?: { at: string; ok: boolean; problem?: string } };
  seeding?: { allowed: boolean };
};
export type AuditEntry = { id: string; at: string; actor?: { id: string }; app?: string; action: string; target?: string; detail?: Record<string, unknown> };

/** A service call should answer within this (alpha spec, non-functional requirements). */
export const CALL_LIMIT_MS = 5_000;

export const MINUTE = 60_000;
