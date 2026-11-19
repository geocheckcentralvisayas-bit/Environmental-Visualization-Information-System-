export type Role = 'extraction' | 'rd' | 'emed' | 'cpd' | 'mis' | 'viewer' | 'gis';

export interface Account {
  /**
   * Opaque account key. Built-in accounts store a SHA-256 key derived from the
   * login name, never the login name itself, so the published bundle contains
   * no readable usernames.
   */
  username: string;
  role: Role;
  displayName: string;
  division: string;
  passwordHash: string;
  /** True for accounts seeded from the built-in registry. */
  builtin?: boolean;
}

/** Account as persisted in the browser, with management metadata. */
export interface StoredAccount extends Account {
  active: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface Session {
  username: string;
  role: Role;
  displayName: string;
  division: string;
  at: number;
  /**
   * Fingerprint of the account's password hash at sign-in. Stored so a password
   * reset or role change invalidates any session that was issued earlier.
   */
  ph?: string;
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

export interface ActivityEntry {
  id: string;
  at: number;
  type: ActivityType;
  username: string;
  role: Role | 'unknown';
  detail: string;
}

const SESSION_KEY = 'envis.session';
const ACCOUNTS_KEY = 'envis.accounts.v1';
const ACTIVITY_KEY = 'envis.activity.v1';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ACTIVITY_LIMIT = 2000;

/**
 * Username pepper. This is not a secret; it only prevents a precomputed
 * dictionary of common login names from being matched against the published
 * account keys.
 */
const USERNAME_PEPPER = 'envis-r7-2026';
const PBKDF2_ITERATIONS = 210_000;

export const ROLES: Role[] = ['extraction', 'rd', 'emed', 'cpd', 'mis', 'viewer', 'gis'];

interface SeedAccount {
  userKey: string;
  role: Role;
  displayName: string;
  division: string;
  passwordHash: string;
}

/**
 * Built-in accounts.
 *
 * No plaintext username or password is stored here. `userKey` is
 * SHA-256(pepper + lower-cased login name) and `passwordHash` is PBKDF2-SHA256
 * with a per-account random salt. Verification happens in the browser, so the
 * hashes are necessarily shipped; the login names and passwords are not.
 */
const SEED_ACCOUNTS: SeedAccount[] = [
  {
    userKey: '335f00a1d58dccf1b232c12dfd5d49106c0bc289c6d71ffe54e3970bbbe885fa',
    role: 'extraction',
    displayName: 'Data Extraction Unit',
    division: 'Data Extraction',
    passwordHash: 'pbkdf2$210000$e0f9f18f77243bc11d8bb18208554eb5$df91f4c536d8ab0545c322467383451218f8823d39c7535a5475f2abddb75824',
  },
  {
    userKey: 'cb34f4063bfa321825fbe3a8be7b6a5efc80fdcfd688d7443db6b95d1352d412',
    role: 'rd',
    displayName: 'Regional Director',
    division: 'Office of the Regional Director',
    passwordHash: 'pbkdf2$210000$a6f0319013435d0c36ca2ede420ee3fd$f059d439ba8526c3540a3dee99510712ded4bfa58c59d20a39b2f068df5543c0',
  },
  {
    userKey: 'f1ce19033c4403c2353a20d50513750e2b4bf8fcfdce65e89fd10ad1f2ce325b',
    role: 'emed',
    displayName: 'Environmental Monitoring & Enforcement Division',
    division: 'EMED',
    passwordHash: 'pbkdf2$210000$a95d35d8289c5579f3d9508a2772d46d$0e24c1b4e302d1ab7dba2cc8586c9e271fe1976f075406295aa95c7d595cd759',
  },
  {
    userKey: 'c2196462c0f6865cbeb566d2d3b9a4f511213b3b09a8b22149ec94e3c04df89d',
    role: 'cpd',
    displayName: 'Clearance and Permitting Division',
    division: 'CPD',
    passwordHash: 'pbkdf2$210000$5e7b4bf6befc5cf29b6eb9269e4ed4d0$3ca3ae33648a4e1db2bae0ca2817d308f1fc7137b08d764a0f7e989d7a3a50b0',
  },
  {
    userKey: 'f5d075e171d01cb3c3ecc91276b7679f8f911b76c7122b106aa16c898469ad63',
    role: 'mis',
    displayName: 'Management and Information System',
    division: 'MIS',
    passwordHash: 'pbkdf2$210000$65e3901f77fcff64980091f5bd733787$aaa4adf2c9bc974d2d351998e2054f7ab5210e11b044275d7063744e9ec24be9',
  },
  {
    userKey: '19b2041b6fc9fac0dbf80d27306f9d3665f995d9f45214d74c4042bf7b06bb15',
    role: 'gis',
    displayName: 'GIS Unit',
    division: 'GIS / Spatial Data',
    passwordHash: 'pbkdf2$210000$91b8b69a3ddcb8834707410a14472a9f$bf52e4d79172ffad9183dc1a41c25e309a71684c02125f437413937087580c64',
  },
];

/**
 * Previous releases shipped the built-in login names in the source. A browser
 * that still holds the old plaintext seed is migrated by matching the seed's
 * display name (or the legacy extraction role) and replacing the login name
 * with its opaque key. The old password hash is kept only until the next
 * successful sign-in, when it is upgraded to PBKDF2.
 */
const SEED_BY_DISPLAY = new Map(SEED_ACCOUNTS.map((account) => [account.displayName, account]));


function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or unavailable */
  }
}

function uniqueId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function fromHex(hex: string): Uint8Array {
  const clean = hex.trim();
  if (clean.length % 2 !== 0 || /[^0-9a-f]/i.test(clean)) return new Uint8Array();
  const bytes = new Uint8Array(clean.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= a.charCodeAt(index) ^ b.charCodeAt(index);
  }
  return diff === 0;
}

export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return toHex(buf);
}

function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

/** Opaque key used to look up a built-in account without storing its login name. */
export async function usernameKey(username: string): Promise<string> {
  return sha256(`${USERNAME_PEPPER}:${normalizeUsername(username)}`);
}

async function derivePassword(password: string, saltHex: string, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: fromHex(saltHex), iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toHex(bits);
}

export async function hashPassword(password: string, saltHex?: string): Promise<string> {
  const salt = saltHex ?? toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  const hash = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${salt}$${hash}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  if (stored.startsWith('pbkdf2$')) {
    const [, iterationsText, salt, expected] = stored.split('$');
    const iterations = Number(iterationsText);
    if (!Number.isFinite(iterations) || iterations < 1_000 || !salt || !expected) return false;
    const actual = await derivePassword(password, salt, iterations);
    return constantTimeEqual(actual, expected);
  }
  // Legacy unsalted SHA-256 hash; upgraded to PBKDF2 on the next successful sign-in.
  return constantTimeEqual(await sha256(password), stored);
}

/* ------------------------------------------------------------------ */
/* activity log                                                        */
/* ------------------------------------------------------------------ */

export function logActivity(
  type: ActivityType,
  detail: string,
  username = 'system',
  role: Role | 'unknown' = 'unknown',
): void {
  const entries = readJson<ActivityEntry[]>(ACTIVITY_KEY, []);
  entries.unshift({ id: uniqueId(), at: Date.now(), type, username, role, detail });
  if (entries.length > ACTIVITY_LIMIT) entries.length = ACTIVITY_LIMIT;
  writeJson(ACTIVITY_KEY, entries);
}

export function getActivity(): ActivityEntry[] {
  return readJson<ActivityEntry[]>(ACTIVITY_KEY, []);
}

export function clearActivity(): void {
  localStorage.removeItem(ACTIVITY_KEY);
}

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

function seedAccounts(): StoredAccount[] {
  const now = Date.now();
  return SEED_ACCOUNTS.map((account) => ({
    username: account.userKey,
    role: account.role,
    displayName: account.displayName,
    division: account.division,
    passwordHash: account.passwordHash,
    builtin: true,
    active: true,
    createdAt: now,
    updatedAt: now,
  }));
}

export function getAccounts(): StoredAccount[] {
  const stored = readJson<StoredAccount[] | null>(ACCOUNTS_KEY, null);
  if (Array.isArray(stored) && stored.length) {
    let changed = false;
    const migrated = stored.map((account) => {
      let next = account;
      const legacyExtraction = !ROLES.includes(account.role) && String(account.role).startsWith('extract');
      const seed = account.builtin === false
        ? undefined
        : SEED_BY_DISPLAY.get(account.displayName) ?? (legacyExtraction ? SEED_ACCOUNTS[0] : undefined);
      if (seed && (account.role === seed.role || legacyExtraction)) {
        changed = true;
        next = {
          ...next,
          username: seed.userKey,
          role: seed.role,
          displayName: seed.displayName,
          division: seed.division,
          builtin: true,
        };
      }
      return next;
    });
    if (changed) writeJson(ACCOUNTS_KEY, migrated);
    return migrated;
  }
  const initial = seedAccounts();
  writeJson(ACCOUNTS_KEY, initial);
  return initial;
}

function saveAccounts(accounts: StoredAccount[]): void {
  writeJson(ACCOUNTS_KEY, accounts);
}

function findAccount(accounts: StoredAccount[], username: string): number {
  const needle = username.trim().toLowerCase();
  return accounts.findIndex((account) => account.username.toLowerCase() === needle);
}

export async function login(username: string, password: string): Promise<Session | null> {
  const accounts = getAccounts();
  const normalized = normalizeUsername(username);
  const key = await usernameKey(normalized);
  let index = accounts.findIndex((account) => account.username === key);
  if (index < 0) {
    // Locally created accounts keep a readable username; compare case-insensitively.
    index = accounts.findIndex((account) => account.username.toLowerCase() === normalized);
  }
  if (index < 0 || !accounts[index].active) {
    logActivity('login-failed', 'Failed sign-in attempt (unknown or inactive account)', 'unknown', 'unknown');
    return null;
  }
  const account = accounts[index];
  if (!(await verifyPassword(password, account.passwordHash))) {
    logActivity('login-failed', `Failed sign-in for ${account.displayName} (wrong password)`, account.username, account.role);
    return null;
  }
  if (!account.passwordHash.startsWith('pbkdf2$')) {
    accounts[index] = { ...account, passwordHash: await hashPassword(password), updatedAt: Date.now() };
    saveAccounts(accounts);
  }
  const session: Session = {
    username: account.username,
    role: account.role,
    displayName: account.displayName,
    division: account.division,
    at: Date.now(),
    ph: account.passwordHash.slice(0, 24),
  };
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  logActivity('login', `${account.displayName} signed in`, account.username, account.role);
  return session;
}

export function getSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    if (!session || !session.at) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Every role — including the Regional Director — expires after the TTL.
    if (Date.now() - session.at > SESSION_TTL_MS) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Invalidate sessions whose account was deactivated or deleted.
    const account = getAccounts().find((entry) => entry.username.toLowerCase() === session.username.toLowerCase());
    if (!account || !account.active) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Invalidate sessions issued before a password reset.
    const fingerprint = account.passwordHash.slice(0, 24);
    if (session.ph && session.ph !== fingerprint) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    // Never trust role/profile fields from localStorage: re-read them from the
    // account registry so a tampered session cannot escalate privileges.
    const hardened: Session = {
      ...session,
      role: account.role,
      displayName: account.displayName,
      division: account.division,
      ph: fingerprint,
    };
    if (
      hardened.role !== session.role ||
      hardened.displayName !== session.displayName ||
      hardened.division !== session.division ||
      session.ph !== fingerprint
    ) {
      localStorage.setItem(SESSION_KEY, JSON.stringify(hardened));
    }
    return hardened;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function logout(): void {
  const session = getSession();
  if (session) {
    logActivity('logout', `${session.displayName} signed out`, session.username, session.role);
  }
  localStorage.removeItem(SESSION_KEY);
}

export function canExport(session: Session | null): boolean {
  return session?.role === 'extraction' || session?.role === 'mis';
}

export function canDownloadGeoJson(session: Session | null): boolean {
  return session?.role === 'gis';
}

export function canManageAccounts(session: Session | null): boolean {
  return session?.role === 'mis';
}

function requireMis(): Session {
  const session = getSession();
  if (!session || !canManageAccounts(session)) throw new Error('Only the MIS account can manage accounts.');
  return session;
}

export async function addAccount(input: {
  username: string;
  displayName: string;
  division: string;
  role: Role;
  password: string;
}): Promise<StoredAccount> {
  const actor = requireMis();
  const username = input.username.trim();
  if (!username) throw new Error('Username is required.');
  if (!input.password || input.password.length < 8) throw new Error('Password must be at least 8 characters.');
  const accounts = getAccounts();
  if (findAccount(accounts, username) >= 0) throw new Error('That username already exists.');
  const account: StoredAccount = {
    username,
    role: input.role,
    displayName: input.displayName.trim() || username,
    division: input.division.trim() || '—',
    passwordHash: await hashPassword(input.password),
    builtin: false,
    active: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  saveAccounts([...accounts, account]);
  logActivity('account-add', `${actor.displayName} created account ${account.displayName} (${account.role})`, actor.username, actor.role);
  return account;
}

export async function updateAccount(
  username: string,
  changes: { username?: string; displayName?: string; division?: string; role?: Role },
): Promise<StoredAccount> {
  const actor = requireMis();
  const accounts = getAccounts();
  const index = findAccount(accounts, username);
  if (index < 0) throw new Error('Account not found.');
  const current = accounts[index];
  const next: StoredAccount = { ...current };

  if (changes.username !== undefined) {
    const newUsername = changes.username.trim();
    if (!newUsername) throw new Error('Username is required.');
    if (findAccount(accounts, newUsername) >= 0 && newUsername.toLowerCase() !== current.username.toLowerCase()) {
      throw new Error('That username already exists.');
    }
    next.username = newUsername;
  }
  if (changes.displayName !== undefined) next.displayName = changes.displayName.trim() || next.username;
  if (changes.division !== undefined) next.division = changes.division.trim() || '—';
  if (changes.role !== undefined && changes.role !== current.role) {
    if (current.role === 'mis' && changes.role !== 'mis' && accounts.filter((account) => account.role === 'mis').length <= 1) {
      throw new Error('You cannot change the role of the last MIS account.');
    }
    next.role = changes.role;
    logActivity('role-change', `${actor.displayName} changed ${current.displayName} from ${current.role} to ${changes.role}`, actor.username, actor.role);
  }
  next.updatedAt = Date.now();
  accounts[index] = next;
  saveAccounts(accounts);
  logActivity(
    'account-update',
    `${actor.displayName} updated account ${current.displayName}${current.displayName !== next.displayName ? ` → ${next.displayName}` : ''}`,
    actor.username,
    actor.role,
  );
  return next;
}

export async function setAccountPassword(username: string, password: string): Promise<void> {
  const actor = requireMis();
  if (!password || password.length < 8) throw new Error('Password must be at least 8 characters.');
  const accounts = getAccounts();
  const index = findAccount(accounts, username);
  if (index < 0) throw new Error('Account not found.');
  accounts[index] = { ...accounts[index], passwordHash: await hashPassword(password), updatedAt: Date.now() };
  saveAccounts(accounts);
  logActivity('password-change', `${actor.displayName} reset the password for ${accounts[index].displayName}`, actor.username, actor.role);
}

export function setAccountActive(username: string, active: boolean): void {
  const actor = requireMis();
  const accounts = getAccounts();
  const index = findAccount(accounts, username);
  if (index < 0) throw new Error('Account not found.');
  if (!active && accounts[index].username.toLowerCase() === actor.username.toLowerCase()) {
    throw new Error('You cannot deactivate the account you are signed in with.');
  }
  accounts[index] = { ...accounts[index], active, updatedAt: Date.now() };
  saveAccounts(accounts);
  logActivity('account-update', `${actor.displayName} ${active ? 'activated' : 'deactivated'} account ${accounts[index].displayName}`, actor.username, actor.role);
}

export function deleteAccount(username: string): void {
  const actor = requireMis();
  const accounts = getAccounts();
  const index = findAccount(accounts, username);
  if (index < 0) throw new Error('Account not found.');
  if (accounts[index].username.toLowerCase() === actor.username.toLowerCase()) {
    throw new Error('You cannot delete the account you are signed in with.');
  }
  if (accounts[index].role === 'mis' && accounts.filter((account) => account.role === 'mis').length <= 1) {
    throw new Error('You cannot delete the last MIS account.');
  }
  const removed = accounts[index];
  accounts.splice(index, 1);
  saveAccounts(accounts);
  logActivity('account-delete', `${actor.displayName} deleted account ${removed.displayName}`, actor.username, actor.role);
}

export function exportAccountsJson(): string {
  return JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), accounts: getAccounts() }, null, 2);
}

export function importAccountsJson(json: string): { added: number; updated: number; skipped: number } {
  const actor = requireMis();
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('The file is not valid JSON.');
  }
  const list: unknown = Array.isArray(parsed) ? parsed : (parsed as { accounts?: unknown })?.accounts;
  if (!Array.isArray(list)) throw new Error('The file does not contain an accounts list.');
  const accounts = getAccounts();
  let added = 0;
  let updated = 0;
  let skipped = 0;
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      skipped += 1;
      continue;
    }
    const candidate = entry as Partial<StoredAccount>;
    if (typeof candidate.username !== 'string' || !candidate.username.trim()) {
      skipped += 1;
      continue;
    }
    if (typeof candidate.passwordHash !== 'string' || !candidate.passwordHash) {
      skipped += 1;
      continue;
    }
    if (!ROLES.includes(candidate.role as Role)) {
      skipped += 1;
      continue;
    }
    const username = candidate.username.trim();
    const role = candidate.role as Role;
    const displayName = typeof candidate.displayName === 'string' && candidate.displayName.trim() ? candidate.displayName.trim() : username;
    const division = typeof candidate.division === 'string' && candidate.division.trim() ? candidate.division.trim() : '—';
    const active = candidate.active !== false;
    const builtin = candidate.builtin === true || /^[a-f0-9]{64}$/i.test(username);
    const index = findAccount(accounts, username);
    if (index < 0) {
      accounts.push({
        username,
        role,
        displayName,
        division,
        passwordHash: candidate.passwordHash,
        builtin,
        active,
        createdAt: typeof candidate.createdAt === 'number' ? candidate.createdAt : Date.now(),
        updatedAt: Date.now(),
      });
      added += 1;
    } else {
      accounts[index] = {
        ...accounts[index],
        username,
        role,
        displayName,
        division,
        passwordHash: candidate.passwordHash,
        builtin,
        active,
        updatedAt: Date.now(),
      };
      updated += 1;
    }
  }
  saveAccounts(accounts);
  logActivity('account-update', `${actor.displayName} imported accounts (${added} added, ${updated} updated, ${skipped} skipped)`, actor.username, actor.role);
  return { added, updated, skipped };
}
