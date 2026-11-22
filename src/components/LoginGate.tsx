import { useState } from 'react';
import { Eye, EyeOff, Lock, ShieldCheck, User } from 'lucide-react';
import { login, type Session } from '../lib/auth';

export function LoginGate({ onLogin, notice }: { onLogin: (session: Session) => void; notice?: string | null }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

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
      setError('Invalid username or password.');
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

        <form onSubmit={submit} className="card space-y-4 p-6">
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
          <div>
            <label className="mb-1.5 block text-[10.5px] font-semibold uppercase tracking-[0.14em] text-slate-400">Password</label>
            <div className="relative">
              <Lock size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                className="input h-10 w-full px-9"
                placeholder="Enter your password"
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
          {error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11.5px] text-rose-200">{error}</div>}
          {notice && <div className="rounded-lg border border-emerald-400/30 bg-emerald-400/10 px-3 py-2 text-[11.5px] text-emerald-200">{notice}</div>}
          <button type="submit" disabled={busy} className="btn btn-primary h-10 w-full justify-center">
            <ShieldCheck size={14} /> {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p className="text-center text-[10px] text-slate-600">Authorized DENR-EMB Region VII personnel only.</p>
          <p className="text-center text-[9.5px] text-slate-700">No self-service password reset: contact the MIS unit to reset an account.</p>
        </form>
      </div>
    </div>
  );
}
