import { useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, Layers, Monitor, Search, Smartphone, Tablet, ZoomIn, ZoomOut } from 'lucide-react';
import { Button, Modal } from '@/madp/ui/kit';
import { screenRequirementTitles } from '@/madp/domain/factoryDesign';
import { t, useT } from "@/madp/i18n";

export interface ScreenExport { name: string; nodeId: string; requirementKeys: string[]; png: string; width: number; height: number }
type Device = 'All screens' | 'Desktop' | 'Tablet' | 'Mobile';
/** A device filter's name in the chosen language (the Device values stay as they are). */
function deviceName(d: string): string {
  switch (d) {
    case 'All screens': return t("analysis.design.device.all", "All screens");
    case 'Desktop': return t("analysis.design.device.desktop", "Desktop");
    case 'Tablet': return t("analysis.design.device.tablet", "Tablet");
    case 'Mobile': return t("analysis.design.device.mobile", "Mobile");
    default: return d;
  }
}

export const screenDevice = (width: number): Device => width <= 600 ? 'Mobile' : width <= 1024 ? 'Tablet' : 'Desktop';

export function DesignViewer({ open, onClose, previewUrl, incomplete, initialNodeId, requirements }: {
  open: boolean; onClose: () => void; previewUrl: string; incomplete: boolean;
  /** The screen to show first (a screen tile opened the viewer); the first screen when it is not among the exports. */
  initialNodeId?: string | null;
  /** The project's requirements (key and title): a screen lists the ones it shows by title, not by key. */
  requirements?: readonly { key: string; title: string }[];
}) {
  const t = useT();
  const [screens, setScreens] = useState<ScreenExport[]>([]);
  const [loading, setLoading] = useState(false), [error, setError] = useState(false);
  const [device, setDevice] = useState<Device>('All screens'), [query, setQuery] = useState(''), [selected, setSelected] = useState('');
  const [zoom, setZoom] = useState<number | null>(null), [canvasSize, setCanvasSize] = useState({ width: 600, height: 480 });
  const canvas = useRef<HTMLDivElement>(null);
  const canvasBounds = useRef({ width: 0, height: 0 });
  useEffect(() => {
    if (!open) return;
    const abort = new AbortController(); setLoading(true); setError(false); setScreens([]); setDevice('All screens'); setQuery(''); setZoom(null);
    void fetch(`${previewUrl}/screens`, { credentials: 'same-origin', signal: abort.signal }).then(async (r) => {
      if (!r.ok) throw new Error('unavailable');
      const data = await r.json();
      if (!Array.isArray(data.screens) || !data.screens.length || data.screens.length > 80 || !data.screens.every((s: ScreenExport) =>
        typeof s.name === 'string' && typeof s.nodeId === 'string' && typeof s.png === 'string' && /^[A-Za-z0-9+/]+={0,2}$/.test(s.png) && s.width > 0 && s.width <= 20000 && s.height > 0 && s.height <= 100000)) throw new Error('invalid');
      setScreens(data.screens);
      setSelected(initialNodeId && data.screens.some((s: ScreenExport) => s.nodeId === initialNodeId) ? initialNodeId : data.screens[0].nodeId);
    }).catch(() => { if (!abort.signal.aborted) setError(true); }).finally(() => { if (!abort.signal.aborted) setLoading(false); });
    return () => abort.abort();
  }, [open, previewUrl, initialNodeId]);
  useEffect(() => {
    if (!open || !canvas.current) return;
    const observer = new ResizeObserver(([entry]) => {
      setCanvasSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      const bounds = entry.target.getBoundingClientRect();
      if (Math.abs(bounds.width - canvasBounds.current.width) > 1 || Math.abs(bounds.height - canvasBounds.current.height) > 1) setZoom(null);
      canvasBounds.current = { width: bounds.width, height: bounds.height };
    });
    observer.observe(canvas.current); return () => observer.disconnect();
  }, [open, loading]);
  const filtered = screens.filter((s) => (device === 'All screens' || screenDevice(s.width) === device) && s.name.toLowerCase().includes(query.toLowerCase()));
  const active = filtered.find((s) => s.nodeId === selected) ?? filtered[0];
  const index = active ? filtered.indexOf(active) : -1;
  const shows = active && Array.isArray(active.requirementKeys) ? screenRequirementTitles(active.requirementKeys, requirements ?? []) : [];
  const scale = zoom ?? (active ? Math.max(0.001, Math.min(1, (canvasSize.width - 2) / active.width, (canvasSize.height - 2) / active.height)) : 1);
  useEffect(() => { setZoom(null); canvas.current?.scrollTo({ top: 0, left: 0 }); }, [active?.nodeId]);
  const select = (id: string) => { setSelected(id); setZoom(null); canvas.current?.scrollTo({ top: 0, left: 0 }); };
  return <Modal open={open} onClose={onClose} title={t("analysis.design.viewer.title", "Product design")} width={1320}>
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-ink3">{loading ? t("analysis.design.viewer.loadingSaved", "Loading saved screen designs…") : t("analysis.design.viewer.previews", "{count} screen previews", { count: screens.length })} · {incomplete ? t("analysis.design.viewer.inProgress", "Work in progress") : t("analysis.design.viewer.readyForReview", "Ready for review")}</p>
        <div className="flex flex-wrap gap-1 rounded-full bg-surface2 p-1" aria-label={t("analysis.design.viewer.filterAria", "Filter screens by device")}>
          {(['All screens', 'Desktop', 'Tablet', 'Mobile'] as Device[]).map((d) => {
            const Icon = d === 'Desktop' ? Monitor : d === 'Mobile' ? Smartphone : d === 'Tablet' ? Tablet : Layers;
            return <button key={d} type="button" aria-pressed={device === d} onClick={() => { setDevice(d); setZoom(null); }} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-2 text-[12px] font-medium transition ${device === d ? 'bg-accent text-white shadow-sm' : 'text-ink2 hover:bg-line'}`}><Icon size={14} />{deviceName(d)}<span className="opacity-70">{screens.filter((s) => d === 'All screens' || screenDevice(s.width) === d).length}</span></button>;
          })}
        </div>
      </div>
      <div className="flex h-[min(68dvh,720px)] min-h-[300px] flex-col overflow-hidden rounded-card border border-line bg-canvas sm:flex-row">
        <aside className="flex h-[138px] w-full shrink-0 flex-col border-b border-line bg-surface sm:h-auto sm:w-[190px] sm:border-b-0 sm:border-r" aria-label={t("analysis.design.viewer.navigatorAria", "Screen navigator")}>
          <label className="m-2 flex items-center gap-2 rounded-xl border border-line bg-surface2 px-2.5 py-1.5 text-ink3 sm:m-3 sm:py-2"><Search size={14} className="shrink-0" /><input aria-label={t("analysis.design.viewer.searchAria", "Search screens")} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("analysis.design.viewer.searchPlaceholder", "Find a screen")} className="min-w-0 w-full bg-transparent text-[12px] text-ink outline-none" /></label>
          <div className="scroll-thin flex min-h-0 flex-1 gap-2 overflow-x-auto px-3 pb-3 sm:block sm:space-y-2 sm:overflow-x-hidden sm:overflow-y-auto">
            {filtered.map((s, i) => <button key={s.nodeId} type="button" aria-pressed={active?.nodeId === s.nodeId} onClick={() => select(s.nodeId)} className={`w-[112px] shrink-0 rounded-xl border p-2 text-left transition sm:w-full ${active?.nodeId === s.nodeId ? 'border-accent bg-accent-soft ring-1 ring-accent/20' : 'border-line hover:border-ink3'}`}>
              <div className="mb-1 flex h-[32px] justify-center overflow-hidden rounded bg-canvas sm:mb-2 sm:h-[76px]"><img src={`data:image/png;base64,${s.png}`} alt="" className="max-w-full object-contain object-top" loading="lazy" /></div>
              <span className="block text-[12px] font-medium leading-snug text-ink"><span className="mr-1 text-ink3">{String(i + 1).padStart(2, '0')}</span>{s.name.replace(/^\d+[. -]*/, '')}</span>
              <span className="mt-1 hidden text-[11px] text-ink3 sm:block">{screenDevice(s.width)}</span>
            </button>)}
          </div>
        </aside>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line bg-surface px-4 py-3">
            <div className="min-w-0"><h4 className="truncate text-[14px] font-medium text-ink">{active?.name ?? 'Screen preview'}</h4>{active && <p className="mt-0.5 text-[11px] text-ink3">{screenDevice(active.width)} · {active.width} × {active.height} · {index + 1} of {filtered.length}</p>}</div>
            <div className="flex items-center gap-1">
              <Button size="sm" variant="ghost" aria-label={t("analysis.design.viewer.zoomOut", "Zoom out")} disabled={!active || scale <= 0.25} onClick={() => setZoom(Math.max(0.25, scale - 0.25))}><ZoomOut size={14} /></Button>
              <button type="button" className="min-w-[54px] text-[12px] font-medium text-ink2" onClick={() => { setZoom(null); canvas.current?.scrollTo({ top: 0, left: 0 }); }} title={t("analysis.design.viewer.fitTitle", "Fit entire screen")}>{zoom === null ? t("analysis.design.viewer.fit", "Fit") : `${Math.round(scale * 100)}%`}</button>
              <Button size="sm" variant="ghost" aria-label={t("analysis.design.viewer.fitWidth", "Fit width")} disabled={!active} onClick={() => { if (active) { setZoom(Math.min(1, (canvasSize.width - 2) / active.width)); canvas.current?.scrollTo({ top: 0, left: 0 }); } }} title={t("analysis.design.viewer.widthTitle", "Fill the width and scroll for details")}>{t("analysis.design.viewer.width", "Width")}</Button>
              <Button size="sm" variant="ghost" aria-label={t("analysis.design.viewer.zoomIn", "Zoom in")} disabled={!active || scale >= 2} onClick={() => setZoom(Math.min(2, scale + 0.25))}><ZoomIn size={14} /></Button>
            </div>
          </div>
          <div ref={canvas} role="region" aria-label={t("analysis.design.viewer.canvasAria", "Design canvas")} tabIndex={0} className="scroll-thin min-h-0 flex-1 overflow-auto p-3 sm:p-8" style={{ scrollbarGutter: 'stable', backgroundImage: 'radial-gradient(rgb(var(--c-line)) 1px, transparent 1px)', backgroundSize: '16px 16px' }}>
            {loading ? <p role="status" className="py-16 text-center text-[14px] text-ink3">{t("analysis.design.viewer.loadingYours", "Loading your saved designs…")}</p> : error ? <p role="alert" className="py-16 text-center text-[14px] text-danger">{t("analysis.design.viewer.loadFailed", "The saved previews could not load. Close the viewer and try again.")}</p> : active ?
              <div className="flex items-center justify-center" style={{ width: Math.max(canvasSize.width, active.width * scale), minHeight: Math.max(canvasSize.height, active.height * scale) }}>
                <img key={active.nodeId} src={`data:image/png;base64,${active.png}`} alt={active.name} width={active.width} height={active.height} style={{ width: active.width * scale, maxWidth: 'none' }} className="block h-auto shrink-0 rounded-lg bg-white shadow-float ring-1 ring-black/5" />
              </div> :
              <div className="py-16 text-center"><Monitor size={30} className="mx-auto mb-3 text-ink3" /><p className="text-[14px] font-medium text-ink">{device === 'Desktop' ? t("analysis.design.viewer.noDesktop", "No desktop screens available") : device === 'Tablet' ? t("analysis.design.viewer.noTablet", "No tablet screens available") : device === 'Mobile' ? t("analysis.design.viewer.noMobile", "No mobile screens available") : t("analysis.design.viewer.noMatching", "No matching screens available")}</p><p className="mx-auto mt-2 max-w-[300px] text-[12px] text-ink3">{t("analysis.design.viewer.onlySaved", "Only actual saved exports appear here. A screen for another device is never substituted.")}</p></div>}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-line bg-surface px-4 py-2">
            <p className="text-[11px] text-ink3">{shows.length ? shows.join(' · ') : t("analysis.design.viewer.savedExport", "Screen design · saved export")}</p>
            <div className="flex gap-1"><Button size="sm" variant="ghost" aria-label={t("analysis.design.viewer.previous", "Previous screen")} disabled={index <= 0} onClick={() => select(filtered[index - 1].nodeId)}><ChevronLeft size={15} /></Button><Button size="sm" variant="ghost" aria-label={t("analysis.design.viewer.next", "Next screen")} disabled={index < 0 || index >= filtered.length - 1} onClick={() => select(filtered[index + 1].nodeId)}><ChevronRight size={15} /></Button></div>
          </div>
        </div>
      </div>
      <p className="text-[12px] text-ink3">{t("analysis.design.viewer.help", "Fit shows the whole screen. Use Width or zoom to inspect details. Device filters select the actual saved layouts.")}</p>
    </div>
  </Modal>;
}
