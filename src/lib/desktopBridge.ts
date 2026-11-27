/**
 * Thin bridge to the WebView2 host. Present only in the installed desktop app;
 * a normal browser gets `null` and keeps the written instructions instead.
 *
 * The desktop app answers `envis:switch` with `envis:switch-result`, so the page
 * can show why a live dashboard was not reachable instead of navigating to a
 * blank window.
 */

interface WebViewHost {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
  removeEventListener(type: 'message', handler: (event: { data: unknown }) => void): void;
}

export type SwitchMode = 'online' | 'offline';

export interface SwitchResult {
  type?: string;
  ok?: boolean;
  message?: string;
}

export function desktopBridge(): WebViewHost | null {
  if (typeof window === 'undefined') return null;
  const host = (window as unknown as { chrome?: { webview?: WebViewHost } }).chrome;
  return host?.webview ?? null;
}

export function requestSwitch(bridge: WebViewHost | null, mode: SwitchMode): boolean {
  if (!bridge) return false;
  bridge.postMessage({ type: 'envis:switch', mode });
  return true;
}
