import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Layers3, MapPin } from 'lucide-react';
import clsx from 'clsx';
import { escapeHtml } from '../lib/format';
import type { AqmsManualRecord, AqmsReading, AqmsStation } from '../types';

const BASEMAPS = {
  streets: {
    label: 'Streets',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, HERE, Garmin, OpenStreetMap contributors',
  },
  satellite: {
    label: 'Satellite',
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
} as const;

type BasemapId = keyof typeof BASEMAPS;

export const AQMS_COLORS = {
  GOOD: '#20A66A',
  FAIR: '#F4C430',
  'UNHEALTHY FOR SENSITIVE GROUPS': '#F28C28',
  UNHEALTHY: '#F28C28',
  'VERY UNHEALTHY': '#E9424D',
  'ACUTELY UNHEALTHY': '#B4232B',
  EMERGENCY: '#7B3FB2',
} as const;

export function aqmsColor(status: string): string {
  const key = String(status ?? '').toUpperCase();
  return AQMS_COLORS[key as keyof typeof AQMS_COLORS] ?? '#94a3b8';
}

function latestReading(readings: AqmsReading[], station: string): AqmsReading | null {
  let latest: AqmsReading | null = null;
  for (const reading of readings) {
    if (reading.station !== station) continue;
    if (!latest || reading.timestamp > latest.timestamp) latest = reading;
  }
  return latest;
}

function latestManual(records: AqmsManualRecord[], station: string): AqmsManualRecord | null {
  let latest: AqmsManualRecord | null = null;
  for (const record of records) {
    if (record.station !== station) continue;
    if (!latest || record.date > latest.date) latest = record;
  }
  return latest;
}

function popupFor(station: AqmsStation, reading: AqmsReading | null, manual: AqmsManualRecord | null): string {
  const status = reading?.pm25Status || manual?.legend || 'No recent sample';
  const color = aqmsColor(status);
  return `
    <div class="swm-popup">
      <div class="swm-popup-head">
        <span class="swm-popup-dot" style="background:${color}"></span>
        <strong>${escapeHtml(station.name)}</strong>
        <span class="swm-popup-province">${escapeHtml(station.type)}</span>
      </div>
      <div class="swm-popup-row"><b>Status</b><span style="color:${color}">${escapeHtml(status)}</span></div>
      ${reading
        ? `<div class="swm-popup-row"><b>PM2.5</b><span>${reading.pm25 ?? '—'} µg/m³ · ${escapeHtml(reading.pm25Status)}</span></div>
           <div class="swm-popup-row"><b>PM10</b><span>${reading.pm10 ?? '—'} µg/m³ · ${escapeHtml(reading.pm10Status)}</span></div>
           <div class="swm-popup-row"><b>Reading</b><span class="mono">${escapeHtml(reading.timestamp)}</span></div>`
        : manual
          ? `<div class="swm-popup-row"><b>AQI</b><span>${manual.aqi} · ${escapeHtml(manual.legend)}</span></div>
             <div class="swm-popup-row"><b>Sample</b><span class="mono">${escapeHtml(manual.date)} (${escapeHtml(manual.category)})</span></div>`
          : ''}
      <div class="swm-popup-row"><b>Station</b><span>${escapeHtml(station.sourceName)}</span></div>
      ${station.address ? `<div class="swm-popup-row"><b>Address</b><span>${escapeHtml(station.address)}</span></div>` : ''}
      <div class="swm-popup-note">Operational status: ${escapeHtml(station.status)}</div>
    </div>`;
}

export function AqmsMap({
  stations,
  readings,
  manual,
  height = 520,
}: {
  stations: AqmsStation[];
  readings: AqmsReading[];
  manual: AqmsManualRecord[];
  height?: number | string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const [basemap, setBasemap] = useState<BasemapId>('streets');
  const [ready, setReady] = useState(false);

  const latest = useMemo(() => {
    const map = new Map<string, { reading: AqmsReading | null; manual: AqmsManualRecord | null }>();
    for (const station of stations) {
      map.set(station.id, { reading: latestReading(readings, station.id), manual: latestManual(manual, station.id) });
    }
    return map;
  }, [stations, readings, manual]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [10.29, 123.86],
      zoom: 10,
      zoomControl: false,
      attributionControl: true,
      // StrictMode mounts twice in dev; the canvas renderer can be disposed
      // mid-redraw ("clearRect of undefined"), so use SVG like the SWM map.
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
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (markersRef.current) {
      map.removeLayer(markersRef.current);
      markersRef.current = null;
    }
    const group = L.layerGroup();
    for (const station of stations) {
      const current = latest.get(station.id);
      const status = current?.reading?.pm25Status || current?.manual?.legend || 'NO DATA';
      const color = aqmsColor(status);
      const marker = L.circleMarker([station.lat, station.lon], {
        radius: station.type.toLowerCase().includes('continuous') ? 9 : 6.5,
        color: '#f8fafc',
        weight: 1.5,
        fillColor: color,
        fillOpacity: 0.95,
      });
      marker.bindPopup(popupFor(station, current?.reading ?? null, current?.manual ?? null), { maxWidth: 350, minWidth: 270 });
      marker.bindTooltip(`${station.name} — ${status}`, { direction: 'top', offset: [0, -8] });
      group.addLayer(marker);
    }
    group.addTo(map);
    markersRef.current = group;

    if (stations.length && mapRef.current === map) {
      const bounds = L.latLngBounds(stations.map((station) => [station.lat, station.lon]));
      if (bounds.isValid()) map.fitBounds(bounds.pad(0.18), { maxZoom: 11, animate: false });
    }
  }, [stations, latest, ready]);

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
        <div className="pointer-events-auto rounded-lg border border-white/10 bg-ink-950/90 px-2.5 py-2 text-[10px] leading-relaxed text-slate-400 backdrop-blur">
          <div className="mb-1 text-[8.5px] font-bold uppercase tracking-[0.14em] text-slate-500">Latest PM2.5 / AQI</div>
          {Object.entries(AQMS_COLORS).map(([label, color]) => (
            <div key={label} className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: color }} /> {label}</div>
          ))}
          <div className="mt-1 border-t border-white/10 pt-1 text-slate-500">
            <MapPin size={9} className="mr-1 inline" />
            {stations.length} monitoring stations · larger pins are continuous
          </div>
        </div>
      </div>
    </div>
  );
}
