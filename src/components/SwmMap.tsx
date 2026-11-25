import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { Layers3, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { escapeHtml } from '../lib/format';
import { BASEMAPS as SHARED_BASEMAPS } from '../lib/basemaps';
import type { SwmDisposalProject, SwmFacility } from '../types';

const BASEMAPS = {
  streets: SHARED_BASEMAPS.streets,
  satellite: SHARED_BASEMAPS.satellite,
} as const;

type BasemapId = keyof typeof BASEMAPS;

const STATUS_COLOR = {
  Operational: '#34d399',
  'Non-Operational': '#fb7185',
} as const;

const DISPOSAL_META = {
  landfill: { label: 'Sanitary landfill', color: '#fbbf24' },
  dumpsite: { label: 'Dumpsite / waste dump', color: '#fb923c' },
  transfer: { label: 'Transfer station', color: '#a78bfa' },
} as const;

export function swmFacilityPopup(facility: SwmFacility): string {
  const barangays = facility.barangays.length
    ? facility.barangays.join(', ')
    : 'Barangay not recorded';
  const note = facility.coordNote
    ? `<div class="swm-popup-note">${escapeHtml(facility.coordNote)}</div>`
    : '';
  return `
    <div class="swm-popup">
      <div class="swm-popup-head">
        <span class="swm-popup-dot" style="background:${STATUS_COLOR[facility.status]}"></span>
        <strong>${escapeHtml(facility.lgu)}</strong>
        <span class="swm-popup-province">${escapeHtml(facility.province)}</span>
      </div>
      <div class="swm-popup-row"><b>Status</b><span style="color:${STATUS_COLOR[facility.status]}">${escapeHtml(facility.status)}</span></div>
      <div class="swm-popup-row"><b>Barangay(s)</b><span>${escapeHtml(barangays)}</span></div>
      <div class="swm-popup-row"><b>IIS txn</b><span class="mono">${escapeHtml(facility.key)}</span></div>
      ${facility.lat !== null && facility.lon !== null
        ? `<div class="swm-popup-row"><b>Coordinates</b><span class="mono">${facility.lat.toFixed(5)}, ${facility.lon.toFixed(5)}</span></div>`
        : ''}
      ${note}
    </div>`;
}

export function swmDisposalPopupFor(project: SwmDisposalProject): string {
  const meta = DISPOSAL_META[project.category];
  return `
    <div class="swm-popup">
      <div class="swm-popup-head">
        <span class="swm-popup-dot" style="background:${meta.color}"></span>
        <strong>${escapeHtml(project.lgu)}</strong>
        <span class="swm-popup-province">${escapeHtml(project.province)}</span>
      </div>
      <div class="swm-popup-row"><b>Facility</b><span>${escapeHtml(project.name)}</span></div>
      <div class="swm-popup-row"><b>Category</b><span style="color:${meta.color}">${escapeHtml(meta.label)}</span></div>
      <div class="swm-popup-row"><b>Proponent</b><span>${escapeHtml(project.proponent || 'â€”')}</span></div>
      <div class="swm-popup-row"><b>${escapeHtml(project.kind || 'Reference')}</b><span class="mono">${escapeHtml(project.ref)}</span></div>
      <div class="swm-popup-row"><b>Approval</b><span>${escapeHtml(project.status || 'â€”')}${project.year ? ` Â· ${project.year}` : ''}</span></div>
      ${project.lat !== null && project.lon !== null
        ? `<div class="swm-popup-row"><b>Coordinates</b><span class="mono">${project.lat.toFixed(5)}, ${project.lon.toFixed(5)}</span></div>`
        : ''}
      <div class="swm-popup-note">Source: ECC/CNC ultralist â€” an approval record, not an operating status.</div>
    </div>`;
}

export function SwmMap({
  facilities,
  disposal = [],
  height = 520,
}: {
  facilities: SwmFacility[];
  disposal?: SwmDisposalProject[];
  height?: number | string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const clusterRef = useRef<L.LayerGroup | null>(null);
  const disposalRef = useRef<L.LayerGroup | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('streets');
  const [showMrf, setShowMrf] = useState(true);
  const [showDisposal, setShowDisposal] = useState(true);
  const [ready, setReady] = useState(false);

  const mappedDisposal = disposal.filter((project) => project.lat !== null && project.lon !== null);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [10.2, 123.7],
      zoom: 8,
      zoomControl: false,
      attributionControl: true,
      // SVG renderer: the map mounts twice under StrictMode, and a canvas
      // renderer can be disposed mid-animation ("clearRect of undefined").
      preferCanvas: false,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    mapRef.current = map;
    setReady(true);
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    return () => {
      resize.disconnect();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const config = BASEMAPS[basemap];
    tileRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: 'maxZoom' in config ? config.maxZoom : 20,
      maxNativeZoom: 'maxNativeZoom' in config ? config.maxNativeZoom : undefined,
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [basemap, ready]);

  // MRF layer
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (clusterRef.current) {
      map.removeLayer(clusterRef.current);
      clusterRef.current = null;
    }
    if (!showMrf) return;

    const plottable = facilities.filter((facility) => facility.lat !== null && facility.lon !== null);
    if (!plottable.length) return;

    const group = (L as unknown as {
      markerClusterGroup: (options: Record<string, unknown>) => L.LayerGroup;
    }).markerClusterGroup({
      showCoverageOnHover: false,
      spiderfyOnMaxZoom: true,
      maxClusterRadius: 44,
      iconCreateFunction: (cluster: { getChildCount: () => number }) => {
        const count = cluster.getChildCount();
        const size = count < 10 ? 28 : count < 50 ? 34 : 40;
        return L.divIcon({
          html: `<div class="cluster-bubble"><span>${count}</span></div>`,
          className: '',
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        });
      },
    });

    for (const facility of plottable) {
      const marker = L.circleMarker([facility.lat as number, facility.lon as number], {
        radius: facility.barangays.length > 1 ? 7 : 5.5,
        color: '#f8fafc',
        weight: 1.2,
        fillColor: STATUS_COLOR[facility.status],
        fillOpacity: 0.94,
      });
      marker.bindPopup(swmFacilityPopup(facility), { maxWidth: 330, minWidth: 250 });
      (group as unknown as { addLayer: (layer: L.Layer) => void }).addLayer(marker);
    }

    group.addTo(map);
    clusterRef.current = group;
  }, [facilities, ready, showMrf]);

  // Disposal layer (ECC/CNC approvals), drawn above the MRF clusters.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (disposalRef.current) {
      map.removeLayer(disposalRef.current);
      disposalRef.current = null;
    }
    if (!showDisposal || !mappedDisposal.length) return;

    const group = L.layerGroup();
    for (const project of mappedDisposal) {
      const meta = DISPOSAL_META[project.category];
      const marker = L.circleMarker([project.lat as number, project.lon as number], {
        radius: 7,
        color: '#0b1411',
        weight: 2,
        fillColor: meta.color,
        fillOpacity: 0.96,
      });
      marker.bindPopup(swmDisposalPopupFor(project), { maxWidth: 350, minWidth: 270 });
      marker.bindTooltip(meta.label, { direction: 'top', offset: [0, -6] });
      group.addLayer(marker);
    }
    group.addTo(map);
    disposalRef.current = group;
  }, [mappedDisposal, ready, showDisposal]);

  // Fit the view once both layers are known.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const points: Array<[number, number]> = [];
    if (showMrf) {
      for (const facility of facilities) {
        if (facility.lat !== null && facility.lon !== null) points.push([facility.lat, facility.lon]);
      }
    }
    if (showDisposal) {
      for (const project of mappedDisposal) points.push([project.lat as number, project.lon as number]);
    }
    if (!points.length) return;
    const bounds = L.latLngBounds(points);
    if (bounds.isValid() && mapRef.current === map) {
      map.fitBounds(bounds.pad(0.12), { maxZoom: 10, animate: false });
    }
  }, [facilities, mappedDisposal, showMrf, showDisposal, ready]);

  const plottable = facilities.filter((facility) => facility.lat !== null && facility.lon !== null).length;
  const unplotted = facilities.length - plottable;

  return (
    <div className="relative overflow-hidden rounded-xl border border-white/[0.06]">
      <div ref={containerRef} style={{ height }} className="z-0 w-full" />

      <div className="pointer-events-none absolute left-3 top-3 z-[500] flex flex-col gap-1.5">
        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-ink-950/90 p-1 backdrop-blur">
          <Layers3 size={12} className="ml-1 text-slate-500" />
          {(Object.keys(BASEMAPS) as BasemapId[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => setBasemap(key)}
              className={clsx(
                'rounded px-2 py-1 text-[10px] font-semibold transition',
                basemap === key ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-400 hover:text-slate-200',
              )}
            >
              {BASEMAPS[key].label}
            </button>
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-1 rounded-lg border border-white/10 bg-ink-950/90 p-1 backdrop-blur">
          <button
            type="button"
            onClick={() => setShowMrf((value) => !value)}
            className={clsx(
              'rounded px-2 py-1 text-[10px] font-semibold transition',
              showMrf ? 'bg-emerald-400/15 text-emerald-300' : 'text-slate-500 hover:text-slate-300',
            )}
          >
            MRF
          </button>
          <button
            type="button"
            onClick={() => setShowDisposal((value) => !value)}
            className={clsx(
              'rounded px-2 py-1 text-[10px] font-semibold transition',
              showDisposal ? 'bg-amber-400/15 text-amber-300' : 'text-slate-500 hover:text-slate-300',
            )}
          >
            Disposal
          </button>
        </div>

        <div className="pointer-events-auto rounded-lg border border-white/10 bg-ink-950/90 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400 backdrop-blur">
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-400" /> Operational MRF</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-rose-400" /> Non-operational MRF</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-amber-400" /> Sanitary landfill</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-orange-400" /> Dumpsite / waste dump</div>
          <div className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-violet-400" /> Transfer station</div>
          <div className="mt-1 border-t border-white/10 pt-1 text-slate-500">
            <MapPin size={9} className="mr-1 inline" />
            {plottable} MRF{unplotted ? ` (${unplotted} without coordinates)` : ''}
            {mappedDisposal.length ? ` Â· ${mappedDisposal.length} disposal` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
