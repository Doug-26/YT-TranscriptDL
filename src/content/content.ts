/**
 * YouTube Transcript Downloader — content script.
 *
 * Watches for YouTube's transcript engagement panel, injects a Download
 * button into its header, and downloads the segment text as a clean .txt
 * file (no timestamps) when clicked. Also responds to messages from the
 * popup so the toolbar can trigger the same download.
 */

const BUTTON_CLASS = 'ytx-download-btn';
const BUTTON_ID = 'ytx-download-btn-instance';

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
<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d="M12 3v12"></path>
  <path d="m7 10 5 5 5-5"></path>
  <path d="M5 21h14"></path>
</svg>`.trim();

interface TranscriptStatus {
  detected: boolean;
  videoTitle: string | null;
}

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

type DownloadResult =
  | { ok: true; filename: string; segmentCount: number }
  | { ok: false; reason: 'no-panel' | 'no-segments' };

function performDownload(): DownloadResult {
  const panel = getTranscriptPanel();
  if (!panel || !isTranscriptPanelVisible(panel)) {
    return { ok: false, reason: 'no-panel' };
  }
  const text = extractTranscriptText(panel);
  if (!text) {
    return { ok: false, reason: 'no-segments' };
  }
  const title = sanitizeFilename(getVideoTitle());
  const filename = `${title}.txt`;
  downloadBlob(filename, text);
  return { ok: true, filename, segmentCount: text.split('\n').length };
}

function flashButton(button: HTMLButtonElement, message: string, ok: boolean): void {
  const originalHTML = button.innerHTML;
  button.innerHTML = `<span class="ytx-download-btn__label">${message}</span>`;
  button.classList.toggle('ytx-download-btn--error', !ok);
  button.classList.toggle('ytx-download-btn--success', ok);
  button.disabled = true;
  setTimeout(() => {
    button.innerHTML = originalHTML;
    button.classList.remove('ytx-download-btn--success', 'ytx-download-btn--error');
    button.disabled = false;
  }, 1600);
}

function buildButton(): HTMLButtonElement {
  const button = document.createElement('button');
  button.id = BUTTON_ID;
  button.className = BUTTON_CLASS;
  button.type = 'button';
  button.setAttribute('aria-label', 'Download transcript as .txt');
  button.title = 'Download transcript (.txt, no timestamps)';
  button.innerHTML = `${DOWNLOAD_ICON_SVG}<span class="ytx-download-btn__label">Download</span>`;

  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    const result = performDownload();
    if (result.ok) {
      flashButton(button, 'Downloaded', true);
    } else if (result.reason === 'no-segments') {
      flashButton(button, 'No transcript', false);
    } else {
      flashButton(button, 'Open transcript', false);
    }
  });

  return button;
}

interface InsertionPoint {
  container: HTMLElement;
  before: HTMLElement | null;
}

function findHeaderInsertionPoint(panel: HTMLElement): InsertionPoint | null {
  const headerRenderer =
    panel.querySelector<HTMLElement>('ytd-engagement-panel-title-header-renderer');
  const header =
    headerRenderer?.querySelector<HTMLElement>('#header') ??
    panel.querySelector<HTMLElement>('ytd-engagement-panel-title-header-renderer #header') ??
    headerRenderer;
  if (!header) return null;

  const closeButton =
    header.querySelector<HTMLElement>('#visibility-button') ??
    header.querySelector<HTMLElement>('yt-button-shape:last-of-type') ??
    null;
  return { container: header, before: closeButton };
}

function ensureButtonInjected(): void {
  const panel = getTranscriptPanel();
  if (!panel || !isTranscriptPanelVisible(panel)) {
    document.getElementById(BUTTON_ID)?.remove();
    return;
  }

  if (document.getElementById(BUTTON_ID)) return;

  const point = findHeaderInsertionPoint(panel);
  if (!point) return;

  const button = buildButton();
  if (point.before && point.before.parentElement === point.container) {
    point.container.insertBefore(button, point.before);
  } else {
    point.container.appendChild(button);
  }
}

let observerScheduled = false;
function scheduleEnsure(): void {
  if (observerScheduled) return;
  observerScheduled = true;
  requestAnimationFrame(() => {
    observerScheduled = false;
    ensureButtonInjected();
  });
}

const bodyObserver = new MutationObserver(() => scheduleEnsure());
bodyObserver.observe(document.body, { childList: true, subtree: true });

document.addEventListener('yt-navigate-finish', () => {
  setTimeout(scheduleEnsure, 250);
});

scheduleEnsure();

function isWatchPage(): boolean {
  return location.pathname === '/watch';
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
    const result = performDownload();
    sendResponse(result);
    return false;
  }
  return false;
});
