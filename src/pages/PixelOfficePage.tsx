import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Bot, Clock3, Maximize2, RefreshCw, ShieldCheck } from 'lucide-react';
import { apiJson } from '../lib/api';
import { useDashboard } from '../store/useDashboard';
import { Chip, Panel, SectionHeading } from '../components/ui';

interface PixelGrant {
  allowed: boolean;
  role: string;
  expiresAt: number;
  serverTime: number;
}

const ALLOWED_ROLES = ['mis', 'rd'];

export function PixelOfficePage() {
  const session = useDashboard((state) => state.session);
  const allowed = Boolean(session && ALLOWED_ROLES.includes(session.role));
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [grant, setGrant] = useState<PixelGrant | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);
  const [roomToast, setRoomToast] = useState<string | null>(null);

  const requestSession = useCallback(async () => {
    setError(null);
    try {
      const payload = await apiJson<PixelGrant>('/pixel/session', { method: 'POST' });
      setGrant(payload);
      setExpired(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not start the Pixel Office session.');
    }
  }, []);

  useEffect(() => {
    if (allowed) void requestSession();
  }, [allowed, requestSession, session?.username]);

  const postSession = useCallback(() => {
    if (!grant) return;
    iframeRef.current?.contentWindow?.postMessage(
      { type: 'envis:pixel-session', expiresAt: grant.expiresAt },
      window.location.origin,
    );
  }, [grant]);

  useEffect(() => {
    postSession();
  }, [postSession]);

  useEffect(() => {
    let toastTimer: ReturnType<typeof setTimeout> | null = null;
    const handler = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.type === 'envis:pixel-ready') postSession();
      if (data.type === 'envis:pixel-room') {
        setRoomToast(String(data.detail ?? 'a room'));
        if (toastTimer) window.clearTimeout(toastTimer);
        toastTimer = window.setTimeout(() => setRoomToast(null), 3200);
      }
    };
    window.addEventListener('message', handler);
    return () => {
      window.removeEventListener('message', handler);
      if (toastTimer) window.clearTimeout(toastTimer);
    };
  }, [postSession]);

  useEffect(() => {
    if (!grant) return;
    const timer = window.setInterval(() => {
      if (Date.now() >= grant.expiresAt) setExpired(true);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [grant]);

  if (!allowed) {
    return (
      <div className="animate-fade-up space-y-3">
        <SectionHeading
          eyebrow="Pixel office"
          title="Pixel Office"
          description="An animated EMB workplace with walking staff and scripted bot personas."
        />
        <Panel title="Access restricted">
          <div className="flex items-start gap-2 text-[12px] leading-relaxed text-slate-400">
            <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-300" />
            <div>
              This session is available only to <span className="kbd">MIS</span> and <span className="kbd">RD</span> accounts.
              Your current role is <span className="kbd">{session?.role ?? 'unknown'}</span>.
            </div>
          </div>
        </Panel>
      </div>
    );
  }

  const remaining = grant ? Math.max(0, grant.expiresAt - Date.now()) : 0;
  const minutes = Math.floor(remaining / 60000);
  const seconds = Math.floor((remaining % 60000) / 1000);

  return (
    <div className="animate-fade-up space-y-4">
      <SectionHeading
        eyebrow="Pixel office"
        title="Pixel Office — EMB Region VII"
        description="A 15-minute, MIS/RD-only session. Click any walking worker to chat with a scripted bot based on their real role, or click a room to see its personnel and functions."
        action={
          <div className="flex flex-wrap items-center gap-1.5">
            <Chip tone="emerald"><ShieldCheck size={10} /> {session?.role?.toUpperCase()}</Chip>
            <Chip tone={expired ? 'rose' : remaining < 120000 ? 'amber' : 'slate'}>
              <Clock3 size={10} /> {grant ? `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}` : 'STARTING'} left
            </Chip>
          </div>
        }
      />

      {error && (
        <Panel title="Session error">
          <div className="flex items-center justify-between gap-3 text-[12px] text-rose-200">
            <span>{error}</span>
            <button type="button" className="btn btn-ghost h-7 px-2 text-[10px]" onClick={() => void requestSession()}>
              <RefreshCw size={11} /> Retry
            </button>
          </div>
        </Panel>
      )}

      <Panel
        title="Interactive floor"
        subtitle="10 walking staff · 11 department hotspots · scripted bot chat"
        action={
          <div className="flex items-center gap-1.5">
            <Chip tone="sky"><Bot size={10} /> 10 bots</Chip>
            <button
              type="button"
              className="btn btn-ghost h-7 px-2 text-[10px]"
              onClick={() => iframeRef.current?.requestFullscreen?.()}
              title="Fullscreen"
            >
              <Maximize2 size={11} /> Fullscreen
            </button>
          </div>
        }
        bodyClassName="p-3"
      >
        <div className="relative overflow-hidden rounded-xl border border-white/[0.07] bg-[#071820]">
          <iframe
            ref={iframeRef}
            title="ENVIS Pixel Office"
            src={`${import.meta.env.BASE_URL}pixel-office/index.html`}
            className="block h-[clamp(520px,calc(100vh-300px),900px)] w-full border-0"
            onLoad={postSession}
          />
          {(!grant || expired) && (
            <div className="absolute inset-0 grid place-items-center bg-[#050d0b]/85 backdrop-blur-sm">
              <div className="max-w-sm rounded-xl border border-white/10 bg-ink-900 p-5 text-center">
                <AlertTriangle size={20} className="mx-auto mb-2 text-amber-300" />
                <h3 className="text-[13px] font-semibold text-slate-100">
                  {expired ? 'Pixel Office session expired' : 'Starting secure session…'}
                </h3>
                <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                  {expired
                    ? 'The 15-minute window has closed. Request a new session to continue.'
                    : 'Verifying MIS / RD access with the ENVIS API.'}
                </p>
                {expired && (
                  <button type="button" className="btn btn-ghost mt-3 h-8 px-3 text-[11px]" onClick={() => void requestSession()}>
                    <RefreshCw size={12} /> New session
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      </Panel>

      {roomToast && (
        <div className="fixed bottom-4 right-4 z-[1000] rounded-lg border border-emerald-400/25 bg-ink-900/95 px-3 py-2 text-[11px] text-emerald-200 shadow-panel">
          Room selected: <span className="font-mono">{roomToast}</span>
        </div>
      )}

      <Panel title="How this session works" subtitle="Everything here is additive and reversible" bodyClassName="p-4">
        <div className="grid gap-2 text-[11px] leading-relaxed text-slate-400 sm:grid-cols-3">
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Access</div>
            The Worker issues a 15-minute grant only for signed-in MIS and RD accounts. Each open is written to the activity log.
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Bots</div>
            Replies are scripted from each employee's real role and responsibilities. No external AI service or API key is used.
          </div>
          <div className="rounded-lg border border-white/[0.06] bg-white/[0.02] p-3">
            <div className="mb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Rollback</div>
            The game lives under <span className="kbd">public/pixel-office/</span> plus one page and nav entry. Remove those to restore the previous dashboard exactly.
          </div>
        </div>
      </Panel>
    </div>
  );
}
