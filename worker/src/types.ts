export interface Env {
  DB: D1Database;
  DATA: R2Bucket;
  SESSION_TTL_HOURS: string;
  COOKIE_NAME: string;
  ALLOWED_ORIGINS: string;
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
