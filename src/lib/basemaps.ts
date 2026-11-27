/**
 * Basemap definitions shared by every Leaflet view.
 *
 * The desktop/LAN app runs on Vite (`import.meta.env.DEV`), where `/tiles` is
 * proxied to the bundled `offline-tiles` pack by a dev middleware in
 * `vite.config.ts`. So the same two basemaps work with no internet at all.
 * A production build keeps the public Esri endpoints.
 */
export interface Basemap {
  label: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  maxNativeZoom?: number;
}

// The desktop offline copy ships its own tiles next to index.html.
const LOCAL_TILES = import.meta.env.DEV || import.meta.env.VITE_OFFLINE === '1';
const PACK_MAX_ZOOM = 12;

const REMOTE = {
  streets: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}',
  satellite: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
  topo: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}',
  ocean: 'https://server.arcgisonline.com/ArcGIS/rest/services/Ocean/World_Ocean_Base/MapServer/tile/{z}/{y}/{x}',
  osm: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
} as const;

function localTile(style: 'streets' | 'satellite'): string {
  return `/tiles/${style}/{z}/{x}/{y}.jpg`;
}

// The two bundled styles render offline at every zoom; the rest stay remote.
const bundledMaxNative = LOCAL_TILES ? PACK_MAX_ZOOM : undefined;

export const BASEMAPS: Record<string, Basemap> = {
  streets: {
    label: 'Streets',
    url: LOCAL_TILES ? localTile('streets') : REMOTE.streets,
    attribution: 'Esri, HERE, Garmin, OpenStreetMap contributors',
    maxNativeZoom: bundledMaxNative,
  },
  satellite: {
    label: 'Satellite',
    url: LOCAL_TILES ? localTile('satellite') : REMOTE.satellite,
    attribution: 'Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    maxNativeZoom: bundledMaxNative,
  },
  topo: {
    label: 'Topographic',
    url: REMOTE.topo,
    attribution: 'Esri, HERE, Garmin, USGS',
  },
  ocean: {
    label: 'Ocean',
    url: REMOTE.ocean,
    attribution: 'Esri, GEBCO, NOAA',
  },
  osm: {
    label: 'OpenStreetMap',
    url: REMOTE.osm,
    attribution: '&copy; OpenStreetMap contributors',
  },
};

export const BUNDLED_BASEMAPS = ['streets', 'satellite'] as const;
