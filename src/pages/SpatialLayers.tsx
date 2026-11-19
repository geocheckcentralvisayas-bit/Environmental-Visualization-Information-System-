import { useMemo, useState } from 'react';
import { CheckSquare, Download, Eye, EyeOff, Layers3, MousePointer2, Square } from 'lucide-react';
import { requestGeoJson } from '../lib/exportGate';
import { getSession } from '../lib/auth';
import { dataUrl } from '../lib/api';
import clsx from 'clsx';
import { useDashboard } from '../store/useDashboard';
import { MapView } from '../components/MapView';
import { Chip, Panel, SectionHeading } from '../components/ui';
import { formatBytes, formatNumber } from '../lib/format';
import type { SpatialLayer } from '../types';

const HAZARD_LAYERS = ['flooding', 'landslide'];
const ENV_LAYERS = ['protected_areas', 'watersheds', 'river_networks', 'river_networks_buffered'];
const ADMIN_LAYERS = ['provincial_boundary', 'districts'];

export function SpatialLayersPage() {
  const data = useDashboard((state) => state.data);
  const [active, setActive] = useState<string[]>(['flooding', 'landslide']);
  const [hovered, setHovered] = useState<string | null>(null);

  const groups = useMemo(() => {
    const map = new Map<string, SpatialLayer[]>();
    for (const layer of data?.layers.layers ?? []) {
      const list = map.get(layer.group) ?? [];
      list.push(layer);
      map.set(layer.group, list);
    }
    return [...map.entries()];
  }, [data]);

  const totals = useMemo(() => {
    const layers = data?.layers.layers ?? [];
    return {
      layers: layers.length,
      features: layers.reduce((sum, layer) => sum + layer.count, 0),
      bytes: layers.reduce((sum, layer) => sum + layer.sizeBytes, 0),
    };
  }, [data]);

  const toggle = (id: string) =>
    setActive((current) => (current.includes(id) ? current.filter((entry) => entry !== id) : [...current, id]));

  if (!data) return null;

  return (
    <div className="animate-fade-up space-y-4">
      <SectionHeading
        eyebrow="Geospatial library"
        title="Layers & overlays"
        description="The spatial bundle is compiled from the DENR Region VII shapefiles, dissolved by classification and simplified for web delivery. Enable a layer to preview it over the establishment map."
        action={
          <>
            <Chip tone="emerald"><Layers3 size={10} /> {totals.layers} layers</Chip>
            <Chip tone="sky">{formatNumber(totals.features)} features</Chip>
            <Chip tone="slate">{formatBytes(totals.bytes)} bundle</Chip>
          </>
        }
      />

      <Panel bodyClassName="p-3" title="Overlay preview" subtitle={`${formatNumber(active.length)} layer${active.length === 1 ? '' : 's'} visible · establishments plotted underneath`}>
        <MapView
          height="clamp(420px, calc(100vh - 600px), 720px)"
          initialMode="companies"
          initialBasemap="satellite"
          selectedLayers={active}
          showLayerPanel={false}
          enableFocus={false}
        />
      </Panel>

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="mr-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-600">Presets</span>
        {[
          { label: 'Hazards', ids: HAZARD_LAYERS },
          { label: 'Environment', ids: ENV_LAYERS },
          { label: 'Administrative', ids: ADMIN_LAYERS },
          { label: 'Everything', ids: data.layers.layers.map((layer) => layer.id) },
        ].map((preset) => (
          <button key={preset.label} type="button" className="btn btn-xs" onClick={() => setActive(preset.ids)}>
            {preset.label}
          </button>
        ))}
        <button type="button" className="btn btn-xs btn-ghost" onClick={() => setActive([])}>
          <EyeOff size={11} /> Clear
        </button>
        <span className="ml-auto text-[10px] text-slate-600">
          {active.length ? `Active: ${active.join(', ')}` : 'No overlays active'}
        </span>
      </div>

      {groups.map(([group, layers]) => (
        <section key={group} className="space-y-2">
          <div className="flex items-center gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">{group}</h2>
            <span className="h-px flex-1 bg-white/[0.06]" />
            <span className="text-[10px] text-slate-600">{layers.length} layer{layers.length === 1 ? '' : 's'}</span>
          </div>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {layers.map((layer) => {
              const on = active.includes(layer.id);
              const swatches = Object.entries(layer.classMeta ?? {}).slice(0, 8);
              return (
                <article
                  key={layer.id}
                  onMouseEnter={() => setHovered(layer.id)}
                  onMouseLeave={() => setHovered(null)}
                  className={clsx(
                    'card flex flex-col overflow-hidden transition',
                    on ? 'border-emerald-400/30 bg-emerald-400/[0.035]' : 'hover:border-white/15',
                  )}
                >
                  <div className="flex items-start gap-3 border-b border-white/[0.055] p-3.5">
                    <div className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg" style={{ background: `${swatches[0]?.[1].color ?? layer.style.color ?? '#34d399'}22`, color: swatches[0]?.[1].color ?? layer.style.color ?? '#34d399' }}>
                      <Layers3 size={15} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <h3 className="truncate text-[12.5px] font-semibold text-slate-100">{layer.name}</h3>
                      <div className="text-[10px] text-slate-500">
                        {layer.geometry} · {formatNumber(layer.count)} features · {formatBytes(layer.sizeBytes)}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => toggle(layer.id)}
                      className={clsx('shrink-0 rounded-md p-1 transition', on ? 'text-emerald-300' : 'text-slate-500 hover:text-slate-300')}
                      title={on ? 'Hide overlay' : 'Show overlay'}
                    >
                      {on ? <CheckSquare size={16} /> : <Square size={16} />}
                    </button>
                  </div>

                  <div className="flex-1 space-y-2.5 p-3.5">
                    <p className="text-[11px] leading-relaxed text-slate-400">{layer.description}</p>
                    {swatches.length > 0 ? (
                      <div className="flex flex-wrap gap-1.5">
                        {swatches.map(([code, meta]) => (
                          <span key={code} className="inline-flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.02] px-1.5 py-0.5 text-[9.5px] text-slate-400">
                            <span className="h-2 w-2 rounded-sm" style={{ background: meta.color }} />
                            {meta.label}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <div className="text-[9.5px] text-slate-600">Outline layer · {(layer.style.weight ?? 1).toFixed(1)} px stroke</div>
                    )}
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-white/[0.055] px-3.5 py-2">
                    <button type="button" className={clsx('btn btn-xs', on ? 'btn-primary' : '')} onClick={() => toggle(layer.id)}>
                      {on ? <Eye size={11} /> : <EyeOff size={11} />}
                      {on ? 'Hide' : 'Preview'}
                    </button>
                    {getSession()?.role !== 'rd' && (
                      <button type="button" className="btn btn-xs btn-ghost" onClick={() => requestGeoJson(async () => {
                        const response = await fetch(dataUrl(`geojson/${layer.file}`), { credentials: 'include' });
                        if (!response.ok) {
                          window.alert('Could not download this layer. Sign in with the GIS account and try again.');
                          return;
                        }
                        const url = URL.createObjectURL(await response.blob());
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = layer.file;
                        document.body.appendChild(a);
                        a.click();
                        a.remove();
                        URL.revokeObjectURL(url);
                      })}>
                        <Download size={11} /> GeoJSON
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ))}

      <Panel title="Bundle notes" subtitle="How the overlays are prepared" action={<MousePointer2 size={14} className="text-slate-500" />}>
        <div className="grid gap-3 text-[11px] leading-relaxed text-slate-400 md:grid-cols-3">
          <div>
            <b className="text-slate-200">Dissolve & simplify.</b> Polygons are grouped by their classification field, repaired, then simplified with mapshaper. Topology-preserving simplification keeps shared boundaries aligned.
          </div>
          <div>
            <b className="text-slate-200">Pre-computed screening.</b> Point-in-polygon results are stored directly on permits and sites, so map filters do not need to recalculate intersections in the browser.
          </div>
          <div>
            <b className="text-slate-200">Provenance.</b> Layers came from the supplied DENR Region VII spatial folder and cover Central Visayas administrative units, hazards, protected areas, watersheds and land cover.
          </div>
        </div>
        {hovered && (
          <div className="mt-3 border-t border-white/[0.05] pt-2 font-mono text-[9.5px] text-slate-600">
            {data.layers.layers.find((layer) => layer.id === hovered)?.file}
          </div>
        )}
      </Panel>
    </div>
  );
}
