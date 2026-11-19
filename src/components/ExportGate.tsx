import { createContext, useCallback, useContext, useState } from 'react';
import { canExport, getSession, verifyCredentials } from '../lib/auth';

interface ExportGateContextValue {
  guard: (action: () => void) => void;
}

const ExportGateContext = createContext<ExportGateContextValue>({ guard: (a) => a() });

export function useExportGate() {
  return useContext(ExportGateContext);
}

export function ExportGateProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<(() => void) | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const guard = useCallback((action: () => void) => {
    if (canExport(getSession())) {
      action();
      return;
    }
    setPending(() => action);
    setOpen(true);
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const result = await verifyCredentials(username, password, 'export');
    setBusy(false);
    if (!result.ok || !canExport(getSession())) {
      setError(result.message || 'Exporter account required.');
      return;
    }
    setOpen(false);
    setUsername('');
    setPassword('');
    const action = pending;
    setPending(null);
    if (action) action();
  };

  const cancel = () => {
    setOpen(false);
    setPending(null);
    setUsername('');
    setPassword('');
    setError('');
  };

  return (
    <ExportGateContext.Provider value={{ guard }}>
      {children}
      {open && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6">
            <h2 className="text-[15px] font-bold text-slate-50">Exporter login required</h2>
            <p className="mt-1 text-[11px] text-slate-500">Only the data extraction account can export data.</p>
            <form onSubmit={submit} className="mt-4 space-y-3">
              <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Username" autoComplete="username" required className="input h-9 w-full" />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Password" autoComplete="current-password" required className="input h-9 w-full" />
              {error && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">{error}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={cancel} className="btn h-9 flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={busy} className="btn btn-primary h-9 flex-1 justify-center">{busy ? 'Signing in…' : 'Sign in'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </ExportGateContext.Provider>
  );
}
