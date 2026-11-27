import { useEffect, useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { login, type Session } from '../lib/auth';
import { OFFLINE } from '../lib/api';
import { offlineAccessStatus } from '../lib/offlineAccess';
import { desktopBridge, requestSwitch, type SwitchResult } from '../lib/desktopBridge';
import clsx from 'clsx';

const bridge = desktopBridge();

export function LoginGate({ onLogin, notice }: { onLogin: (session: Session) => void; notice?: string | null }) {
  const [mode, setMode] = useState<'online' | 'offline'>(OFFLINE ? 'offline' : 'online');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [access, setAccess] = useState<{ configured: boolean; updatedBy?: string; updatedAt?: string } | null>(null);

  useEffect(() => {
    if (!OFFLINE) return;
    offlineAccessStatus()
      .then(setAccess)
      .catch(() => setAccess({ configured: false }));
  }, []);

  useEffect(() => {
    if (!bridge) return;
    const onMessage = (event: { data: unknown }) => {
      const data = event.data as SwitchResult | null;
      if (!data || data.type !== 'envis:switch-result') return;
      setConnecting(false);
      if (!data.ok) setError(data.message || 'The live dashboard is not reachable right now.');
    };
    bridge.addEventListener('message', onMessage);
    return () => bridge.removeEventListener('message', onMessage);
  }, []);

  const switchMode = (target: 'online' | 'offline') => {
    setError('');
    setConnecting(true);
    if (!requestSwitch(bridge, target)) {
      setConnecting(false);
      setError('Open ENVIS Dashboard from the Start Menu, then use its tray icon to switch.');
    }
  };

  const connectOnline = () => switchMode('online');
  const connectOffline = () => switchMode('offline');

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    let session: Awaited<ReturnType<typeof login>> = null;
    try {
      session = await login(username, password);
    } catch (cause) {
      setBusy(false);
      setError(cause instanceof Error ? cause.message : 'Sign-in failed.');
      return;
    }
    setBusy(false);
    if (!session) {
      setError(OFFLINE ? 'That is not the offline password.' : 'Invalid username or password.');
      return;
    }
    onLogin(session);
  };

  return (
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 px-4">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_20%_20%,rgba(16,185,129,0.12),transparent_45%),radial-gradient(circle_at_80%_80%,rgba(56,189,248,0.10),transparent_45%)]" />
      <div className="relative w-full max-w-md animate-fade-up">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid h-16 w-16 place-items-center rounded-2xl bg-white shadow-glow">
            <img src={`${import.meta.env.BASE_URL}assets/denr-logo.png`} alt="DENR" className="h-12 w-12 object-contain" />
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.22em] text-emerald-300">DENR-EMB Region VII</div>
            <h1 className="mt-1 text-[22px] font-bold tracking-tight text-slate-50">ENVIS Dashboard</h1>
            <p className="mt-1 text-[12px] text-slate-500">Environmental Permits Monitoring System</p>
          </div>
        </div>

        {(OFFLINE || bridge) && (
          <div className="mb-3 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-white/[0.02] p-1">
            {([
              { id: 'online', label: 'Online sign in' },
              { id: 'offline', label: 'Offline password' },
            ] as const).map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setMode(item.id); setError(''); setPassword(''); }}
                className={clsx(
                  'rounded-lg px-3 py-2 text-[12px] font-semibold transition-colors',
                  mode === item.id ? 'bg-emerald-400/15 text-emerald-200' : 'text-slate-500 hover:text-slate-300',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}

        {OFFLINE && mode === 'online' ? (
          <div className="card space-y-3 p-6 text-[12px] leading-relaxed text-slate-400">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
              <ShieldCheck size={15} className="text-emerald-300" /> Live dashboard
            </div>
            <p>
              The app looks for the office host first, then the public dashboard when this PC has
              internet. If neither answers, the offline view stays available.
            </p>
            {bridge ? (
              <>
                <button
                  type="button"
                  onClick={connectOnline}
                  disabled={connecting}
                  className="btn btn-primary h-9 w-full justify-center"
                >
                  <ShieldCheck size={14} />
                  {connecting ? 'Looking for the live dashboard…' : 'Connect to the live dashboard'}
                </button>
                {error && (
                  <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">
                    {error}
                  </div>
                )}
              </>
            ) : (
              <p className="text-[11px] text-slate-500">
                This page is open in a browser, so it cannot switch on its own. Open ENVIS Dashboard
                from the Start Menu and use the tray icon → <span className="text-slate-200">Switch to
                live dashboard</span>.
              </p>
            )}
            <p className="text-[11px] text-slate-500">
              Live data adds exports, GIS downloads, administration and the newest datasets. The
              offline view keeps working wherever this PC goes.
            </p>
            <button type="button" onClick={() => setMode('offline')} className="btn h-9 w-full justify-center">
              Back to offline view
            </button>
          </div>
        ) : !OFFLINE && mode === 'offline' ? (
          <div className="card space-y-3 p-6 text-[12px] leading-relaxed text-slate-400">
            <div className="flex items-center gap-2 text-[13px] font-semibold text-slate-100">
              <ShieldCheck size={15} className="text-emerald-300" /> Offline password only
            </div>
            <p>
              The offline copy opens with one password from MIS (<span className="text-slate-200">mis.systems</span>).
              No username is needed. It shows the last data synced to this PC and works with no internet.
            </p>
            <button
              type="button"
              onClick={connectOffline}
              disabled={connecting}
              className="btn btn-primary h-9 w-full justify-center"
            >
              <ShieldCheck size={14} />
              {connecting ? 'Opening the offline copy…' : 'Open the offline view'}
            </button>
            {error && (
              <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">
                {error}
              </div>
            )}
            <p className="text-[11px] text-slate-500">
              The password is created and changed by MIS only. If the offline copy is not installed,
              run ENVIS Dashboard Setup again.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="card space-y-4 p-6">
            {!OFFLINE && (
              <div>
                <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Username</label>
                <div className="relative">
                  <User size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    autoComplete="username"
                    required
                    className="input h-10 w-full pl-9"
                    placeholder="Enter your username"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {OFFLINE ? 'Offline access password' : 'Password'}
              </label>
              <div className="relative">
                <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                  disabled={OFFLINE && access !== null && !access.configured}
                  className="input h-10 w-full px-9"
                  placeholder={OFFLINE ? 'Enter the password from MIS' : 'Enter your password'}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  title={showPassword ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-slate-500 hover:bg-white/5 hover:text-slate-300"
                >
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            {OFFLINE && access !== null && !access.configured && (
              <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 px-3 py-2 text-[11.5px] leading-relaxed text-amber-200">
                Offline access has not been set up yet. An MIS user must create it once on the live
                dashboard (Administration → Offline access); this copy then receives it on its next
                office sync.
              </div>
            )}
            {error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">{error}</div>}
            {notice && <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11.5px] text-emerald-200">{notice}</div>}

            <button
              type="submit"
              disabled={busy || (OFFLINE && access !== null && !access.configured)}
              className="btn btn-primary h-10 w-full justify-center"
            >
              <ShieldCheck size={14} />
              {busy ? (OFFLINE ? 'Checking…' : 'Signing in…') : OFFLINE ? 'Unlock offline view' : 'Sign in'}
            </button>

            {OFFLINE ? (
              <p className="text-center text-[10px] leading-relaxed text-slate-600">
                Read-only view. One offline password, no username. Created and changed by MIS only.
              </p>
            ) : (
              <>
                <p className="text-center text-[10px] text-slate-600">Authorized DENR-EMB Region VII personnel only.</p>
                <p className="text-center text-[9.5px] text-slate-700">No self-service password reset: contact the MIS unit to reset an account.</p>
              </>
            )}
          </form>
        )}
      </div>
    </div>
  );
}
