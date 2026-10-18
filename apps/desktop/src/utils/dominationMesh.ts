/**
 * Mesh domination protocol (Fase 5/6 + hardening wave). Domination actions
 * travel as SEALED bodies inside kind='mail' envelopes over the blind courier
 * — the same transport as DMs — so the server never sees content and no ledger
 * is touched: mesh sends are free and social. The RECEIVER's client is the
 * consent authority (isActionConsented against its local settings); unknown
 * actions and malformed bodies decode to null and are never executed (no
 * blind execution).
 *
 * Wire bodies (all JSON, sealed end-to-end):
 * - { t:'dom_request', id, action, payload?, n?, exp? } — the ask. `id` is the
 *   idempotency key: retries resend the SAME id, the receiver executes at most
 *   once per id. `exp` (epoch ms) is the hard expiry: a request drained from a
 *   courier box after its TTL is rejected, never executed.
 * - { t:'dom_receipt', id, status } — the answer. Statuses distinguish the
 *   whole lifecycle: landed (consented + received) -> completed | failed
 *   (execution outcome), declined (receiver refused), expired (too late).
 * - { t:'dom_photo', id, n?, data } — the captured frame for a camera request,
 *   sealed like everything else so the photo crosses peers without any server
 *   media store.
 *
 * Payloads are VALIDATED AND CLAMPED here, on both sides: the receiver never
 * trusts the sender's numbers (duration/intensity/text length/url scheme), and
 * unknown payload keys are stripped so nothing rides along unvalidated.
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

/** Hard bounds for every effect input. The receiver clamps to these before
 *  any side effect; the sender applies the same clamps before sealing. */
export const DOM_LIMITS = {
  urlMaxLen: 2048,
  textMax: { message: 280, text_overlay: 120 } as Record<string, number>,
  duration: { min: 5_000, max: 15 * 60_000, default: 60_000, messageDefault: 10_000 },
  intensity: { min: 1, max: 30, default: 8 },
  colorMaxLen: 16,
  quality: { min: 0.3, max: 0.95, default: 0.8 },
  /** dom_request TTL: a courier box drained later than this rejects. */
  requestTtl: { default: 10 * 60_000, max: 24 * 60 * 60_000 },
  /** Inline sealed media cap (camera frames). Bigger media does not ride. */
  photoMaxBytes: 8 * 1024 * 1024,
  /** Inline image cap for wallpaper/game_bg data URLs: the whole sealed
   *  envelope rides the courier mail PUT, so it stays well inside realistic
   *  body limits (a 1080p JPEG at q80 is 0.3-0.8MB). */
  inlineImageMaxBytes: 4 * 1024 * 1024,
  /** Receiver-side per-sender+action spacing (mirrors the server cooldown). */
  rateIntervalMs: 30_000,
  /** Bounded idempotency memory + pending camera queue. */
  seenCap: 1000,
  pendingCameraCap: 3,
} as const;

const POSITIONS = new Set(['top', 'bottom', 'center', 'left', 'right']);
const SIZES = new Set(['small', 'medium', 'large']);

export type DomReceiptStatus = 'landed' | 'declined' | 'completed' | 'failed' | 'expired';

export interface DomRequest {
  t: 'dom_request';
  id: string;
  action: string;
  payload?: unknown;
  /** Hard expiry (epoch ms). Requests drained after this are rejected. */
  exp?: number;
  /** Sender display name at send time (sealed, like DMs). */
  n?: string;
}

export interface DomReceipt {
  t: 'dom_receipt';
  /** Request id this receipt answers. */
  id: string;
  status: DomReceiptStatus;
}

export interface DomPhoto {
  t: 'dom_photo';
  /** The camera request this frame answers. */
  id: string;
  /** Sender display name (sealed). */
  n?: string;
  /** image/jpeg data URL, <= DOM_LIMITS.photoMaxBytes when sealed. */
  data: string;
}

export function newDomId(): string {
  return `dom-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : fallback;
  return Math.min(max, Math.max(min, n));
}

function clampDuration(v: unknown, fallback: number): number {
  return clampNumber(v, DOM_LIMITS.duration.min, DOM_LIMITS.duration.max, fallback);
}

const INLINE_IMAGE_RE = /^data:image\/(png|jpeg|webp);base64,/;

/** A reachable https URL, or (for effects that may inline their media) a
 *  data: image under the byte cap — that is how wallpaper/game_bg cross peers
 *  with no shared server: the bytes ride inside the sealed envelope. Video
 *  never inlines (too big), so popup_video stays https-only. */
function validEffectUrl(v: unknown, allowInlineImage: boolean): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  if (allowInlineImage && INLINE_IMAGE_RE.test(s)) {
    // ~4/3 of the byte cap survives base64; reject before sealing.
    if (s.length > Math.ceil((DOM_LIMITS.inlineImageMaxBytes * 4) / 3) + 128) return null;
    return s;
  }
  if (s.length > DOM_LIMITS.urlMaxLen) return null;
  if (!/^https:\/\//i.test(s)) return null;
  return s;
}

export type ValidatedPayload = { ok: true; payload: Record<string, unknown> } | { ok: false; reason: string };

/**
 * Validate + clamp a payload for an action. Unknown keys are stripped, numbers
 * are clamped into DOM_LIMITS, text is length-capped, urls must be https.
 * Sender and receiver both run this: the sender fails loud before sealing, the
 * receiver refuses (never executes) anything that does not pass.
 */
export function validateDomPayload(action: string, raw: unknown): ValidatedPayload {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Record<string, unknown> = {};

  switch (action) {
    case 'wallpaper':
    case 'game_bg': {
      const url = validEffectUrl(src.url, true);
      if (!url) return { ok: false, reason: 'media must be an https url or an inline image under 4 MB' };
      out.url = url;
      out.duration = clampDuration(src.duration, DOM_LIMITS.duration.default);
      return { ok: true, payload: out };
    }
    case 'popup_video': {
      const url = validEffectUrl(src.url, false);
      if (!url) return { ok: false, reason: 'media url must be https and under 2 KiB' };
      out.url = url;
      out.duration = clampDuration(src.duration, DOM_LIMITS.duration.default);
      return { ok: true, payload: out };
    }
    case 'message': {
      const text = typeof src.text === 'string' ? src.text.trim().slice(0, DOM_LIMITS.textMax.message) : '';
      if (!text) return { ok: false, reason: 'message text is required' };
      out.text = text;
      out.duration = clampDuration(src.duration, DOM_LIMITS.duration.messageDefault);
      return { ok: true, payload: out };
    }
    case 'text_overlay': {
      const text = typeof src.text === 'string' ? src.text.trim().slice(0, DOM_LIMITS.textMax.text_overlay) : '';
      if (!text) return { ok: false, reason: 'banner text is required' };
      out.text = text;
      out.position = POSITIONS.has(String(src.position)) ? String(src.position) : 'center';
      out.size = SIZES.has(String(src.size)) ? String(src.size) : 'large';
      const color = typeof src.color === 'string' ? src.color : '';
      out.color = /^#[0-9a-fA-F]{3,8}$/.test(color) && color.length <= DOM_LIMITS.colorMaxLen ? color : '#9FE3FF';
      out.duration = clampDuration(src.duration, DOM_LIMITS.duration.default);
      return { ok: true, payload: out };
    }
    case 'blur': {
      out.intensity = clampNumber(src.intensity, DOM_LIMITS.intensity.min, DOM_LIMITS.intensity.max, DOM_LIMITS.intensity.default);
      out.duration = clampDuration(src.duration, DOM_LIMITS.duration.default);
      return { ok: true, payload: out };
    }
    case 'camera': {
      out.quality = clampNumber(src.quality, DOM_LIMITS.quality.min, DOM_LIMITS.quality.max, DOM_LIMITS.quality.default);
      out.isPublic = src.isPublic === true;
      return { ok: true, payload: out };
    }
    default:
      return { ok: false, reason: 'unknown action' };
  }
}

export function encodeDomRequest(req: {
  id: string;
  action: string;
  payload?: unknown;
  senderName?: string;
  /** Hard expiry (epoch ms). Omitted only by pre-hardening senders. */
  exp?: number;
}): string {
  const name = req.senderName?.trim();
  return JSON.stringify({
    t: 'dom_request',
    id: req.id,
    action: req.action,
    ...(req.payload !== undefined ? { payload: req.payload } : {}),
    ...(typeof req.exp === 'number' ? { exp: req.exp } : {}),
    ...(name ? { n: name } : {}),
  });
}

export function encodeDomReceipt(requestId: string, status: DomReceiptStatus): string {
  return JSON.stringify({ t: 'dom_receipt', id: requestId, status });
}

export function encodeDomPhoto(photo: { id: string; data: string; senderName?: string }): string {
  const name = photo.senderName?.trim();
  return JSON.stringify({
    t: 'dom_photo',
    id: photo.id,
    data: photo.data,
    ...(name ? { n: name } : {}),
  });
}

/** Strict decode: anything foreign (DMs, signals, garbage, unknown action,
 *  wrong types) is null — the caller must drop it, never execute it. */
export function decodeDomBody(json: string): DomRequest | DomReceipt | DomPhoto | null {
  try {
    const parsed = JSON.parse(json) as Record<string, unknown>;
    if (parsed.t === 'dom_request' && typeof parsed.id === 'string' && typeof parsed.action === 'string') {
      if (!(parsed.action in DOM_ACTION_CONSENT)) return null;
      // A malformed exp must not poison the request: drop it, the receiver
      // then treats the request as fresh (pre-hardening sender compat).
      const exp = typeof parsed.exp === 'number' && Number.isFinite(parsed.exp) ? parsed.exp : undefined;
      const req: DomRequest = {
        t: 'dom_request',
        id: parsed.id,
        action: parsed.action,
        ...(parsed.payload !== undefined ? { payload: parsed.payload } : {}),
        ...(exp !== undefined ? { exp } : {}),
        ...(typeof parsed.n === 'string' ? { n: parsed.n } : {}),
      };
      return req;
    }
    if (parsed.t === 'dom_receipt' && typeof parsed.id === 'string') {
      const status = parsed.status;
      if (status === 'landed' || status === 'declined' || status === 'completed' || status === 'failed' || status === 'expired') {
        return { t: 'dom_receipt', id: parsed.id, status };
      }
      return null;
    }
    if (parsed.t === 'dom_photo' && typeof parsed.id === 'string' && typeof parsed.data === 'string') {
      if (!/^data:image\/(png|jpeg|webp);base64,/.test(parsed.data)) return null;
      // ~4/3 of the byte cap survives base64; reject oversized frames early.
      if (parsed.data.length > Math.ceil((DOM_LIMITS.photoMaxBytes * 4) / 3) + 128) return null;
      return {
        t: 'dom_photo',
        id: parsed.id,
        data: parsed.data,
        ...(typeof parsed.n === 'string' ? { n: parsed.n } : {}),
      };
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
