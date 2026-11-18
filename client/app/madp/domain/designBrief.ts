// Pure rules of the Screens & design instruction (requirements step).
// No React, DOM, storage, SDK or network: the functions bundle this file unchanged.
import { MIME_EXTENSIONS, magicMatches as sharedMagicMatches } from './uploads';

export const DESIGN_MODES = ['figma', 'sample', 'describe'] as const;
export type DesignMode = (typeof DESIGN_MODES)[number];
export function isDesignMode(x: unknown): x is DesignMode {
  return typeof x === 'string' && (DESIGN_MODES as readonly string[]).includes(x);
}

export const DESIGN_BRIEF_STATUSES = ['draft', 'confirmed'] as const;
export type DesignBriefStatus = (typeof DESIGN_BRIEF_STATUSES)[number];

export const SAMPLE_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'] as const;
export type SampleMime = (typeof SAMPLE_MIME_TYPES)[number];

function canonicalMime(x: unknown): SampleMime | null {
  if (typeof x !== 'string') return null;
  const base = x.split(';')[0].trim().toLowerCase();
  return (SAMPLE_MIME_TYPES as readonly string[]).includes(base) ? (base as SampleMime) : null;
}

export function isSampleMime(x: unknown): x is SampleMime {
  return canonicalMime(x) !== null;
}

export const SAMPLE_EXTENSION: Record<SampleMime, string> = {
  'image/png': MIME_EXTENSIONS['image/png'].slice(1),
  'image/jpeg': MIME_EXTENSIONS['image/jpeg'].slice(1),
  'image/webp': MIME_EXTENSIONS['image/webp'].slice(1),
  'application/pdf': MIME_EXTENSIONS['application/pdf'].slice(1),
};

const VALID_EXTENSIONS: Record<SampleMime, readonly string[]> = {
  'image/png': ['png'],
  'image/jpeg': ['jpg', 'jpeg'],
  'image/webp': ['webp'],
  'application/pdf': ['pdf'],
};

export const SAMPLE_ACCEPT = '.png,.jpg,.jpeg,.webp,.pdf';

export const SAMPLE_LIMITS = {
  maxFileBytes: 10 * 1024 * 1024,
  maxSamples: 10,
  maxTotalBytes: 50 * 1024 * 1024,
  storedNameMax: 120,
  staleUploadMs: 3600000,
  magicBytes: 16,
} as const;

export const INSTRUCTIONS_LIMITS = { min: 20, max: 10000 } as const;
export const MAX_REFERENCES = 10;

export type SampleUploadCheck =
  | { ok: true }
  | {
      ok: false;
      code: 'invalid_input' | 'too_large' | 'limit_reached';
      reason: 'type' | 'empty' | 'size' | 'count' | 'total';
    };

export function checkSampleUpload(input: {
  mime: string;
  sizeBytes: number;
  existing: readonly { sizeBytes: number; status: string }[];
}): SampleUploadCheck {
  if (!isSampleMime(input.mime)) return { ok: false, code: 'invalid_input', reason: 'type' };
  const size = input.sizeBytes;
  if (!Number.isInteger(size) || size <= 0) return { ok: false, code: 'invalid_input', reason: 'empty' };
  if (size > SAMPLE_LIMITS.maxFileBytes) return { ok: false, code: 'too_large', reason: 'size' };
  const live = input.existing.filter((e) => e.status === 'pending' || e.status === 'ready');
  if (live.length >= SAMPLE_LIMITS.maxSamples) return { ok: false, code: 'limit_reached', reason: 'count' };
  const total = live.reduce((sum, e) => sum + (Number(e.sizeBytes) || 0), 0);
  if (total + size > SAMPLE_LIMITS.maxTotalBytes) return { ok: false, code: 'limit_reached', reason: 'total' };
  return { ok: true };
}

/** A storage-safe file name that always carries an extension matching the MIME type. */
export function normaliseStoredName(fileName: string, mime: string): string | null {
  const type = canonicalMime(mime);
  if (!type) return null;
  let name = String(fileName ?? '');
  name = name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
  name = name
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '');
  let base = name;
  let ext = SAMPLE_EXTENSION[type];
  const dot = name.lastIndexOf('.');
  if (dot > 0) {
    const last = name.slice(dot + 1).toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(last)) {
      if (VALID_EXTENSIONS[type].includes(last)) {
        ext = last;
        base = name.slice(0, dot);
      } else {
        base = name.slice(0, dot);
      }
    }
  }
  base = base.replace(/[ .]+$/g, '');
  if (!base) base = 'sample';
  const room = SAMPLE_LIMITS.storedNameMax - ext.length - 1;
  if (base.length > room) base = base.slice(0, room).replace(/[ .]+$/g, '') || 'sample';
  return `${base}.${ext}`;
}

export function magicMatches(mime: string, firstBytes: ArrayLike<number>): boolean {
  const type = canonicalMime(mime);
  if (!type || !firstBytes) return false;
  return sharedMagicMatches(type, firstBytes);
}

export function extractReferences(text: string): string[] {
  const out: string[] = [];
  for (const raw of String(text ?? '').split(/[\s<>"')\]]+/)) {
    if (!/^https?:\/\//i.test(raw)) continue;
    const candidate = raw.replace(/[.,;:!?]+$/, '');
    let url: URL;
    try {
      url = new URL(candidate);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' || !url.hostname || url.username || url.password) continue;
    const href = url.toString();
    if (out.includes(href)) continue;
    out.push(href);
    if (out.length >= MAX_REFERENCES) break;
  }
  return out;
}

export interface BriefState {
  mode: DesignMode;
  instructions: string;
  sampleIds: readonly string[];
  status: DesignBriefStatus;
}

export interface BriefPatch {
  mode?: DesignMode;
  instructions?: string;
  sampleIds?: readonly string[];
}

function sameOrder(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** A changed confirmed brief goes back to draft; switching mode keeps the instructions. */
export function applyPatch(brief: BriefState, patch: BriefPatch): { next: BriefState; changed: boolean } {
  const mode = patch.mode !== undefined ? patch.mode : brief.mode;
  const instructions = patch.instructions !== undefined ? patch.instructions : brief.instructions;
  const sampleIds = patch.sampleIds !== undefined ? [...patch.sampleIds] : [...brief.sampleIds];
  const changed =
    mode !== brief.mode || instructions !== brief.instructions || !sameOrder(sampleIds, brief.sampleIds);
  const status: DesignBriefStatus = changed && brief.status === 'confirmed' ? 'draft' : brief.status;
  return { next: { mode, instructions, sampleIds, status }, changed };
}

/** Exact permutation check of a requested sample order against the ready ids. */
export function checkSampleOrder(order: readonly string[], readyIds: readonly string[]): boolean {
  if (order.length !== readyIds.length) return false;
  const seen = new Set(order);
  if (seen.size !== order.length) return false;
  return readyIds.every((id) => seen.has(id));
}

export type ConfirmCheck =
  | { ok: true }
  | { ok: false; reason: 'no_sample' | 'instructions_short' | 'instructions_long' };

export function checkConfirm(
  brief: { mode: DesignMode; instructions: string },
  readySamples: readonly unknown[],
): ConfirmCheck {
  const text = String(brief.instructions ?? '');
  if (brief.mode === 'sample') {
    if (readySamples.length < 1) return { ok: false, reason: 'no_sample' };
    if (text.length > INSTRUCTIONS_LIMITS.max) return { ok: false, reason: 'instructions_long' };
    return { ok: true };
  }
  const len = text.trim().length;
  if (len < INSTRUCTIONS_LIMITS.min) return { ok: false, reason: 'instructions_short' };
  if (len > INSTRUCTIONS_LIMITS.max) return { ok: false, reason: 'instructions_long' };
  return { ok: true };
}

export function isStaleUpload(
  att: { status: string; createdAt: string | number | Date | null | undefined },
  now: number,
): boolean {
  if (att.status !== 'pending' || att.createdAt == null) return false;
  const t = att.createdAt instanceof Date ? att.createdAt.getTime() : new Date(att.createdAt).getTime();
  if (!Number.isFinite(t)) return false;
  return now - t > SAMPLE_LIMITS.staleUploadMs;
}
