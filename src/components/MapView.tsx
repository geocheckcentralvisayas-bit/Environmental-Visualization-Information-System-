import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.markercluster';
import 'leaflet.markercluster/dist/MarkerCluster.css';
import 'leaflet.markercluster/dist/MarkerCluster.Default.css';
import { AlertTriangle, ChevronDown, Crosshair, Layers3, Map as MapIcon, PanelRightClose, PanelRightOpen } from 'lucide-react';
import clsx from 'clsx';
import { useDashboard, useFilteredFacilities, useFilteredPermits } from '../store/useDashboard';
import { dataUrl } from '../lib/api';
import {
  GAP_META, LEGAL_STATUS_STYLE, LIFECYCLE_STYLE, REGISTER_META, REGISTER_ORDER, RISK_LABELS, escapeHtml, formatDate, formatNumber, riskColor,
} from '../lib/format';
import { swmDisposalPopupFor, swmFacilityPopup } from './SwmMap';
import { BASEMAPS } from '../lib/basemaps';
import type { Facility, LegalFacilitySummary, SpatialLayer, Permit, SwmDisposalProject, SwmFacility } from '../types';

type PointMode = 'companies' | 'permits' | 'swm' | 'none';

const MODE_LABELS: Record<PointMode, string> = {
  companies: 'Registers',
  permits: 'Permits',
  swm: 'Solid waste',
  none: 'None',
};

export function MapView({
  height = 'calc(100vh - 260px)',
  initialBasemap = 'streets',
  initialLayers = [],
  initialMode = 'companies',
  showPoints = true,
  showLayerPanel = true,
  enableFocus = true,
  selectedLayers,
  className,
}: {
  height?: number | string;
  initialBasemap?: string;
  initialLayers?: string[];
  initialMode?: PointMode;
  showPoints?: boolean;
  showLayerPanel?: boolean;
  enableFocus?: boolean;
  selectedLayers?: string[];
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<Array<{ lat: number; lon: number; marker: L.CircleMarker; siteId: string | null; siteIds: string[]; ensurePopup: () => void }>>([]);
  const highlightRef = useRef<L.CircleMarker | null>(null);
  const layerGroupRef = useRef<L.LayerGroup | null>(null);
  const swmRef = useRef<L.LayerGroup | null>(null);
  const legalRingRef = useRef<L.LayerGroup | null>(null);
  const focusRendererRef = useRef<L.SVG | null>(null);
  const appliedFocusRef = useRef(0);
  const resizeRef = useRef<ResizeObserver | null>(null);
  const overlayRef = useRef<Map<string, L.GeoJSON>>(new Map());
  const overlayData = useRef<Map<string, unknown>>(new Map());
  const overlayRequests = useRef<Map<string, Promise<unknown>>>(new Map());
  const layerErrorsRef = useRef<Record<string, string>>({});
  const opacityRef = useRef(0.62);
  const filteredFacilities = useFilteredFacilities();
  const filteredPermits = useFilteredPermits();
  const swm = useDashboard((state) => state.swm);
  const layers = useDashboard((state) => state.data?.layers.layers ?? []);
  const legal = useDashboard((state) => state.data?.legal);
  const selectSite = useDashboard((state) => state.selectSite);
  const openLegalEntity = useDashboard((state) => state.openLegalEntity);
  const focus = useDashboard((state) => state.focus);

  const [basemap, setBasemap] = useState(BASEMAPS[initialBasemap] ? initialBasemap : 'streets');
  const [mode, setMode] = useState<PointMode>(showPoints ? initialMode : 'none');
  const [showLegal, setShowLegal] = useState(true);
  const [activeLayers, setActiveLayers] = useState<Set<string>>(new Set(initialLayers));
  const [opacity, setOpacity] = useState(0.62);
  const [panelOpen, setPanelOpen] = useState(true);
  const [pendingLayers, setPendingLayers] = useState<string[]>([]);
  const [layerErrors, setLayerErrors] = useState<Record<string, string>>({});
  const [reloadToken, setReloadToken] = useState(0);
  const [ready, setReady] = useState(false);
  opacityRef.current = opacity;

  const selectedKey = selectedLayers ? [...selectedLayers].sort().join('|') : null;

  useEffect(() => {
    if (selectedLayers) setActiveLayers(new Set(selectedLayers));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);

  const points = useMemo(() => {
    if (mode === 'permits') return filteredPermits.filter((permit) => permit.lat !== null && permit.lon !== null);
    if (mode === 'companies') return filteredFacilities.filter((facility) => facility.lat !== null && facility.lon !== null);
    return [];
  }, [mode, filteredFacilities, filteredPermits]);

  // Solid waste points use the same Cebu + Bohol scope as the rest of the
  // dashboard. MRFs come from the IIS register; disposal sites from ECC/CNC.
  const swmFacilities = useMemo(
    () => (swm?.facilities ?? []).filter(
      (facility) => ['Cebu', 'Bohol'].includes(facility.province) && facility.lat !== null && facility.lon !== null,
    ),
    [swm],
  );
  const swmDisposal = useMemo(
    () => (swm?.disposal.projects ?? []).filter(
      (project) => ['Cebu', 'Bohol'].includes(project.province) && project.lat !== null && project.lon !== null,
    ),
    [swm],
  );
  const swmPlotted = swmFacilities.length + swmDisposal.length;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = L.map(containerRef.current, {
      center: [10.35, 123.85],
      zoom: 8,
      zoomControl: false,
      attributionControl: true,
      preferCanvas: true,
    });
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    L.control.scale({ imperial: false, position: 'bottomleft' }).addTo(map);
    map.createPane('overlays');
    map.getPane('overlays')!.style.zIndex = '330';
    mapRef.current = map;
    appliedFocusRef.current = 0;
    setReady(true);
    if (resizeRef.current) resizeRef.current.disconnect();
    const resize = new ResizeObserver(() => map.invalidateSize());
    resize.observe(containerRef.current);
    resizeRef.current = resize;
    return () => {
      resize.disconnect();
      overlayRef.current.clear();
      overlayRequests.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) map.removeLayer(tileRef.current);
    const config = BASEMAPS[basemap] ?? BASEMAPS.streets;
    tileRef.current = L.tileLayer(config.url, {
      attribution: config.attribution,
      maxZoom: config.maxZoom ?? 20,
      maxNativeZoom: config.maxNativeZoom,
      subdomains: 'abcd',
    }).addTo(map);
    tileRef.current.bringToBack();
  }, [basemap, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (layerGroupRef.current) {
      map.removeLayer(layerGroupRef.current);
      layerGroupRef.current = null;
    }
    markersRef.current = [];
    if (!points.length || mode === 'none') return;

    const parent = L.layerGroup();

    const makeMarker = (point: any) => {
      if (mode === 'companies') {
        const facility = point as Facility;
        const summary = legal?.byFacility?.[facility.id] ?? null;
        const color = facility.registers[0] ? REGISTER_META[facility.registers[0]].color : '#64748b';
        const marker = L.circleMarker([facility.lat, facility.lon], {
          radius: 5,
          color: '#f8fafc',
          weight: 1,
          fillColor: color,
          fillOpacity: 0.92,
        });
        const ensurePopup = () => {
          if (!marker.getPopup()) {
            marker.bindPopup(popupForFacility(facility, summary), { maxWidth: 344, minWidth: 268 });
          }
        };
        marker.on('popupopen', () => {
          const button = marker.getPopup()?.getElement()?.querySelector<HTMLElement>('[data-legal-entity]');
          if (!button) return;
          button.onclick = () => {
            const entityId = button.dataset.legalEntity;
            if (!entityId) return;
            marker.closePopup();
            openLegalEntity(entityId);
          };
        });
        marker.on('click', () => { ensurePopup(); marker.openPopup(); if (facility.siteId) selectSite(facility.siteId); });
        markersRef.current.push({ lat: facility.lat, lon: facility.lon, marker, siteId: facility.siteId, siteIds: facility.siteIds, ensurePopup });
        return marker;
      }
      const permit = point as Permit;
      const color = LIFECYCLE_STYLE[permit.lifecycle].chart;
      const marker = L.circleMarker([permit.lat as number, permit.lon as number], {
        radius: 3.5,
        color: '#f8fafc',
        weight: 1,
        fillColor: color,
        fillOpacity: 0.9,
      });
      const ensurePopup = () => { if (!marker.getPopup()) marker.bindPopup(popupForPermit(permit), { maxWidth: 310, minWidth: 230 }); };
      marker.on('click', () => { ensurePopup(); marker.openPopup(); });
      markersRef.current.push({ lat: permit.lat as number, lon: permit.lon as number, marker, siteId: permit.siteId ?? null, siteIds: [], ensurePopup });
      return marker;
    };

    const clusterIcon = (group: any) => {
      const count = group.getChildCount();
      const size = count < 10 ? 26 : count < 100 ? 32 : 38;
      return L.divIcon({
        html: '<div class="cluster-bubble"><span>' + count + '</span></div>',
        className: '',
        iconSize: [size, size],
        iconAnchor: [size / 2, size / 2],
      });
    };

    if (mode === 'companies') {
      const byCompany = new Map();
      for (const point of points) {
        const key = (point as Facility).key || (point as Facility).company;
        if (!byCompany.has(key)) byCompany.set(key, []);
        byCompany.get(key).push(point);
      }
      for (const [company, pts] of byCompany) {
        if (pts.length > 1) {
          const group = L.markerClusterGroup({
            chunkedLoading: true,
            maxClusterRadius: 60,
            spiderfyOnMaxZoom: true,
            showCoverageOnHover: false,
            disableClusteringAtZoom: 16,
            removeOutsideVisibleBounds: true,
            iconCreateFunction: clusterIcon,
          });
          group.addLayers(pts.map(makeMarker));
          parent.addLayer(group);
        } else {
          parent.addLayer(makeMarker(pts[0]));
        }
      }
    } else {
      const group = L.markerClusterGroup({
        chunkedLoading: true,
        maxClusterRadius: 40,
        spiderfyOnMaxZoom: true,
        showCoverageOnHover: false,
        disableClusteringAtZoom: 15,
        removeOutsideVisibleBounds: true,
        iconCreateFunction: clusterIcon,
      });
      group.addLayers(points.map(makeMarker));
      parent.addLayer(group);
    }

    map.addLayer(parent);
    layerGroupRef.current = parent;
  }, [points, mode, selectSite, legal, openLegalEntity]);

  /* Solid waste layer: MRF points plus ECC/CNC disposal approvals. */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (swmRef.current) {
      map.removeLayer(swmRef.current);
      swmRef.current = null;
    }
    if (mode !== 'swm' || !swmPlotted) return;

    const group = L.layerGroup();
    for (const facility of swmFacilities as SwmFacility[]) {
      const marker = L.circleMarker([facility.lat as number, facility.lon as number], {
        radius: facility.barangays.length > 1 ? 6 : 4.5,
        color: '#f8fafc',
        weight: 1,
        fillColor: facility.status === 'Operational' ? '#34d399' : '#fb7185',
        fillOpacity: 0.92,
      });
      marker.bindPopup(swmFacilityPopup(facility), { maxWidth: 330, minWidth: 250 });
      group.addLayer(marker);
    }

    const disposalColor = { landfill: '#fbbf24', dumpsite: '#fb923c', transfer: '#a78bfa' } as const;
    for (const project of swmDisposal as SwmDisposalProject[]) {
      const marker = L.circleMarker([project.lat as number, project.lon as number], {
        radius: 6,
        color: '#0b1411',
        weight: 2,
        fillColor: disposalColor[project.category],
        fillOpacity: 0.96,
      });
      marker.bindPopup(swmDisposalPopupFor(project), { maxWidth: 350, minWidth: 270 });
      group.addLayer(marker);
    }

    group.addTo(map);
    swmRef.current = group;
  }, [mode, swmFacilities, swmDisposal, swmPlotted, ready]);

  /*
   * Legal ring: a thin outer circle on establishments that appear in the NOV /
   * PAB / ERF / complaint docket. Rings sit on the exact facility coordinate
   * (never a municipality centroid) so an open case cannot drift to a
   * neighbouring barangay.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (legalRingRef.current) {
      map.removeLayer(legalRingRef.current);
      legalRingRef.current = null;
    }
    if (!showLegal || mode !== 'companies' || !legal?.byFacility || !Object.keys(legal.byFacility).length) return;

    const ringGroup = L.layerGroup();
    for (const facility of points as Facility[]) {
      const summary = legal.byFacility[facility.id];
      if (!summary) continue;
      L.circleMarker([facility.lat, facility.lon], {
        radius: 10,
        color: LEGAL_STATUS_STYLE[summary.status].color,
        weight: 1.6,
        opacity: 0.92,
        fill: false,
        interactive: false,
      }).addTo(ringGroup);
    }
    ringGroup.addTo(map);
    legalRingRef.current = ringGroup;
  }, [points, mode, showLegal, legal]);

  useEffect(() => {
    return () => {
      const map = mapRef.current;
      if (map && legalRingRef.current) {
        try { map.removeLayer(legalRingRef.current); } catch { /* map already removed */ }
      }
      legalRingRef.current = null;
    };
  }, []);

  /*
   * "Open on map" hand-off: fly to the record, drop a highlight ring and open
   * its popup. Applied once per focus nonce so later filter changes do not
   * replay the animation.
   */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !focus || !enableFocus || !showPoints) return;
    if (appliedFocusRef.current === focus.nonce) return;
    if (mode !== 'companies') {
      setMode('companies');
      return;
    }

    appliedFocusRef.current = focus.nonce;

    /*
     * Resolve the clicked register row to its merged facility marker. Prefer
     * the exact site link, then the closest marker inside ~2 km, so a shared
     * address does not open a neighbouring company's popup. Re-run the lookup
     * when the timer fires because the cluster may have been rebuilt since.
     */
    const resolveFocusMarker = () => {
      const candidates = markersRef.current.map((entry) => ({
        entry,
        distance: Math.hypot(entry.lat - focus.lat, entry.lon - focus.lon),
      }));
      const exact = focus.siteId
        ? candidates.find(({ entry }) => entry.siteId === focus.siteId || entry.siteIds.includes(focus.siteId as string))
        : undefined;
      const nearest = candidates
        .filter(({ distance }) => distance <= 0.02)
        .sort((a, b) => a.distance - b.distance)[0];
      return exact ?? nearest;
    };
    const chosen = resolveFocusMarker();
    const target: [number, number] = chosen ? [chosen.entry.lat, chosen.entry.lon] : [focus.lat, focus.lon];

    if (highlightRef.current) {
      map.removeLayer(highlightRef.current);
      highlightRef.current = null;
    }
    /*
     * The map uses the canvas renderer for speed, but the CSS pulse needs a
     * real DOM path, so the highlight ring gets its own SVG renderer.
     */
    if (!focusRendererRef.current) focusRendererRef.current = L.svg({ padding: 0.5 });
    const ring = L.circleMarker(target, {
      renderer: focusRendererRef.current,
      radius: 22,
      color: '#f8fafc',
      weight: 2,
      opacity: 0.95,
      fillColor: '#34d399',
      fillOpacity: 0.16,
      className: 'focus-ring',
      interactive: false,
    });
    ring.addTo(map);
    highlightRef.current = ring;

    map.flyTo(target, 16, { duration: 0.9 });
    let cancelled = false;

    const openPopup = () => {
      if (cancelled) return;
      const current = resolveFocusMarker();
      if (current) {
        current.entry.ensurePopup();
        current.entry.marker.openPopup();
        return;
      }
      L.popup({ maxWidth: 320, minWidth: 220 })
        .setLatLng(target)
        .setContent(
          `<div><div style="font-size:12px;font-weight:700;margin-bottom:3px">${escapeHtml(focus.label)}</div>
           <div class="popup-muted" style="font-size:10.5px">No marker under the current filters — clear a filter to reveal it.</div></div>`,
        )
        .openOn(map);
    };

    const first = window.setTimeout(openPopup, 950);
    const second = window.setTimeout(openPopup, 1800);
    const clearRing = window.setTimeout(() => {
      if (highlightRef.current) {
        map.removeLayer(highlightRef.current);
        highlightRef.current = null;
      }
    }, 9000);

    return () => {
      cancelled = true;
      window.clearTimeout(first);
      window.clearTimeout(second);
      window.clearTimeout(clearRing);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, mode, enableFocus, showPoints]);

  // Opacity is a visual concern only: restyle existing layers instead of
  // reloading them. Re-fetching multi-megabyte DENR layers on every slider tick
  // (and aborting them) was surfacing as bogus "connection" failures.
  useEffect(() => {
    overlayRef.current.forEach((layer, id) => {
      const meta = layers.find((entry) => entry.id === id);
      if (meta) layer.setStyle((feature) => styleForLayer(meta, feature?.properties ?? {}, opacity));
    });
  }, [opacity, layers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    let cancelled = false;

    const loadLayer = async (meta: SpatialLayer): Promise<unknown> => {
      const cached = overlayData.current.get(meta.id);
      if (cached) return cached;
      const inflight = overlayRequests.current.get(meta.id);
      if (inflight) return inflight;
      const request = (async () => {
        // Deliberately no AbortSignal. These layers can be 2-5 MB; aborting them
        // when an unrelated dependency changed was reported as a failed load.
        const response = await fetch(dataUrl(`geojson/${meta.file}`), { credentials: 'include' });
        if (!response.ok) throw new Error(`HTTP ${response.status} while loading ${meta.name}`);
        return response.json() as Promise<unknown>;
      })();
      overlayRequests.current.set(meta.id, request);
      try {
        const json = await request;
        overlayData.current.set(meta.id, json);
        return json;
      } finally {
        overlayRequests.current.delete(meta.id);
      }
    };

    async function syncLayers() {
      const current = overlayRef.current;

      for (const [id, layer] of [...current.entries()]) {
        if (!activeLayers.has(id)) {
          map!.removeLayer(layer);
          current.delete(id);
        }
      }

      const toLoad = [...activeLayers].filter(
        (id) => !current.has(id) && !layerErrorsRef.current[id] && layers.some((layer) => layer.id === id),
      );
      if (!toLoad.length) return;

      setPendingLayers((previous) => [...new Set([...previous, ...toLoad])]);

      await Promise.all(
        toLoad.map(async (id) => {
          const meta = layers.find((layer) => layer.id === id);
          if (!meta) return;
          try {
            const data = await loadLayer(meta);
            // Another run may have finished first, or the map was rebuilt.
            if (cancelled || current.has(id)) return;
            const geo = L.geoJSON(data as never, {
              pane: 'overlays',
              style: (feature) => styleForLayer(meta, feature?.properties ?? {}, opacityRef.current),
              onEachFeature: (feature, layer) => {
                const properties = feature.properties ?? {};
                const raw =
                  properties.PA_NAME ??
                  properties.WATERSHED ??
                  (meta.style.field ? properties[meta.style.field] : undefined) ??
                  meta.name;
                const label = meta.classMeta?.[String(raw)]?.label ?? raw;
                layer.bindTooltip(String(label), { sticky: true, direction: 'top', opacity: 0.95 });
                layer.on('mouseover', () => {
                  if (layer instanceof L.Path) {
                    layer.setStyle({ weight: 2, opacity: 1, fillOpacity: Math.min(0.85, opacityRef.current + 0.16) });
                    layer.bringToFront();
                  }
                });
                layer.on('mouseout', () => {
                  if (layer instanceof L.Path) layer.setStyle(styleForLayer(meta, properties, opacityRef.current));
                });
              },
            });
            geo.addTo(map!);
            current.set(id, geo);
            if (id in layerErrorsRef.current) {
              const next = { ...layerErrorsRef.current };
              delete next[id];
              layerErrorsRef.current = next;
              setLayerErrors(next);
            }
            fitLayerIfOffscreen(map!, meta);
          } catch (error) {
            if (cancelled) return;
            const message = error instanceof Error ? error.message : `Could not load ${meta.name}`;
            const next = { ...layerErrorsRef.current, [id]: message };
            layerErrorsRef.current = next;
            setLayerErrors(next);
          } finally {
            setPendingLayers((previous) => previous.filter((entry) => entry !== id));
          }
        }),
      );
    }

    syncLayers();
    return () => {
      cancelled = true;
    };
  }, [activeLayers, layers, ready, reloadToken]);

  const retryLayer = (id: string) => {
    overlayData.current.delete(id);
    overlayRequests.current.delete(id);
    const next = { ...layerErrorsRef.current };
    delete next[id];
    layerErrorsRef.current = next;
    setLayerErrors(next);
    setReloadToken((token) => token + 1);
  };


  const fitToData = () => {
    const map = mapRef.current;
    if (!map) return;
    const coords = (mode === 'swm'
      ? [
          ...swmFacilities.map((facility) => [facility.lat as number, facility.lon as number] as [number, number]),
          ...swmDisposal.map((project) => [project.lat as number, project.lon as number] as [number, number]),
        ]
      : points.map((point) => (point.lat !== null && point.lon !== null ? [point.lat, point.lon] as [number, number] : null)).filter(Boolean) as [number, number][]
    );
    if (!coords.length) return;
    map.fitBounds(L.latLngBounds(coords), { padding: [36, 36], maxZoom: 13 });
  };

  const fitLayer = (layer: SpatialLayer) => {
    const map = mapRef.current;
    if (!map || layer.bbox.length < 4) return;
    map.fitBounds(boundsForLayer(layer), { padding: [28, 28], maxZoom: 12 });
  };

  const groups = useMemo(() => {
    const map = new Map<string, SpatialLayer[]>();
    for (const layer of layers) {
      const list = map.get(layer.group) ?? [];
      list.push(layer);
      map.set(layer.group, list);
    }
    return [...map.entries()];
  }, [layers]);

  const legendLayers = layers.filter((layer) => activeLayers.has(layer.id));

  return (
    <div className={clsx('relative overflow-hidden rounded-2xl border border-white/[0.08] bg-ink-900', className)} style={{ height }}>
      <div ref={containerRef} className="h-full w-full" />

      <div className="pointer-events-none absolute bottom-3 left-3 top-3 z-[500] flex flex-col items-start gap-2">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-white/10 bg-ink-900/90 px-3 py-2 shadow-panel backdrop-blur">
          <MapIcon size={14} className="text-emerald-300" />
          <span className="text-[11px] font-semibold text-slate-200">Central Visayas</span>
          <span className="text-[10px] text-slate-500">
            {mode === 'swm'
              ? `${formatNumber(swmPlotted)} solid waste points plotted`
              : `${points.length.toLocaleString()} ${mode === 'permits' ? 'permits' : mode === 'none' ? 'points hidden' : 'facilities'} plotted`}
          </span>
        </div>
        {mode === 'swm' && (
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-ink-900/90 px-2.5 py-2 shadow-panel backdrop-blur">
            <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Solid waste points</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {[
                ['Operational MRF', '#34d399'],
                ['Non-operational MRF', '#fb7185'],
                ['Sanitary landfill', '#fbbf24'],
                ['Dumpsite / waste dump', '#fb923c'],
                ['Transfer station', '#a78bfa'],
              ].map(([label, color]) => (
                <span key={label} className="inline-flex items-center gap-1 text-[9.5px] text-slate-300">
                  <span className="h-2 w-2 rounded-full" style={{ background: color }} />
                  {label}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[8.5px] text-slate-500">Cebu and Bohol only · disposal sites are ECC/CNC approvals</div>
          </div>
        )}
        {mode === 'companies' && (
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-ink-900/90 px-2.5 py-2 shadow-panel backdrop-blur">
            <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Registers on marker</div>
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {REGISTER_ORDER.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 text-[9.5px] text-slate-300">
                  <span className="h-2 w-2 rounded-full" style={{ background: REGISTER_META[id].color }} />
                  {REGISTER_META[id].label}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[8.5px] text-slate-500">Badge = number of registers held</div>
          </div>
        )}
        {mode === 'companies' && showLegal && legal && legal.totals.facilitiesWithLegal > 0 && (
          <div className="pointer-events-auto rounded-xl border border-white/10 bg-ink-900/90 px-2.5 py-2 shadow-panel backdrop-blur">
            <div className="mb-1 text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">Legal status ring</div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-0.5">
              {Object.entries(LEGAL_STATUS_STYLE).map(([status, meta]) => (
                <span key={status} className="inline-flex items-center gap-1 text-[9.5px] text-slate-300">
                  <span className="h-2.5 w-2.5 rounded-full border-[1.5px]" style={{ borderColor: meta.color }} />
                  {meta.label}
                </span>
              ))}
            </div>
            <div className="mt-1 text-[8.5px] text-slate-500">
              {formatNumber(legal.totals.facilitiesWithLegal)} facilities with docket records
            </div>
          </div>
        )}
        {pendingLayers.length > 0 && (
          <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-ink-900/90 px-3 py-1.5 shadow-panel backdrop-blur">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            <span className="text-[10px] text-emerald-200/90">Loading {pendingLayers.length} overlay{pendingLayers.length === 1 ? '' : 's'}…</span>
          </div>
        )}
        {Object.keys(layerErrors).length > 0 && (
          <button
            type="button"
            onClick={() => {
              if (showLayerPanel) setPanelOpen(true);
              else Object.keys(layerErrors).forEach((id) => retryLayer(id));
            }}
            className="pointer-events-auto flex items-center gap-2 rounded-xl border border-rose-400/25 bg-ink-900/90 px-3 py-1.5 text-left shadow-panel backdrop-blur"
          >
            <AlertTriangle size={11} className="text-rose-300" />
            <span className="text-[10px] text-rose-200/90">
              {Object.keys(layerErrors).length} overlay{Object.keys(layerErrors).length === 1 ? '' : 's'} failed
              {showLayerPanel ? ' · open controls' : ' · retry'}
            </span>
          </button>
        )}
        {legendLayers.length > 0 && (
          <div className="scroll-thin pointer-events-auto max-h-full min-h-0 w-[214px] shrink overflow-y-auto rounded-xl border border-white/10 bg-ink-900/90 p-2.5 pr-1.5 shadow-panel backdrop-blur">
            <div className="mb-1 flex items-center justify-between text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
              <span>Legend</span>
              <span className="text-slate-600">{legendLayers.length}</span>
            </div>
            {legendLayers.map((layer) => (
              <div key={layer.id} className="mt-2 border-t border-white/[0.055] pt-2 first:mt-0 first:border-0 first:pt-0">
                <button
                  type="button"
                  onClick={() => fitLayer(layer)}
                  title="Zoom to layer"
                  className="inline-flex max-w-full items-center gap-1 text-left text-[9.5px] font-semibold uppercase tracking-[0.1em] text-slate-300 transition hover:text-emerald-200"
                >
                  <span className="truncate">{layer.name}</span>
                  <Crosshair size={8} className="shrink-0 opacity-60" />
                </button>
                {layer.classMeta ? (
                  <div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-0.5">
                    {Object.entries(layer.classMeta).map(([value, meta]) => (
                      <div key={value} className="flex items-center gap-1.5 text-[9.5px] leading-tight text-slate-300">
                        <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: meta.color }} />
                        <span className="truncate">{meta.label}</span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-1.5 text-[9.5px] text-slate-300">
                    <span className="h-2 w-2 shrink-0 rounded-sm" style={{ background: layer.style.color ?? '#34d399' }} />
                    {layer.style.kind === 'outline' ? 'Boundary outline' : 'Layer extent'}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="absolute right-3 top-3 z-[500] flex flex-col items-end gap-2">
        <button type="button" className="btn h-8 border-white/10 bg-ink-900/90 backdrop-blur" onClick={() => setPanelOpen((value) => !value)}>
          {panelOpen ? <PanelRightClose size={14} /> : <PanelRightOpen size={14} />}
          Map controls
        </button>
        {panelOpen && (
          <div className="w-[238px] rounded-xl border border-white/10 bg-ink-900/92 p-3 shadow-panel backdrop-blur">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Basemap</span>
              <Layers3 size={13} className="text-slate-500" />
            </div>
            <select className="select mb-3 h-8 text-[11.5px]" value={basemap} onChange={(event) => setBasemap(event.target.value)}>
              {Object.entries(BASEMAPS).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>

            {showPoints && (
              <>
                <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Points</div>
                <div className="mb-3 grid grid-cols-2 gap-1 rounded-lg border border-white/10 bg-ink-950/60 p-0.5">
                  {(['companies', 'permits', 'swm', 'none'] as PointMode[]).map((value) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      className={clsx(
                        'rounded-md px-1 py-1 text-[10px] font-semibold transition',
                        mode === value ? 'bg-emerald-400/15 text-emerald-200' : 'text-slate-500 hover:text-slate-300',
                      )}
                    >
                      {MODE_LABELS[value]}
                    </button>
                  ))}
                </div>
                {legal && legal.totals.facilitiesWithLegal > 0 && (
                  <label className="mb-3 flex cursor-pointer items-center gap-2 text-[10px] text-slate-400">
                    <input
                      type="checkbox"
                      checked={showLegal}
                      onChange={() => setShowLegal((value) => !value)}
                      className="h-3 w-3 accent-rose-500"
                    />
                    <span className="flex-1">Legal case rings</span>
                    <span className="font-mono text-[9px] text-slate-600">{formatNumber(legal.totals.facilitiesWithLegal)}</span>
                  </label>
                )}
              </>
            )}

            {showLayerPanel && (
              <>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">Overlays</span>
                  <span className="flex items-center gap-2">
                    {pendingLayers.length > 0 && <span className="text-[9px] text-emerald-300">loading {pendingLayers.length}…</span>}
                    {activeLayers.size > 0 && (
                      <button type="button" className="text-[9px] text-slate-500 transition hover:text-slate-300" onClick={() => setActiveLayers(new Set())}>
                        clear
                      </button>
                    )}
                  </span>
                </div>
                <div className="scroll-thin max-h-[210px] space-y-2 overflow-auto pr-1">
                  {groups.map(([group, items]) => (
                    <div key={group}>
                      <div className="mb-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-slate-600">{group}</div>
                      {items.map((layer) => {
                        const failed = layerErrors[layer.id];
                        const pending = pendingLayers.includes(layer.id);
                        return (
                          <div key={layer.id}>
                            <label className="flex cursor-pointer items-center gap-2 rounded-md px-1 py-1 text-[10.5px] text-slate-300 hover:bg-white/[0.04]">
                              <input
                                type="checkbox"
                                checked={activeLayers.has(layer.id)}
                                onChange={() =>
                                  setActiveLayers((current) => {
                                    const next = new Set(current);
                                    if (next.has(layer.id)) next.delete(layer.id);
                                    else next.add(layer.id);
                                    return next;
                                  })
                                }
                                className="h-3 w-3 accent-emerald-500"
                              />
                              <span className="min-w-0 flex-1 truncate">{layer.name}</span>
                              {pending && <span className="shrink-0 text-[8px] text-emerald-400">loading…</span>}
                              {!pending && layer.sizeBytes > 2_000_000 && !failed && <span className="shrink-0 text-[8px] text-amber-500/70">heavy</span>}
                              {failed && <span className="shrink-0 text-[8px] text-rose-400">failed</span>}
                            </label>
                            {failed && (
                              <button type="button" onClick={() => retryLayer(layer.id)} className="ml-5 text-left text-[9px] text-rose-300/90 transition hover:text-rose-200">
                                Retry loading
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  ))}
                </div>
                {Object.keys(layerErrors).length > 0 && (
                  <div className="mt-2 rounded-md border border-rose-400/25 bg-rose-400/[0.06] px-2 py-1.5 text-[9px] leading-relaxed text-rose-200/80">
                    {Object.keys(layerErrors).length} overlay{Object.keys(layerErrors).length === 1 ? '' : 's'} could not be loaded. Check the connection, then retry.
                  </div>
                )}
                <label className="mt-2 flex items-center gap-2 text-[10px] text-slate-500">
                  Opacity
                  <input type="range" min={0.15} max={0.95} step={0.05} value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} className="h-1 flex-1 accent-emerald-500" />
                  <span className="w-6 text-right font-mono text-[9px] text-slate-400">{Math.round(opacity * 100)}%</span>
                </label>
              </>
            )}
          </div>
        )}
      </div>

      <div className="absolute bottom-4 left-1/2 z-[500] flex -translate-x-1/2 items-center gap-1.5">
        <button type="button" className="btn h-8 border-white/10 bg-ink-900/90 shadow-panel backdrop-blur" onClick={fitToData}>
          <Crosshair size={13} /> Fit filtered
        </button>
        <div className="rounded-lg border border-white/10 bg-ink-900/90 px-2.5 py-1.5 text-[9.5px] text-slate-500 shadow-panel backdrop-blur">
          {mode === 'permits'
            ? 'Points coloured by permit lifecycle'
            : mode === 'swm'
              ? 'Cebu & Bohol only · MRF status + ECC/CNC disposal sites'
              : mode === 'companies'
                ? 'One dot per establishment · badge = registers held'
                : 'Point layer hidden'}
        </div>
      </div>

      {!ready && <div className="absolute inset-0 grid place-items-center bg-ink-900 text-[12px] text-slate-500">Preparing map…</div>}
    </div>
  );
}

function boundsForLayer(layer: SpatialLayer): L.LatLngBounds {
  const [west, south, east, north] = layer.bbox;
  return L.latLngBounds([south, west], [north, east]);
}

function fitLayerIfOffscreen(map: L.Map, layer: SpatialLayer) {
  if (layer.bbox.length < 4) return;
  const bounds = boundsForLayer(layer);
  if (!map.getBounds().intersects(bounds)) {
    map.fitBounds(bounds, { padding: [28, 28], maxZoom: 12 });
  }
}

function styleForLayer(layer: SpatialLayer, properties: Record<string, unknown>, opacity: number): L.PathOptions {
  if (layer.style.kind === 'outline') {
    return {
      color: layer.style.color ?? '#34d399',
      weight: layer.style.weight ?? 1.5,
      opacity: 0.9,
      fillColor: layer.style.color ?? '#34d399',
      fillOpacity: layer.style.fillOpacity ?? 0.05,
      dashArray: layer.id === 'districts' ? '4 5' : undefined,
    };
  }
  const value = String(properties[layer.style.field ?? ''] ?? '');
  const color = layer.classMeta?.[value]?.color ?? '#34d399';
  return {
    color,
    weight: 0.45,
    opacity: 0.5,
    fillColor: color,
    fillOpacity: opacity,
  };
}

function facilityIcon(facility: Facility): L.DivIcon {
  const primary = facility.registers[0];
  const color = primary ? REGISTER_META[primary].color : '#64748b';
  const multi = facility.registers.length > 1;
  const badge = multi ? `<span class="facility-badge">${facility.registers.length}</span>` : '';
  return L.divIcon({
    className: '',
    html: `<div class="facility-dot" style="--dot:${color}" title="${facility.registers.join(' · ')}">${badge}</div>`,
    iconSize: [12, 12],
    iconAnchor: [6, 6],
  });
}

const COORD_NOTE: Record<string, string> = {
  corrected: 'Coordinate repaired from the address',
  approximate: 'Approximate barangay / city centre',
  swapped: 'Latitude and longitude swapped',
  unresolved: 'Coordinate unresolved',
  missing: 'No coordinate on file',
};

function popupForFacility(facility: Facility, summary: LegalFacilitySummary | null = null): string {
  const chips = facility.registers
    .map((id) => {
      const meta = REGISTER_META[id];
      return `<span class="popup-chip" style="background:${meta.color}22;color:${meta.color};border:1px solid ${meta.color}55">${meta.label} · ${facility.counts[id]}</span>`;
    })
    .join(' ');
  const gap = facility.gap ? GAP_META[facility.gap] : null;
  const risk = facility.risk ? RISK_LABELS[facility.risk] ?? String(facility.risk) : 'None';
  const coordNote = COORD_NOTE[facility.coordStatus];
  const legalMeta = summary ? LEGAL_STATUS_STYLE[summary.status] : null;
  const legalBlock = summary && legalMeta
    ? `
      <div style="margin:7px 0;border-top:1px solid rgba(148,163,184,.16);padding-top:6px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;margin-bottom:4px">
          <span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:#64748b">Legal docket</span>
          <span class="popup-chip" style="background:${legalMeta.color}22;color:${legalMeta.color};border:1px solid ${legalMeta.color}55">${legalMeta.label}</span>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:3px 10px;font-size:10.5px">
          <span class="popup-muted">NOV cases</span><b style="text-align:right">${formatNumber(summary.cases)}</b>
          <span class="popup-muted">PAB records</span><b style="text-align:right">${formatNumber(summary.pab)}</b>
          <span class="popup-muted">ERF records</span><b style="text-align:right">${formatNumber(summary.erf)}</b>
          <span class="popup-muted">Complaints</span><b style="text-align:right">${formatNumber(summary.complaints)}</b>
        </div>
        <div class="popup-muted" style="font-size:9.5px;margin-top:4px">${formatNumber(summary.open)} open · ${formatNumber(summary.closed)} closed · payment ${summary.payment.toLowerCase()}</div>
        <button type="button" data-legal-entity="${escapeHtml(summary.entityId)}" style="margin-top:6px;width:100%;border:1px solid ${legalMeta.color}55;background:${legalMeta.color}1a;color:${legalMeta.color};border-radius:7px;padding:4px 8px;font-size:10.5px;font-weight:600;cursor:pointer">View docket →</button>
      </div>`
    : '';
  return `
    <div style="min-width:250px">
      <div style="font-size:12.5px;font-weight:700;line-height:1.3;margin-bottom:3px">${escapeHtml(facility.company)}</div>
      <div class="popup-muted" style="font-size:10.5px;margin-bottom:7px">${escapeHtml([facility.barangay, facility.municipality, facility.province].filter(Boolean).join(', '))}</div>
      <div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${chips}</div>
      ${gap ? `<div style="margin-bottom:7px"><span class="popup-chip" style="background:${gap.color}22;color:${gap.color};border:1px solid ${gap.color}55">${gap.label}</span></div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:10.5px">
        <span class="popup-muted">DP records</span><b style="text-align:right">${facility.counts.DP}</b>
        <span class="popup-muted">PTO records</span><b style="text-align:right">${facility.counts.PTO}</b>
        <span class="popup-muted">HW registrations</span><b style="text-align:right">${facility.counts.HW}</b>
        <span class="popup-muted">ECC / CNC</span><b style="text-align:right">${facility.counts.ECC} / ${facility.counts.CNC}</b>
        <span class="popup-muted">Latest issue</span><b style="text-align:right">${escapeHtml(formatDate(facility.latestIssued))}</b>
        <span class="popup-muted">Spatial risk</span><b style="text-align:right;color:${riskColor(facility.risk)}">${risk}</b>
      </div>
      ${legalBlock}
      ${coordNote ? `<div class="popup-muted" style="font-size:9.5px;margin-top:6px">${escapeHtml(coordNote)}</div>` : ''}
      <div class="popup-muted" style="font-size:10px;margin-top:6px;border-top:1px solid rgba(148,163,184,.16);padding-top:6px">${escapeHtml(facility.address || 'No address on file')}</div>
      ${facility.aliases.length > 1 ? `<div class="popup-muted" style="font-size:9px;margin-top:4px">Grouped names: ${escapeHtml(facility.aliases.join(' · '))}</div>` : ''}
    </div>`;
}

function popupForPermit(permit: Permit): string {
  const tone = LIFECYCLE_STYLE[permit.lifecycle].chart;
  return `
    <div style="min-width:220px">
      <div style="font-size:12.5px;font-weight:700;line-height:1.3;margin-bottom:3px">${escapeHtml(permit.company)}</div>
      <div class="popup-muted" style="font-size:10.5px;margin-bottom:7px">${escapeHtml(permit.municipality)}, ${escapeHtml(permit.province)}</div>
      <div style="margin-bottom:7px">
        <span class="popup-chip" style="background:${tone}22;color:${tone};border:1px solid ${tone}55">${permit.type} · ${permit.lifecycle}</span>
        <span class="popup-chip" style="background:rgba(148,163,184,.12);color:#cbd5e1;border:1px solid rgba(148,163,184,.25);margin-left:4px">${escapeHtml(permit.permitNo)}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px 10px;font-size:10.5px">
        <span class="popup-muted">Issued</span><b style="text-align:right">${escapeHtml(formatDate(permit.issued))}</b>
        <span class="popup-muted">Expiry</span><b style="text-align:right">${escapeHtml(formatDate(permit.expiry))}</b>
        <span class="popup-muted">Industry</span><b style="text-align:right">${escapeHtml(permit.industry || '—')}</b>
        <span class="popup-muted">Source</span><b style="text-align:right">${escapeHtml(permit.sourceSheet)}</b>
      </div>
    </div>`;
}
