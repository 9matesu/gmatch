/**
 * Mesh domination protocol (Fase 5/6). Domination actions travel as SEALED
 * bodies inside kind='mail' envelopes over the blind courier — the same
 * transport as DMs — so the server never sees content and no ledger is
 * touched: mesh sends are free and social. The RECEIVER's client is the
 * consent authority (isActionConsented against its local settings); unknown
 * actions and malformed bodies decode to null and are never executed
 * (no blind execution).
 *
 * Wire bodies (all JSON, sealed end-to-end):
 * - { t:'dom_request', id, action, payload?, intensity?, n? } — the ask.
 *   `id` is the idempotency key: retries resend the SAME id, the receiver
 *   executes at most once per id.
 * - { t:'dom_receipt', id, status } — landed | declined, keyed on the
 *   request id so the sender's outbox flips without a server history fetch.
 */

/** Action -> receiver consent key. Single source of truth for the mesh gate
 *  (mirrors the server consent map; the mesh path never asks the server). */
export const DOM_ACTION_CONSENT: Record<string, string> = {
  wallpaper: 'allowDesktopBackgroundChange',
  game_bg: 'allowGameBackgroundChange',
  popup_video: 'allowPopupVideo',
  message: 'allowPopupMessage',
  text_overlay: 'allowTextOverlay',
  blur: 'allowBlurEverything',
  camera: 'allowRemoteCamera',
};

export interface DomRequest {
  t: 'dom_request';
  id: string;
  action: string;
  payload?: unknown;
  intensity?: string;
  /** Sender display name at send time (sealed, like DMs). */
  n?: string;
}

export interface DomReceipt {
  t: 'dom_receipt';
  /** Request id this receipt answers. */
  id: string;
  status: 'landed' | 'declined';
}

export function newDomId(): string {
  return `dom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export function encodeDomRequest(req: {
  id: string;
  action: string;
  payload?: unknown;
  intensity?: string;
  senderName?: string;
}): string {
  const name = req.senderName?.trim();
  return JSON.stringify({
    t: 'dom_request',
    id: req.id,
    action: req.action,
    ...(req.payload !== undefined ? { payload: req.payload } : {}),
    ...(req.intensity ? { intensity: req.intensity } : {}),
    ...(name ? { n: name } : {}),
  });
}

export function encodeDomReceipt(requestId: string, status: 'landed' | 'declined'): string {
  return JSON.stringify({ t: 'dom_receipt', id: requestId, status });
}

/** Strict decode: anything foreign (DMs, signals, garbage, unknown action,
 *  wrong types) is null — the caller must drop it, never execute it. */
export function decodeDomBody(json: string): DomRequest | DomReceipt | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.t === 'dom_request' && typeof parsed.id === 'string' && typeof parsed.action === 'string') {
      if (!(parsed.action in DOM_ACTION_CONSENT)) return null;
      return parsed as unknown as DomRequest;
    }
    if (parsed.t === 'dom_receipt' && typeof parsed.id === 'string' && (parsed.status === 'landed' || parsed.status === 'declined')) {
      return parsed as unknown as DomReceipt;
    }
  } catch { /* foreign body — not domination */ }
  return null;
}

/**
 * Receiver-side consent gate. Only an explicit `true` on the action's key
 * passes — missing, false, or non-boolean values are all NO (closed by
 * default, same posture as the server 403 path it replaces).
 */
export function isActionConsented(consentMap: Record<string, unknown>, action: string): boolean {
  const key = DOM_ACTION_CONSENT[action];
  if (!key) return false;
  return consentMap[key] === true;
}
