/**
 * Shared summary-preference storage. Used by:
 *  - the Angular popup (read + write via the settings UI)
 *  - the content script (read before sending a summarize request)
 *  - the background service worker (read when invoking the Summarizer API)
 *
 * Backed by chrome.storage.local so values persist across browser
 * restarts and stay scoped to the user's profile.
 */

export type SummaryFormat = 'key-points' | 'tldr';
export type SummaryLength = 'short' | 'medium' | 'long';

export interface SummarySettings {
  /** 'key-points' = bullet list, 'tldr' = single paragraph. */
  format: SummaryFormat;
  /** Maps to the Summarizer API's length parameter. */
  length: SummaryLength;
}

export const DEFAULT_SETTINGS: SummarySettings = {
  format: 'key-points',
  length: 'medium',
};

const STORAGE_KEY = 'summarySettings';

function normalize(input: unknown): SummarySettings {
  const fallback = DEFAULT_SETTINGS;
  if (!input || typeof input !== 'object') return { ...fallback };
  const raw = input as Partial<SummarySettings>;
  const format: SummaryFormat =
    raw.format === 'tldr' || raw.format === 'key-points' ? raw.format : fallback.format;
  const length: SummaryLength =
    raw.length === 'short' || raw.length === 'medium' || raw.length === 'long'
      ? raw.length
      : fallback.length;
  return { format, length };
}

export async function getSummarySettings(): Promise<SummarySettings> {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  return normalize(stored[STORAGE_KEY]);
}

export async function setSummarySettings(
  patch: Partial<SummarySettings>,
): Promise<SummarySettings> {
  const current = await getSummarySettings();
  const next = normalize({ ...current, ...patch });
  await chrome.storage.local.set({ [STORAGE_KEY]: next });
  return next;
}

/** Human-readable label for a settings value. Used by the popup UI. */
export const FORMAT_LABELS: Record<SummaryFormat, string> = {
  'key-points': 'Bullets',
  tldr: 'Paragraph',
};

export const LENGTH_LABELS: Record<SummaryLength, string> = {
  short: 'Short',
  medium: 'Medium',
  long: 'Long',
};
