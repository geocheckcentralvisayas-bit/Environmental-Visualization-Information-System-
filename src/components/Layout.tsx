import { useEffect, useState } from 'react';
import {
  Building2, CalendarClock, ChevronRight, ClipboardCheck, Database, Droplets, FileDown,
  FileCheck2, FlaskConical, Gavel, Info, LayoutDashboard, Layers3, ListChecks, Map as MapIcon, Menu, PanelLeftClose,
  Search, ShieldAlert, ShieldCheck, Table2, X, ExternalLink, Radio, Sun, Moon, Recycle, Wind,
} from 'lucide-react';
import clsx from 'clsx';
import { useDashboard, useFilteredPermits, useFilteredSites } from '../store/useDashboard';
import type { PageId } from '../types';
import { logout } from '../lib/auth';
import type { Session } from '../lib/auth';
import { formatDateTime } from '../lib/format';
import { APP_VERSION, EMB_R7_URL, VERSION_LABEL } from '../lib/version';

const NAV: { group: string; items: { id: PageId; label: string; icon: typeof LayoutDashboard; badge?: string }[] }[] = [
  { group: 'Monitor', items: [
    { id: 'overview', label: 'Overview', icon: LayoutDashboard },
    { id: 'ambient', label: 'Ambient Corner', icon: Wind },
  ] },
  {
    group: 'Permits',
    items: [
      { id: 'dp', label: 'Discharge Permits', icon: Droplets },
      { id: 'pto', label: 'Permit to Operate', icon: ClipboardCheck },
      { id: 'renewal', label: 'Renewal Watch', icon: CalendarClock },
    ],
  },
  {
    group: 'Establishments',
    items: [
      { id: 'sites', label: 'DP · PTO Intercross', icon: Building2 },
      { id: 'map', label: 'Spatial Map', icon: MapIcon },
    ],
  },
  {
    group: 'Geospatial',
    items: [
      { id: 'spatial', label: 'Layers & Overlays', icon: Layers3 },
      { id: 'screening', label: 'Spatial Screening', icon: ShieldAlert },
    ],
  },
  {
    group: 'Data',
    items: [
      { id: 'quality', label: 'Data Quality', icon: ListChecks },
      { id: 'tables', label: 'Data Tables', icon: Table2 },
      { id: 'reports', label: 'Reports & Export', icon: FileDown },
    ],
  },
  {
    group: 'Compliance',
    items: [
      { id: 'hw', label: 'Hazardous Waste', icon: FlaskConical },
      { id: 'swm', label: 'Solid Waste Management (SWM)', icon: Recycle },
      { id: 'clearances', label: 'ECC & CNC', icon: FileCheck2 },
      { id: 'ecc-ultralist', label: 'ECC & CNC Ultralist', icon: FileCheck2 },
    ],
  },
  {
    group: 'Enforcement',
    items: [{ id: 'legal', label: 'NOV & Legal Cases', icon: Gavel }],
  },
  {
    group: 'Compliance Officers',
    items: [{ id: 'pco-corner', label: 'PCO Corner', icon: ShieldAlert }],
  },
  {
    group: 'Administration',
    items: [
      { id: 'admin', label: 'Accounts & Activity', icon: ShieldCheck },
      { id: 'about', label: 'About & License', icon: Info },
    ],
  },
];

const PAGE_META: Record<PageId, { title: string; subtitle: string }> = {
  overview: { title: 'Executive overview', subtitle: 'Environmental permits and establishment coverage across Central Visayas' },
  sites: { title: 'DP · PTO intercross', subtitle: 'Establishments matched across discharge permits and permits to operate' },
  dp: { title: 'Discharge permits', subtitle: 'Wastewater discharge permits issued by DENR-EMB Region VII' },
  pto: { title: 'Permits to operate', subtitle: 'Permits to operate for pollution-control and wastewater facilities' },
  renewal: { title: 'Renewal watch', subtitle: 'Expiring and recently lapsed permits that need follow-up' },
  map: { title: 'Spatial map', subtitle: 'Clustered establishments, permits and DENR spatial overlays' },
  spatial: { title: 'Layers & overlays', subtitle: 'Hazard, protected-area, watershed and land-cover layers' },
  screening: { title: 'Spatial screening', subtitle: 'Permit exposure to flood, landslide and protected-area constraints' },
  quality: { title: 'Data quality', subtitle: 'Normalisation, duplicate handling and review queues' },
  tables: { title: 'Data tables', subtitle: 'Browse the complete normalised registers' },
  reports: { title: 'Reports & export', subtitle: 'Generate filtered datasets and summary reports' },
  about: { title: 'About & license', subtitle: 'Methodology, credits, DENR directory and version history' },
  hw: { title: 'Hazardous waste register', subtitle: 'Hazardous-waste generators, waste streams and compliance status' },
  swm: { title: 'Solid waste management', subtitle: 'MRF status, disposal facilities and LGU coverage across Central Visayas' },
  ambient: { title: 'Ambient corner', subtitle: 'Air quality monitoring — live and historical PM2.5, PM10 and manual AQI' },
  clearances: { title: 'ECC & CNC clearances', subtitle: 'Environmental compliance and non-coverage certificates cross-referenced with DP and PTO' },
  'ecc-ultralist': { title: 'ECC & CNC ultralist', subtitle: 'Approved EIA clearances for Cebu and Bohol intercrossed with DP, PTO and hazardous waste' },
  admin: { title: 'Accounts & activity', subtitle: 'MIS account management and sign-in / export activity log' },
  legal: { title: 'NOV & legal cases', subtitle: 'Notices of violation, PAB cases, ERF payments and complaints intercrossed with DP, PTO and hazardous-waste establishments' },
  'pco-corner': { title: 'PCO Corner', subtitle: 'Pollution Control Officers cross-referenced with permits, hazardous waste, and clearances' },
};

export function Layout({ children, session, onLogout }: { children: React.ReactNode; session?: Session | null; onLogout?: () => void }) {
  const page = useDashboard((state) => state.page);
  const setPage = useDashboard((state) => state.setPage);
  const meta = useDashboard((state) => state.data?.meta);
  const filters = useDashboard((state) => state.filters);
  const setFilters = useDashboard((state) => state.setFilters);
  const resetFilters = useDashboard((state) => state.resetFilters);
  const permits = useFilteredPermits();
  const sites = useFilteredSites();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [theme, setTheme] = useState<'dark' | 'light'>(() => (localStorage.getItem('envis.theme') as 'dark' | 'light') || 'dark');
  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('envis.theme', theme);
  }, [theme]);

  useEffect(() => {
    const active = document.querySelector('nav button.active');
    active?.scrollIntoView({ block: 'nearest' });
  }, [page]);
  const pageMeta = PAGE_META[page] ?? PAGE_META.overview;

  const navigate = (id: PageId) => {
    setPage(id);
    setMobileOpen(false);
  };

  return (
    <div className="app-shell grid-noise relative flex min-h-screen">
      {mobileOpen && (
        <button type="button" aria-label="Close navigation" className="fixed inset-0 z-[900] bg-black/60 backdrop-blur-sm md:hidden" onClick={() => setMobileOpen(false)} />
      )}

      <aside
        className={clsx(
          'no-print fixed inset-y-0 left-0 z-[950] flex w-[248px] flex-col border-r border-white/[0.06] bg-ink-950/95 backdrop-blur-xl transition-transform duration-200 md:sticky md:top-0 md:h-screen md:translate-x-0',
          mobileOpen ? 'translate-x-0' : '-translate-x-full',
          collapsed && 'md:w-[76px]',
        )}
      >
        <div className={clsx('flex h-[60px] shrink-0 items-center gap-2.5 border-b border-white/[0.06] px-4', collapsed && 'md:justify-center md:px-2')}>
          <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/5 ring-1 ring-white/10 overflow-hidden">
            <img src={`${import.meta.env.BASE_URL}assets/denr-logo.png`} alt="DENR" className="h-8 w-8 object-contain animate-logo" />
          </div>
          <div className={clsx('min-w-0', collapsed && 'md:hidden')}>
            <div className="flex items-center gap-1.5">
              <span className="text-[15px] font-extrabold tracking-tight text-slate-50">ENVIS</span>
              <span className="rounded bg-emerald-400/15 px-1 py-px text-[8px] font-bold uppercase tracking-wider text-emerald-300">R7</span>
            </div>
            <div className="truncate text-[9.5px] uppercase tracking-[0.14em] text-slate-500">DENR-EMB Central Visayas</div>
          </div>
          <button type="button" className="ml-auto hidden rounded-md p-1 text-slate-600 hover:bg-white/5 hover:text-slate-300 md:block" onClick={() => setCollapsed((value) => !value)}>
            <PanelLeftClose size={14} className={clsx(collapsed && 'rotate-180')} />
          </button>
          <button type="button" className="ml-auto rounded-md p-1 text-slate-500 md:hidden" onClick={() => setMobileOpen(false)}>
            <X size={17} />
          </button>
        </div>

        <nav className="scroll-thin flex-1 overflow-y-auto px-2.5 py-2">
          {NAV.map((section) => (
            <div key={section.group} className="mb-2">
              <div className={clsx('px-2 pb-1 text-[8.5px] font-bold uppercase tracking-[0.19em] text-slate-600', collapsed && 'md:hidden')}>{section.group}</div>
              <div className="space-y-0.5">
                {section.items.filter((item) => !(session?.role === 'rd' && item.id === 'reports') && !(item.id === 'admin' && session?.role !== 'mis')).map((item) => {
                  const Icon = item.icon;
                  const active = page === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => navigate(item.id)}
                      className={clsx('sidebar-link w-full', active && 'active', collapsed && 'md:justify-center md:px-0')}
                      title={item.label}
                    >
                      <Icon size={15} strokeWidth={2} className="nav-icon shrink-0 text-slate-500" />
                      <span className={clsx('min-w-0 flex-1 text-left', collapsed ? 'truncate md:hidden' : 'leading-[1.2]')}>{item.label}</span>
                      {active && <ChevronRight size={12} className={clsx('text-emerald-400/70', collapsed && 'md:hidden')} />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </nav>

        <div className={clsx('shrink-0 border-t border-white/[0.06] p-3', collapsed && 'md:px-2')}>
          <div className={clsx('rounded-xl border border-emerald-400/15 bg-emerald-400/[0.045] p-2.5', collapsed && 'md:hidden')}>
            <div className="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.13em] text-emerald-300/80">
              <Radio size={10} className="animate-pulse" /> Dataset live
            </div>
            <div className="mt-1 text-[9.5px] leading-relaxed text-slate-500">
              Reference {meta?.referenceDate ?? '—'}
              <br />
              Fetched {meta ? formatDateTime(meta.sources.fetchedAt) : '—'}
            </div>
          </div>
          {session && (
            <div className={clsx('mt-2 flex items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-1.5', collapsed && 'md:justify-center md:px-1')}>
              <div className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-emerald-400/15 text-[9px] font-bold text-emerald-300">
                {session.displayName.slice(0, 1).toUpperCase()}
              </div>
              <div className={clsx('min-w-0 flex-1', collapsed && 'md:hidden')}>
                <div className="truncate text-[10px] font-semibold text-slate-200">{session.displayName}</div>
                <div className="truncate text-[8.5px] text-slate-500">{session.division}</div>
              </div>
              <button type="button" onClick={() => { logout(); onLogout?.(); }} className="shrink-0 rounded-md p-1 text-slate-500 hover:bg-white/5 hover:text-rose-300" title="Sign out">
                <X size={12} />
              </button>
            </div>
          )}
          <div className={clsx('mt-2 flex items-center justify-between px-1 text-[9px] text-slate-600', collapsed && 'md:justify-center')}>
            <a
              href={EMB_R7_URL}
              target="_blank"
              rel="noreferrer"
              className={clsx('hover:text-slate-400', collapsed && 'md:hidden')}
              title="DENR-EMB Region VII"
            >
              Build {APP_VERSION} · Authorized
            </a>
            <a href={EMB_R7_URL} target="_blank" rel="noreferrer" className="hover:text-slate-400" title="DENR-EMB Region VII">
              <ExternalLink size={11} />
            </a>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-[800] border-b border-white/[0.06] bg-[#050d0b]/85 backdrop-blur-xl">
          <div className="flex h-[60px] items-center gap-3 px-3 sm:px-5">
            <button type="button" onClick={() => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))} className="btn btn-ghost h-8 w-8 p-0" title="Toggle theme">
              {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-[15px] font-semibold tracking-tight text-slate-100">{pageMeta.title}</h1>
                <span className="hidden rounded-full border border-emerald-400/20 bg-emerald-400/10 px-1.5 py-px text-[8.5px] font-bold uppercase tracking-wider text-emerald-300 lg:inline">Region VII</span>
              </div>
              <p className="truncate text-[10.5px] text-slate-500">{pageMeta.subtitle}</p>
            </div>
            {page !== 'swm' && page !== 'ambient' && (
            <div className="relative hidden w-[240px] shrink-0 sm:block lg:w-[300px]">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input
                className="input h-8 pl-7 pr-7 text-[11.5px]"
                placeholder="Search company, permit, LGU…"
                value={filters.search}
                onChange={(event) => setFilters({ search: event.target.value })}
              />
              {filters.search && (
                <button type="button" className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-500 hover:text-slate-200" onClick={() => setFilters({ search: '' })}>
                  <X size={12} />
                </button>
              )}
            </div>
            )}
            <div className="hidden items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.025] px-2.5 py-1.5 text-[10px] text-slate-400 xl:flex">
              <Database size={12} className="text-emerald-400" />
              <span className="font-mono tabular-nums">{permits.length.toLocaleString()}</span> permits
              <span className="text-slate-700">/</span>
              <span className="font-mono tabular-nums">{sites.length.toLocaleString()}</span> sites
            </div>
          </div>

          <div className={clsx('flex items-center gap-1.5 overflow-x-auto border-t border-white/[0.05] px-3 py-2 sm:px-5', (page === 'swm' || page === 'ambient') && 'hidden')}>
            <span className="mr-1 hidden shrink-0 text-[9px] font-bold uppercase tracking-[0.16em] text-slate-600 sm:block">Filters</span>
            <select className="select h-7 w-auto min-w-[92px] text-[10.5px]" value={String(filters.year)} onChange={(event) => setFilters({ year: event.target.value === 'all' ? 'all' : Number(event.target.value) })}>
              <option value="all">All years</option>
              {meta?.years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <select className="select h-7 w-auto min-w-[104px] text-[10.5px]" value={filters.province} onChange={(event) => setFilters({ province: event.target.value })}>
              <option value="all">All provinces</option>
              {meta?.provinces.filter((entry) => entry.name !== '').map((entry) => <option key={entry.name} value={entry.name}>{entry.name}</option>)}
            </select>
            <select className="select h-7 w-auto min-w-[96px] text-[10.5px]" value={filters.lifecycle} onChange={(event) => setFilters({ lifecycle: event.target.value })}>
              <option value="all">All statuses</option>
              <option value="Active">Active</option>
              <option value="Expiring">Expiring</option>
              <option value="Expired">Expired</option>
              <option value="Unknown">Unknown</option>
            </select>
            <select className="select h-7 w-auto min-w-[88px] text-[10.5px]" value={filters.type} onChange={(event) => setFilters({ type: event.target.value as typeof filters.type })}>
              <option value="all">DP + PTO</option>
              <option value="DP">DP only</option>
              <option value="PTO">PTO only</option>
            </select>
            <select className="select h-7 w-auto min-w-[92px] text-[10.5px]" value={filters.scope} onChange={(event) => setFilters({ scope: event.target.value as typeof filters.scope })}>
              <option value="in">In scope</option>
              <option value="all">All regions</option>
              <option value="out">Out of scope</option>
            </select>
            {(filters.year !== 'all' || filters.province !== 'all' || filters.lifecycle !== 'all' || filters.type !== 'all' || filters.scope !== 'in' || filters.search) && (
              <button type="button" className="btn btn-ghost h-7 shrink-0 px-2 text-[10px]" onClick={resetFilters}>
                <X size={11} /> Clear
              </button>
            )}
            <div className="ml-auto hidden shrink-0 items-center gap-1 text-[9.5px] text-slate-600 lg:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
              {meta?.totals.screened.toLocaleString()} permits spatially screened
            </div>
          </div>
          <div className={clsx('px-3 pb-2 sm:hidden', (page === 'swm' || page === 'ambient') && 'hidden')}>
            <div className="relative">
              <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-500" />
              <input className="input h-8 pl-7" placeholder="Search company, permit, LGU…" value={filters.search} onChange={(event) => setFilters({ search: event.target.value })} />
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-5">{children}</main>

        <footer className="no-print border-t border-white/[0.05] px-5 py-3 text-[9.5px] text-slate-600">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span>
              ENVIS Region VII · Environmental permits monitoring · {VERSION_LABEL} · © 2026 Kent Agbayani (K3nt-Bytes)
            </span>
            <span>
              Sources: DENR-EMB Region VII registers · PSGC 2026 · DENR spatial layers ·{' '}
              <a href={EMB_R7_URL} target="_blank" rel="noreferrer" className="hover:text-slate-400">r7.emb.gov.ph</a>
            </span>
          </div>
        </footer>
      </div>
    </div>
  );
}
