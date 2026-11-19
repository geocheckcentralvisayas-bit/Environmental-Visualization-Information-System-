import { useMemo } from 'react';
import { Building2, Droplets, Gavel, Layers3, Recycle, ShieldAlert } from 'lucide-react';
import { useDashboard, useFilteredFacilities, useFilteredPermits } from '../store/useDashboard';
import { MapView } from '../components/MapView';
import { Chip, SectionHeading } from '../components/ui';
import { formatNumber } from '../lib/format';

export function MapPage() {
  const data = useDashboard((state) => state.data);
  const facilities = useFilteredFacilities();
  const permits = useFilteredPermits();
  const legal = data?.legal;
  const swm = useDashboard((state) => state.swm);

  const stats = useMemo(() => {
    const geocoded = facilities.filter((facility) => facility.lat !== null && facility.lon !== null).length;
    const flagged = facilities.filter((facility) => facility.risk >= 4).length;
    const scoped = permits.filter((permit) => permit.scope === 'in').length;
    const multi = facilities.filter((facility) => facility.registers.length > 1).length;
    const legalFacilities = legal?.totals.facilitiesWithLegal ?? 0;
    const legalOpen = legal?.totals.openEntities ?? 0;
    return { geocoded, flagged, scoped, multi, legalFacilities, legalOpen };
  }, [facilities, permits, legal]);

  if (!data) return null;

  return (
    <div className="animate-fade-up space-y-3">
      <SectionHeading
        eyebrow="Geospatial monitor"
        title="Establishment and permit map"
        description="One marker per establishment at one location. The ring around a marker shows which registers it holds — DP, PTO, hazardous waste, ECC or CNC — so a single point carries every record for that address."
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="emerald"><Building2 size={10} /> {formatNumber(stats.geocoded)} facilities</Chip>
            <Chip tone="amber"><Layers3 size={10} /> {formatNumber(stats.multi)} multi-register</Chip>
            <Chip tone="sky"><Droplets size={10} /> {formatNumber(permits.length)} permits</Chip>
            <Chip tone="rose"><ShieldAlert size={10} /> {formatNumber(stats.flagged)} flagged</Chip>
            {stats.legalFacilities > 0 && (
              <Chip tone="violet">
                <Gavel size={10} /> {formatNumber(stats.legalFacilities)} legal cases
                {stats.legalOpen > 0 ? ` · ${formatNumber(stats.legalOpen)} open` : ''}
              </Chip>
            )}
            <Chip tone="amber">
              <Recycle size={10} /> {formatNumber(swm?.summary.facilities ?? 0)} MRFs · {formatNumber(swm?.disposal.projects.length ?? 0)} disposal sites
            </Chip>
          </div>
        }
      />

      <MapView
        height="clamp(540px, calc(100vh - 196px), 1300px)"
        initialMode="companies"
        initialBasemap="satellite"
        initialLayers={['flooding', 'landslide']}
        showPoints
        showLayerPanel
      />

      <div className="grid gap-2 text-[10.5px] text-slate-500 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <b className="text-slate-300">Registers.</b> Each marker merges every register held by the same establishment at the same address; the coloured ring shows DP, PTO, HW, ECC and CNC coverage. Open a row from any table with <b className="text-slate-300">Map</b> to fly straight to it.
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <b className="text-slate-300">Clustering.</b> Markers group until zoom 14, then expand individually. Use the points switch to compare the merged register view with individual permit records.
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <b className="text-slate-300">Overlays.</b> Heavy layers are downloaded the first time they are enabled; subsequent toggles reuse the cached GeoJSON.
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <b className="text-slate-300">Solid waste points.</b> Switch <b className="text-slate-300">Points → Solid waste</b> to plot MRF facilities and ECC/CNC-approved landfills, dumpsites and transfer stations. Scope is Cebu and Bohol, matching the rest of the dashboard.
        </div>
        <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] px-3 py-2">
          <b className="text-slate-300">Legal docket.</b> A second ring marks establishments named in an NOV, PAB case, ERF payment or complaint — red open, green closed, amber partly closed. The popup's <b className="text-slate-300">View docket</b> opens the full case list. Only exact facility coordinates are plotted; respondents with no register match stay off the map.
        </div>
      </div>
    </div>
  );
}
