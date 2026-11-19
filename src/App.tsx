import { useEffect, useState, Suspense, lazy } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useDashboard } from './store/useDashboard';
import { Layout } from './components/Layout';
import { ErrorBoundary } from './components/ErrorBoundary';
import { SiteDrawer } from './components/SiteDrawer';
import { LoginGate } from './components/LoginGate';
import { subscribeGate, resolveGate, cancelGate, tryGateLogin, getPendingKind } from './lib/exportGate';
import { loadSession, type Session } from './lib/auth';
import { dataUrl } from './lib/api';
import type { PageId } from './types';

const OverviewPage = lazy(() => import('./pages/Overview').then((m) => ({ default: m.OverviewPage })));
const SitesPage = lazy(() => import('./pages/Sites').then((m) => ({ default: m.SitesPage })));
const PermitsPage = lazy(() => import('./pages/Permits').then((m) => ({ default: m.PermitsPage })));
const RenewalPage = lazy(() => import('./pages/Renewal').then((m) => ({ default: m.RenewalPage })));
const MapPage = lazy(() => import('./pages/MapPage').then((m) => ({ default: m.MapPage })));
const SpatialLayersPage = lazy(() => import('./pages/SpatialLayers').then((m) => ({ default: m.SpatialLayersPage })));
const ScreeningPage = lazy(() => import('./pages/Screening').then((m) => ({ default: m.ScreeningPage })));
const QualityPage = lazy(() => import('./pages/Quality').then((m) => ({ default: m.QualityPage })));
const TablesPage = lazy(() => import('./pages/Tables').then((m) => ({ default: m.TablesPage })));
const ReportsPage = lazy(() => import('./pages/Reports').then((m) => ({ default: m.ReportsPage })));
const AboutPage = lazy(() => import('./pages/About').then((m) => ({ default: m.AboutPage })));
const HazardousWastePage = lazy(() => import('./pages/HazardousWaste').then((m) => ({ default: m.HazardousWastePage })));
const ClearancesPage = lazy(() => import('./pages/Clearances').then((m) => ({ default: m.ClearancesPage })));
const EccUltralistPage = lazy(() => import('./pages/EccUltralist').then((m) => ({ default: m.EccUltralistPage })));
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })));
const LegalPage = lazy(() => import('./pages/Legal').then((m) => ({ default: m.LegalPage })));
const PCOCornerPage = lazy(() => import('./pages/PCOCorner').then((m) => ({ default: m.PCOCorner })));
const SolidWastePage = lazy(() => import('./pages/SolidWaste').then((m) => ({ default: m.SolidWastePage })));
const AmbientCornerPage = lazy(() => import('./pages/AmbientCorner').then((m) => ({ default: m.AmbientCornerPage })));
const PixelOfficePage = lazy(() => import('./pages/PixelOfficePage').then((m) => ({ default: m.PixelOfficePage })));

const PAGE_IDS: PageId[] = [
  'overview', 'sites', 'dp', 'pto', 'renewal', 'map',
  'spatial', 'screening', 'quality', 'tables', 'reports', 'about', 'hw', 'swm', 'ambient', 'pixel-office', 'clearances', 'ecc-ultralist', 'admin', 'legal', 'pco-corner',
];

function renderPage(page: PageId) {
  switch (page) {
    case 'sites': return <SitesPage />;
    case 'dp': return <PermitsPage type="DP" />;
    case 'pto': return <PermitsPage type="PTO" />;
    case 'renewal': return <RenewalPage />;
    case 'map': return <MapPage />;
    case 'spatial': return <SpatialLayersPage />;
    case 'screening': return <ScreeningPage />;
    case 'quality': return <QualityPage />;
    case 'tables': return <TablesPage />;
    case 'reports': return <ReportsPage />;
    case 'about': return <AboutPage />;
    case 'hw': return <HazardousWastePage />;
    case 'swm': return <SolidWastePage />;
    case 'ambient': return <AmbientCornerPage />;
    case 'pixel-office': return <PixelOfficePage />;
    case 'clearances': return <ClearancesPage />;
    case 'ecc-ultralist': return <EccUltralistPage />;
    case 'admin': return <AdminPage />;
    case 'legal': return <LegalPage />;
    case 'pco-corner': return <PCOCornerPage />;
    case 'overview':
    default:
      return <OverviewPage />;
  }
}

export default function App() {
  const data = useDashboard((state) => state.data);
  const loading = useDashboard((state) => state.loading);
  const progress = useDashboard((state) => state.progress);
  const error = useDashboard((state) => state.error);
  const page = useDashboard((state) => state.page);
  const setPage = useDashboard((state) => state.setPage);
  const setSessionStore = useDashboard((state) => state.setSession);
  const [session, setSession] = useState<Session | null>(null);
  const [booting, setBooting] = useState(true);

  const [gateOpen, setGateOpen] = useState(false);
  const [exportUser, setExportUser] = useState('');
  const [exportPass, setExportPass] = useState('');
  const [exportError, setExportError] = useState('');
  const [exportBusy, setExportBusy] = useState(false);

useEffect(() => {
  setSessionStore(session);
}, [session, setSessionStore]);

  useEffect(() => {
    return subscribeGate((state) => setGateOpen(state.open));
  }, []);

  const handleExportLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setExportBusy(true);
    setExportError('');
    const ok = await tryGateLogin(exportUser, exportPass);
    setExportBusy(false);
    if (!ok) {
      setExportError('Authorised account required.');
      return;
    }
    setGateOpen(false);
    setExportUser('');
    setExportPass('');
    resolveGate();
  };

  useEffect(() => {
    const onUnauthorized = () => {
      setBooting(false);
      setSession(null);
    };
    window.addEventListener('envis:unauthorized', onUnauthorized);
    return () => window.removeEventListener('envis:unauthorized', onUnauthorized);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // The session lives in an HttpOnly cookie, so the browser cannot read it.
    // Ask the API once on boot and only load data after we know who is signed in.
    loadSession()
      .then((value) => { if (!cancelled) setSession(value); })
      .finally(() => { if (!cancelled) setBooting(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!session) return;
    const load = useDashboard.getState().load;
    load();
  }, [session]);

  useEffect(() => {
    if (session?.role === 'rd' && page === 'reports') {
      setPage('overview');
    }
    if (session && session.role !== 'mis' && page === 'admin') {
      setPage('overview');
    }
  }, [session, page, setPage]);

  useEffect(() => {
    const onHashChange = () => {
      const id = window.location.hash.replace(/^#\//, '') as PageId;
      if (PAGE_IDS.includes(id)) {
        useDashboard.setState({ page: id, selectedSiteId: null });
      }
    };
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  useEffect(() => {
    if (!PAGE_IDS.includes(page)) {
      window.location.hash = '#/overview';
    }
  }, [page]);

  useEffect(() => {
    if (!data) return;
    const builtAt = data.meta.generatedAt;
    const interval = setInterval(async () => {
      try {
        const response = await fetch(dataUrl('meta.json'), { cache: 'no-store', credentials: 'include' });
        if (!response.ok) return;
        const meta = await response.json();
        if (meta?.generatedAt && meta.generatedAt !== builtAt) {
          window.location.reload();
        }
      } catch {
        /* network blip: ignore */
      }
    }, 60000);
    return () => clearInterval(interval);
  }, [data]);

  if (booting) {
    return (
      <div className="app-shell grid-noise grid min-h-screen place-items-center px-6">
        <div className="relative z-10 w-full max-w-sm text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-ink-950 shadow-glow">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8 7 5 10.5 5 14a7 7 0 0 0 14 0c0-3.5-3-7-7-12Z" />
              <path d="M9 14c0 1.7 1.3 3 3 3" />
            </svg>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="text-[19px] font-extrabold tracking-tight text-slate-50">ENVIS</span>
            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Region VII</span>
          </div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-600">DENR-EMB Central Visayas</p>
          <p className="mt-6 text-[11px] text-slate-500">Checking your session…</p>
        </div>
      </div>
    );
  }

  if (!session) {
    return <LoginGate onLogin={setSession} />;
  }

  if (error && !data) {
    return (
      <div className="app-shell grid-noise grid min-h-screen place-items-center px-6">
        <div className="card relative z-10 w-full max-w-md p-6 text-center">
          <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-rose-400/10 text-rose-300 ring-1 ring-rose-400/20">
            <AlertTriangle size={20} />
          </div>
          <h1 className="mt-3 text-[16px] font-semibold text-slate-100">Dataset could not be loaded</h1>
          <p className="mt-1 text-[12px] leading-relaxed text-slate-500">{error}</p>
          <p className="mt-2 text-[10.5px] leading-relaxed text-slate-600">
            Run <span className="kbd">npm run data:all</span> to rebuild the static dataset, then reload this page.
          </p>
          <button type="button" className="btn btn-primary mt-4 w-full" onClick={() => window.location.reload()}>
            <RefreshCw size={13} /> Reload
          </button>
        </div>
      </div>
    );
  }

  if (!data || loading) {
    return (
      <div className="app-shell grid-noise grid min-h-screen place-items-center px-6">
        <div className="relative z-10 w-full max-w-sm text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-ink-950 shadow-glow">
            <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M12 2C8 7 5 10.5 5 14a7 7 0 0 0 14 0c0-3.5-3-7-7-12Z" />
              <path d="M9 14c0 1.7 1.3 3 3 3" />
            </svg>
          </div>
          <div className="mt-4 flex items-center justify-center gap-2">
            <span className="text-[19px] font-extrabold tracking-tight text-slate-50">ENVIS</span>
            <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Region VII</span>
          </div>
          <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-600">DENR-EMB Central Visayas</p>
          <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-emerald-500/20 via-emerald-300 to-emerald-500/20" style={{ backgroundSize: '400px 100%' }} />
          </div>
          <p className="mt-2 text-[11px] text-slate-500">{progress || 'Preparing dashboard…'}</p>
          <div className="mt-6 grid grid-cols-3 gap-2">
            {[0, 1, 2].map((index) => (
              <div key={index} className="h-14 animate-pulse rounded-xl border border-white/[0.05] bg-white/[0.025]" style={{ animationDelay: `${index * 120}ms` }} />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const PageLoading = () => (
  <div className="app-shell grid-noise grid min-h-screen place-items-center px-6">
    <div className="relative z-10 w-full max-w-sm text-center">
      <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-emerald-400 to-teal-600 text-ink-950 shadow-glow">
        <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M12 2C8 7 5 10.5 5 14a7 7 0 0 0 14 0c0-3.5-3-7-7-12Z" />
          <path d="M9 14c0 1.7 1.3 3 3 3" />
        </svg>
      </div>
      <div className="mt-4 flex items-center justify-center gap-2">
        <span className="text-[19px] font-extrabold tracking-tight text-slate-50">ENVIS</span>
        <span className="rounded bg-emerald-400/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-300">Region VII</span>
      </div>
      <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-600">DENR-EMB Central Visayas</p>
      <div className="mt-6 h-1 w-full overflow-hidden rounded-full bg-white/[0.06]">
        <div className="h-full w-1/3 animate-shimmer rounded-full bg-gradient-to-r from-emerald-500/20 via-emerald-300 to-emerald-500/20" style={{ backgroundSize: '400px 100%' }} />
      </div>
      <p className="mt-2 text-[11px] text-slate-500">Loading page…</p>
    </div>
  </div>
);

return (
    <>
      <Layout session={session} onLogout={() => setSession(null)}>
        <Suspense fallback={<PageLoading />}>
          <ErrorBoundary resetKey={page}>{renderPage(page)}</ErrorBoundary>
        </Suspense>
      </Layout>
      <SiteDrawer />
      {gateOpen && (
        <div className="fixed inset-0 z-[1000] grid place-items-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-sm p-6">
            <h2 className="text-[15px] font-bold text-slate-50">{gateOpen && getPendingKind() === "geojson" ? "GIS login required" : "Exporter login required"}</h2>
            <p className="mt-1 text-[11px] text-slate-500">{gateOpen && getPendingKind() === "geojson" ? "Only the GIS account can download GeoJSON layers." : "Only the data extraction account can export data."}</p>
            <form onSubmit={handleExportLogin} className="mt-4 space-y-3">
              <input type="text" value={exportUser} onChange={(e) => setExportUser(e.target.value)} placeholder="Username" autoComplete="username" required className="input h-9 w-full" />
              <input type="password" value={exportPass} onChange={(e) => setExportPass(e.target.value)} placeholder="Password" autoComplete="current-password" required className="input h-9 w-full" />
              {exportError && <div className="rounded-lg border border-rose-400/30 bg-rose-400/10 px-3 py-2 text-[11px] text-rose-200">{exportError}</div>}
              <div className="flex gap-2">
                <button type="button" onClick={() => { cancelGate(); setGateOpen(false); setExportUser(''); setExportPass(''); setExportError(''); }} className="btn h-9 flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={exportBusy} className="btn btn-primary h-9 flex-1 justify-center">{exportBusy ? 'Signing in…' : 'Sign in'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
