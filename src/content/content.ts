/**
 * YouTube Transcript Downloader — content script.
 *
 * Watches for YouTube's transcript engagement panel, injects a compact
 * split-button into its header, and exposes three actions via a dropdown
 * menu:
 *
 *   • Download transcript  — clean .txt (no timestamps)
 *   • Download summary     — on-device Summarizer API, .txt
 *   • Download both        — both files
 *
 * Also responds to messages from the popup so the toolbar UI can trigger
 * the same actions and listens for summarize-progress notifications so the
 * button can reflect model-download progress.
 */

import { getSummarySettings } from '../shared/settings.js';

// ─── Selectors & constants ───────────────────────────────────────────────

const GROUP_ID = 'ytx-dl-group-instance';
const GROUP_CLASS = 'ytx-dl-group';

const TRANSCRIPT_PANEL_SELECTOR =
  'ytd-engagement-panel-section-list-renderer[target-id="engagement-panel-searchable-transcript"]';
const SEGMENT_SELECTOR = 'ytd-transcript-segment-renderer';
const SEGMENT_TEXT_SELECTOR = '.segment-text, yt-formatted-string.segment-text';

const TITLE_SELECTORS = [
  'h1.ytd-watch-metadata yt-formatted-string',
  'h1.title yt-formatted-string',
  '#title h1 yt-formatted-string',
];

const ILLEGAL_FILENAME_CHARS = /[\\/:*?"<>|\x00-\x1F]+/g;

const DOWNLOAD_ICON_SVG = `
<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3v12"></path>
  <path d="m7 10 5 5 5-5"></path>
  <path d="M5 21h14"></path>
</svg>`.trim();

const CHEVRON_ICON_SVG = `
<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="m6 9 6 6 6-6"></path>
</svg>`.trim();

// ─── DOM helpers ─────────────────────────────────────────────────────────

function getTranscriptPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(TRANSCRIPT_PANEL_SELECTOR);
}

function isTranscriptPanelVisible(panel: HTMLElement | null): boolean {
  if (!panel) return false;
  const visibility = panel.getAttribute('visibility');
  if (visibility && visibility.includes('HIDDEN')) return false;
  if (panel.hasAttribute('hidden')) return false;
  return panel.offsetParent !== null || panel.getClientRects().length > 0;
}

function getVideoTitle(): string {
  for (const selector of TITLE_SELECTORS) {
    const el = document.querySelector<HTMLElement>(selector);
    const text = el?.textContent?.trim();
    if (text) return text;
  }
  return document.title.replace(/\s*-\s*YouTube$/, '').trim() || 'youtube-transcript';
}

function sanitizeFilename(name: string): string {
  const cleaned = name.replace(ILLEGAL_FILENAME_CHARS, ' ').replace(/\s+/g, ' ').trim();
  return cleaned.length > 0 ? cleaned.slice(0, 150) : 'youtube-transcript';
}

function extractTranscriptText(panel: HTMLElement): string {
  const segments = panel.querySelectorAll<HTMLElement>(SEGMENT_SELECTOR);
  if (segments.length === 0) return '';
  const lines: string[] = [];
  segments.forEach((segment) => {
    const textEl = segment.querySelector<HTMLElement>(SEGMENT_TEXT_SELECTOR);
    const raw = (textEl?.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (raw.length > 0) lines.push(raw);
  });
  return lines.join('\n');
}

function downloadBlob(filename: string, body: string): void {
  const blob = new Blob([body], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ─── Download flows ──────────────────────────────────────────────────────

type TranscriptResult =
  | { ok: true; filename: string; text: string }
  | { ok: false; reason: 'no-panel' | 'no-segments' };

function gatherTranscript(): TranscriptResult {
  const panel = getTranscriptPanel();
  if (!panel || !isTranscriptPanelVisible(panel)) {
    return { ok: false, reason: 'no-panel' };
  }
  const text = extractTranscriptText(panel);
  if (!text) return { ok: false, reason: 'no-segments' };
  const title = sanitizeFilename(getVideoTitle());
  return { ok: true, filename: `${title}.txt`, text };
}

function performTranscriptDownload(): TranscriptResult {
  const r = gatherTranscript();
  if (r.ok) downloadBlob(r.filename, r.text);
  return r;
}

type SummarizeBackgroundResponse =
  | { ok: true; summary: string }
  | { ok: false; reason: 'unavailable' | 'download-failed' | 'summarize-failed'; detail?: string };

type SummaryResult =
  | { ok: true; filename: string }
  | {
      ok: false;
      reason: 'no-panel' | 'no-segments' | 'unavailable' | 'download-failed' | 'summarize-failed';
    };

async function performSummaryDownload(
  onProgress?: (percent: number) => void,
): Promise<SummaryResult> {
  const t = gatherTranscript();
  if (!t.ok) return t;

  // Snapshot the title NOW so a mid-flight video change doesn't mislabel the file.
  const titleBase = sanitizeFilename(getVideoTitle());

  const progressHandler = (message: unknown) => {
    if (
      message &&
      typeof message === 'object' &&
      (message as { type?: string }).type === 'summarize-progress'
    ) {
      const loaded = (message as { loaded?: number }).loaded ?? 0;
      onProgress?.(Math.round(loaded * 100));
    }
  };
  chrome.runtime.onMessage.addListener(progressHandler);

  let response: SummarizeBackgroundResponse | undefined;
  try {
    response = (await chrome.runtime.sendMessage({
      type: 'summarize-transcript',
      text: t.text,
    })) as SummarizeBackgroundResponse | undefined;
  } catch {
    response = { ok: false, reason: 'summarize-failed', detail: 'send-failed' };
  } finally {
    chrome.runtime.onMessage.removeListener(progressHandler);
  }

  if (!response || !response.ok) {
    return { ok: false, reason: response?.reason ?? 'summarize-failed' };
  }

  const filename = `${titleBase} - summary.txt`;
  downloadBlob(filename, response.summary);
  return { ok: true, filename };
}

// ─── Button + menu UI ────────────────────────────────────────────────────

interface SplitButton {
  group: HTMLSpanElement;
  main: HTMLButtonElement;
  chevron: HTMLButtonElement;
  menu: HTMLDivElement;
  setLabel(label: string): void;
  resetLabel(): void;
  flash(message: string, ok: boolean, ms?: number): void;
  setBusy(busy: boolean): void;
}

function buildSplitButton(): SplitButton {
  const group = document.createElement('span');
  group.id = GROUP_ID;
  group.className = GROUP_CLASS;

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'ytx-dl-main';
  main.setAttribute('aria-label', 'Download transcript as .txt');
  main.title = 'Download transcript (.txt, no timestamps)';
  main.innerHTML = `${DOWNLOAD_ICON_SVG}<span class="ytx-dl-label">Download</span>`;

  const chevron = document.createElement('button');
  chevron.type = 'button';
  chevron.className = 'ytx-dl-chevron';
  chevron.setAttribute('aria-label', 'More download options');
  chevron.setAttribute('aria-haspopup', 'menu');
  chevron.setAttribute('aria-expanded', 'false');
  chevron.title = 'More download options';
  chevron.innerHTML = CHEVRON_ICON_SVG;

  const menu = document.createElement('div');
  menu.className = 'ytx-dl-menu';
  menu.setAttribute('role', 'menu');
  menu.hidden = true;

  group.append(main, chevron, menu);

  const defaultLabel = `${DOWNLOAD_ICON_SVG}<span class="ytx-dl-label">Download</span>`;

  return {
    group,
    main,
    chevron,
    menu,
    setLabel(label: string) {
      main.innerHTML = `<span class="ytx-dl-label">${label}</span>`;
    },
    resetLabel() {
      main.innerHTML = defaultLabel;
    },
    flash(message: string, ok: boolean, ms = 1600) {
      const original = main.innerHTML;
      main.innerHTML = `<span class="ytx-dl-label">${message}</span>`;
      group.classList.toggle('ytx-dl-group--error', !ok);
      group.classList.toggle('ytx-dl-group--success', ok);
      main.disabled = true;
      chevron.disabled = true;
      setTimeout(() => {
        main.innerHTML = original;
        group.classList.remove('ytx-dl-group--success', 'ytx-dl-group--error');
        main.disabled = false;
        chevron.disabled = false;
      }, ms);
    },
    setBusy(busy: boolean) {
      main.disabled = busy;
      chevron.disabled = busy;
      group.classList.toggle('ytx-dl-group--busy', busy);
    },
  };
}

function buildMenuItem(label: string, sub: string, onClick: () => void): HTMLButtonElement {
  const item = document.createElement('button');
  item.type = 'button';
  item.className = 'ytx-dl-menu__item';
  item.setAttribute('role', 'menuitem');
  item.innerHTML = `
    <span class="ytx-dl-menu__label">${label}</span>
    <span class="ytx-dl-menu__sub">${sub}</span>
  `;
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClick();
  });
  return item;
}

// ─── Action handlers wired to the split button ───────────────────────────

function reasonMessage(reason: string): string {
  switch (reason) {
    case 'no-panel':
      return 'Open transcript';
    case 'no-segments':
      return 'No transcript';
    case 'unavailable':
      return 'Summarizer N/A';
    case 'download-failed':
      return 'Model failed';
    case 'summarize-failed':
      return 'Summary failed';
    default:
      return 'Error';
  }
}

function attachActions(btn: SplitButton): void {
  // Open/close menu
  const closeMenu = () => {
    btn.menu.hidden = true;
    btn.chevron.setAttribute('aria-expanded', 'false');
  };
  const openMenu = () => {
    btn.menu.hidden = false;
    btn.chevron.setAttribute('aria-expanded', 'true');
  };

  btn.chevron.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    btn.menu.hidden ? openMenu() : closeMenu();
  });

  // Close on outside click / Escape
  document.addEventListener('click', (e) => {
    if (btn.menu.hidden) return;
    if (!btn.group.contains(e.target as Node)) closeMenu();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !btn.menu.hidden) closeMenu();
  });

  // Main face → transcript download
  btn.main.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const r = performTranscriptDownload();
    btn.flash(r.ok ? 'Downloaded' : reasonMessage(r.reason), r.ok);
  });

  // Menu items
  const onSummary = async () => {
    closeMenu();
    btn.setBusy(true);
    btn.setLabel('Summarizing…');
    const r = await performSummaryDownload((pct) => {
      btn.setLabel(`Downloading model ${pct}%`);
    });
    btn.setBusy(false);
    btn.resetLabel();
    btn.flash(r.ok ? 'Summary saved' : reasonMessage(r.reason), r.ok, r.ok ? 1600 : 2400);
  };

  const onTranscript = () => {
    closeMenu();
    const r = performTranscriptDownload();
    btn.flash(r.ok ? 'Downloaded' : reasonMessage(r.reason), r.ok);
  };

  const onBoth = async () => {
    closeMenu();
    // Fire transcript first (instant), then run the summary path.
    const tr = performTranscriptDownload();
    if (!tr.ok) {
      btn.flash(reasonMessage(tr.reason), false);
      return;
    }
    btn.setBusy(true);
    btn.setLabel('Summarizing…');
    const sr = await performSummaryDownload((pct) => {
      btn.setLabel(`Downloading model ${pct}%`);
    });
    btn.setBusy(false);
    btn.resetLabel();
    btn.flash(sr.ok ? 'Both saved' : reasonMessage(sr.reason), sr.ok, sr.ok ? 1600 : 2400);
  };

  btn.menu.append(
    buildMenuItem('Download transcript', '.txt · full text', onTranscript),
    buildMenuItem('Download summary', '.txt · AI summary', onSummary),
    buildMenuItem('Download both', 'transcript + summary', onBoth),
  );
}

// ─── Injection ───────────────────────────────────────────────────────────

interface InsertionPoint {
  container: HTMLElement;
  before: HTMLElement | null;
}

/**
 * The transcript panel header is roughly:
 *   #header
 *     #title-container  (title text, flex: 1)
 *     #menu-container   (3-dot kebab)
 *     #visibility-button (X close)
 *
 * We insert immediately BEFORE the kebab so the visual order becomes:
 *   [Transcript title] … [Download ▾] [kebab] [×]
 *
 * That keeps the button on the same flex row, doesn't push the kebab to wrap
 * to a new line, and stays away from the auto-margin space the close button
 * relies on.
 */
function findHeaderInsertionPoint(panel: HTMLElement): InsertionPoint | null {
  const headerRenderer = panel.querySelector<HTMLElement>(
    'ytd-engagement-panel-title-header-renderer',
  );
  const header =
    headerRenderer?.querySelector<HTMLElement>('#header') ??
    panel.querySelector<HTMLElement>('ytd-engagement-panel-title-header-renderer #header') ??
    headerRenderer;
  if (!header) return null;

  const beforeCandidate =
    header.querySelector<HTMLElement>('#menu-container') ??
    header.querySelector<HTMLElement>('ytd-menu-renderer') ??
    header.querySelector<HTMLElement>('#visibility-button') ??
    header.querySelector<HTMLElement>('yt-button-shape:last-of-type');

  // Make sure the candidate is actually a direct child of the header so
  // insertBefore is well-defined.
  let before: HTMLElement | null = beforeCandidate;
  while (before && before.parentElement !== header) {
    before = before.parentElement;
  }
  return { container: header, before };
}

function ensureButtonInjected(): void {
  const panel = getTranscriptPanel();
  if (!panel || !isTranscriptPanelVisible(panel)) {
    document.getElementById(GROUP_ID)?.remove();
    return;
  }
  if (document.getElementById(GROUP_ID)) return;

  const point = findHeaderInsertionPoint(panel);
  if (!point) return;

  const btn = buildSplitButton();
  attachActions(btn);

  if (point.before && point.before.parentElement === point.container) {
    point.container.insertBefore(btn.group, point.before);
  } else {
    point.container.appendChild(btn.group);
  }
}

let scheduled = false;
function scheduleEnsure(): void {
  if (scheduled) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    ensureButtonInjected();
  });
}

const bodyObserver = new MutationObserver(() => scheduleEnsure());
bodyObserver.observe(document.body, { childList: true, subtree: true });

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(scheduleEnsure, 250);
});

scheduleEnsure();

// ─── Popup ↔ content message router ──────────────────────────────────────

function isWatchPage(): boolean {
  return location.pathname === '/watch';
}

interface TranscriptStatus {
  detected: boolean;
  videoTitle: string | null;
}
function buildStatus(): TranscriptStatus {
  const panel = getTranscriptPanel();
  const detected = isWatchPage() && isTranscriptPanelVisible(panel);
  return {
    detected,
    videoTitle: isWatchPage() ? getVideoTitle() : null,
  };
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message || typeof message !== 'object') return false;

  if (message.type === 'transcript-status?') {
    sendResponse(buildStatus());
    return false;
  }
  if (message.type === 'download-transcript') {
    const r = performTranscriptDownload();
    if (r.ok) {
      sendResponse({ ok: true, filename: r.filename, segmentCount: r.text.split('\n').length });
    } else {
      sendResponse({ ok: false, reason: r.reason });
    }
    return false;
  }
  if (message.type === 'download-summary') {
    // Surface a small in-page hint via getSummarySettings so the user sees the
    // current settings being applied (used for logs / future overlay).
    void getSummarySettings();
    performSummaryDownload().then((r) => {
      if (r.ok) sendResponse({ ok: true, filename: r.filename });
      else sendResponse({ ok: false, reason: r.reason });
    });
    return true; // async response
  }

  return false;
});
