/**
 * Background service worker.
 *
 * Two responsibilities:
 *   1. Relay messages from the Angular popup to the active YouTube tab's
 *      content script (popups can't call chrome.tabs.sendMessage directly).
 *   2. Run Chrome's built-in Summarizer API on demand and stream model-
 *      download progress back to whoever asked.
 *
 * The Summarizer global is exposed in MV3 service workers on Chrome 138+.
 * We declare its minimal shape here rather than depending on a typings pkg.
 */

import {
  getSummarySettings,
  type SummaryFormat,
  type SummaryLength,
} from '../shared/settings.js';

// ─── Summarizer API ambient types ────────────────────────────────────────

type SummarizerAvailability = 'unavailable' | 'downloadable' | 'downloading' | 'available';

interface SummarizerCreateMonitor {
  addEventListener(
    type: 'downloadprogress',
    listener: (event: { loaded: number }) => void,
  ): void;
}

interface SummarizerCreateOptions {
  type?: SummaryFormat;
  length?: SummaryLength;
  format?: 'plain-text' | 'markdown';
  sharedContext?: string;
  monitor?: (m: SummarizerCreateMonitor) => void;
}

interface SummarizerSession {
  summarize(input: string, options?: { context?: string }): Promise<string>;
  destroy(): void;
}

interface SummarizerStatic {
  availability(options?: SummarizerCreateOptions): Promise<SummarizerAvailability>;
  create(options?: SummarizerCreateOptions): Promise<SummarizerSession>;
}

declare const Summarizer: SummarizerStatic | undefined;

function summarizerSupported(): boolean {
  return typeof Summarizer !== 'undefined';
}

// ─── Message contracts ───────────────────────────────────────────────────

type RelayMessage =
  | { type: 'transcript-status?' }
  | { type: 'download-transcript' };

type DirectMessage =
  | { type: 'summarizer-availability?' }
  | { type: 'summarize-transcript'; text: string };

type IncomingMessage = RelayMessage | DirectMessage;

interface SummarizerAvailabilityResponse {
  supported: boolean;
  availability: SummarizerAvailability;
}

type SummarizeResponse =
  | { ok: true; summary: string }
  | { ok: false; reason: 'unavailable' | 'download-failed' | 'summarize-failed'; detail?: string };

// ─── Tab relay (popup ↔ content) ─────────────────────────────────────────

async function getActiveYouTubeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url) return null;
  try {
    const url = new URL(tab.url);
    if (url.hostname !== 'www.youtube.com') return null;
  } catch {
    return null;
  }
  return tab;
}

async function relayToContent(message: RelayMessage): Promise<unknown> {
  const tab = await getActiveYouTubeTab();
  if (!tab?.id) return { ok: false, reason: 'no-youtube-tab' };
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return { ok: false, reason: 'content-not-ready' };
  }
}

// ─── Summarizer handlers ─────────────────────────────────────────────────

async function checkAvailability(): Promise<SummarizerAvailabilityResponse> {
  if (!summarizerSupported()) {
    return { supported: false, availability: 'unavailable' };
  }
  try {
    const settings = await getSummarySettings();
    const availability = await Summarizer!.availability({
      type: settings.format,
      length: settings.length,
      format: 'plain-text',
    });
    return { supported: true, availability };
  } catch {
    return { supported: false, availability: 'unavailable' };
  }
}

/** Broadcast download-progress events so the in-page button can show "Downloading model NN%". */
function broadcastProgress(loaded: number): void {
  // The content script listens via chrome.runtime.onMessage. We send to all
  // listeners; the content script filters by message type.
  chrome.runtime.sendMessage({ type: 'summarize-progress', loaded }).catch(() => {
    /* no listeners is fine */
  });
}

async function runSummarizer(text: string): Promise<SummarizeResponse> {
  if (!summarizerSupported()) {
    return { ok: false, reason: 'unavailable' };
  }
  const settings = await getSummarySettings();
  const createOptions: SummarizerCreateOptions = {
    type: settings.format,
    length: settings.length,
    format: 'plain-text',
    sharedContext: 'This is the transcript of a YouTube video.',
    monitor: (m) => {
      m.addEventListener('downloadprogress', (e) => broadcastProgress(e.loaded));
    },
  };

  let session: SummarizerSession;
  try {
    session = await Summarizer!.create(createOptions);
  } catch (err) {
    return { ok: false, reason: 'download-failed', detail: String(err) };
  }

  try {
    const summary = await session.summarize(text);
    return { ok: true, summary: summary.trim() };
  } catch (err) {
    return { ok: false, reason: 'summarize-failed', detail: String(err) };
  } finally {
    try {
      session.destroy();
    } catch {
      /* ignore */
    }
  }
}

// ─── Router ──────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((message: IncomingMessage, sender, sendResponse) => {
  // Ignore messages we forwarded ourselves (e.g. summarize-progress relays).
  if (!message || typeof message !== 'object') return false;
  if (sender.tab) return false;

  switch (message.type) {
    case 'transcript-status?':
    case 'download-transcript':
      relayToContent(message).then((r) => sendResponse(r));
      return true;

    case 'summarizer-availability?':
      checkAvailability().then((r) => sendResponse(r));
      return true;

    case 'summarize-transcript':
      runSummarizer(message.text).then((r) => sendResponse(r));
      return true;

    default:
      return false;
  }
});
