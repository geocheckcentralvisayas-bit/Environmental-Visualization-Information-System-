export interface Env {
  DB: D1Database;
  DATA: R2Bucket;
  SESSION_TTL_HOURS: string;
  COOKIE_NAME: string;
  ALLOWED_ORIGINS: string;
  /**
   * Local/LAN only: URL of the planning watcher's JSON endpoint. When set,
   * /api/data/planning.json is proxied to it so changes appear without a
   * redeploy. Never set on a deployed Worker.
   */
  PLANNING_LIVE_URL?: string;
  /**
   * Development/LAN only. When "true", state-changing requests from a private
   * network address on a dashboard port (5173/4173/4181) are accepted, so the
   * site can be shared on the office LAN without hard-coding each DHCP address.
   * Never enable this on a deployed Worker.
   */
  ALLOW_LAN_ORIGINS?: string;
  COOKIE_SAME_SITE?: string;
  COOKIE_SECURE?: string;
}

export type Role = 'extraction' | 'rd' | 'emed' | 'cpd' | 'mis' | 'viewer' | 'gis';

export interface AccountRow {
  id: number;
  username: string;
  display_name: string;
  division: string;
  role: Role;
  password_hash: string;
  active: number;
  builtin: number;
  created_at: number;
  updated_at: number;
}

export interface SessionUser {
  username: string;
  role: Role;
  displayName: string;
  division: string;
  at: number;
}

export interface AuthContext {
  account: AccountRow;
  session: SessionUser;
  tokenHash: string;
}

export type ActivityType =
  | 'login'
  | 'login-failed'
  | 'logout'
  | 'export'
  | 'geojson'
  | 'account-add'
  | 'account-update'
  | 'account-delete'
  | 'password-change'
  | 'role-change';
