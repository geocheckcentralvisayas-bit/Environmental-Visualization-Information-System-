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
const SEED_VERSION_KEY = 'envis.accounts.seed';
const ACTIVITY_KEY = 'envis.activity.v1';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const ACTIVITY_LIMIT = 2000;

/**
 * Bump whenever the built-in password hashes in `SEED_ACCOUNTS` change. On the
 * next load, existing browsers replace their stored built-in hashes with the
 * new seeds (and their sessions are invalidated by the password fingerprint).
 * Accounts created in the admin panel are never touched.
 */
const SEED_VERSION = 2;

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
    passwordHash: 'pbkdf2$210000$cfb1f88cea6ed20f7d1e29318ec571f3$3a1d1270af109e2c4893020a523e719fc510582a1f9c810481aca242a0b58d87',
  },
  {
    userKey: 'cb34f4063bfa321825fbe3a8be7b6a5efc80fdcfd688d7443db6b95d1352d412',
    role: 'rd',
    displayName: 'Regional Director',
    division: 'Office of the Regional Director',
    passwordHash: 'pbkdf2$210000$9856ee30cf7e7d239b74bbb5656b916b$5d5b5372be1f16fab3bd8234735fe074eea7611c37139d61c87f00d9abe31289',
  },
  {
    userKey: 'f1ce19033c4403c2353a20d50513750e2b4bf8fcfdce65e89fd10ad1f2ce325b',
    role: 'emed',
    displayName: 'Environmental Monitoring & Enforcement Division',
    division: 'EMED',
    passwordHash: 'pbkdf2$210000$794bafa8881621367392e72bc4e01aad$f9d59bf2da41dd9037940f7ef1454e8432207edd1230c8892f6881a1438d24c8',
  },
  {
    userKey: 'c2196462c0f6865cbeb566d2d3b9a4f511213b3b09a8b22149ec94e3c04df89d',
    role: 'cpd',
    displayName: 'Clearance and Permitting Division',
    division: 'CPD',
    passwordHash: 'pbkdf2$210000$30ba65fc70b235ac5b5ea605783417ee$9433a0d4bf0983bfd6c871dff98f857e317798fc49c8bb9c4c608a38222fe16f',
  },
  {
    userKey: 'f5d075e171d01cb3c3ecc91276b7679f8f911b76c7122b106aa16c898469ad63',
    role: 'mis',
    displayName: 'Management and Information System',
    division: 'MIS',
    passwordHash: 'pbkdf2$210000$6ec997788c2e7e23b74ea9c092080b89$39c3684f6cfc263b0ac71a4943d4c59fc38cefec7a1962e7cbe516af22489329',
  },
  {
    userKey: '19b2041b6fc9fac0dbf80d27306f9d3665f995d9f45214d74c4042bf7b06bb15',
    role: 'gis',
    displayName: 'GIS Unit',
    division: 'GIS / Spatial Data',
    passwordHash: 'pbkdf2$210000$9043f0af84fe56f4c2d1b0ae07b5ee00$d2cad01a5430b94bd1942ad28d9141dbb3574429b3fd9e9703e27e6586c3071c',
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

/**
 * Replace the password hashes of built-in accounts with the current seeds so a
 * credential rotation reaches browsers that already cached the old registry.
 * Locally created accounts (builtin === false) and admin changes to role,
 * division, or active state are preserved.
 */
function refreshBuiltinAccounts(stored: StoredAccount[]): StoredAccount[] {
  const now = Date.now();
  return stored.map((account) => {
    if (account.builtin === false) return account;
    const seed =
      SEED_ACCOUNTS.find((candidate) => candidate.userKey === account.username) ??
      SEED_BY_DISPLAY.get(account.displayName);
    if (!seed) return account;
    return {
      ...account,
      username: seed.userKey,
      passwordHash: seed.passwordHash,
      builtin: true,
      updatedAt: now,
    };
  });
}

export function getAccounts(): StoredAccount[] {
  const stored = readJson<StoredAccount[] | null>(ACCOUNTS_KEY, null);
  const seedVersion = readJson<number>(SEED_VERSION_KEY, 0);
  if (Array.isArray(stored) && stored.length) {
    if (seedVersion !== SEED_VERSION) {
      const refreshed = refreshBuiltinAccounts(stored);
      saveAccounts(refreshed);
      writeJson(SEED_VERSION_KEY, SEED_VERSION);
      return refreshed;
    }
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
  writeJson(SEED_VERSION_KEY, SEED_VERSION);
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
