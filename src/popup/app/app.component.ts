import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';
import {
  DEFAULT_SETTINGS,
  FORMAT_LABELS,
  LENGTH_LABELS,
  SummaryFormat,
  SummaryLength,
  getSummarySettings,
  setSummarySettings,
} from '../../shared/settings.js';

type TranscriptDownloadResult =
  | { ok: true; filename: string; segmentCount: number }
  | { ok: false; reason: 'no-panel' | 'no-segments' | 'no-youtube-tab' | 'content-not-ready' };

type SummaryDownloadResult =
  | { ok: true; filename: string }
  | {
      ok: false;
      reason:
        | 'no-panel'
        | 'no-segments'
        | 'unavailable'
        | 'download-failed'
        | 'summarize-failed'
        | 'no-youtube-tab'
        | 'content-not-ready';
    };

type StatusResponse =
  | { detected: boolean; videoTitle: string | null }
  | { ok: false; reason: 'no-youtube-tab' | 'content-not-ready' };

type AvailabilityResponse = {
  supported: boolean;
  availability: 'unavailable' | 'downloadable' | 'downloading' | 'available';
};

type ViewState = 'loading' | 'no-youtube' | 'open-transcript' | 'ready';
type AvailabilityState = 'unknown' | 'available' | 'downloadable' | 'downloading' | 'unavailable';

@Component({
  selector: 'ytx-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './app.component.html',
  styleUrl: './app.component.css',
})
export class AppComponent implements OnInit {
  protected readonly state = signal<ViewState>('loading');
  protected readonly videoTitle = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly toast = signal<{ kind: 'ok' | 'err'; message: string } | null>(null);

  protected readonly format = signal<SummaryFormat>(DEFAULT_SETTINGS.format);
  protected readonly length = signal<SummaryLength>(DEFAULT_SETTINGS.length);
  protected readonly availability = signal<AvailabilityState>('unknown');

  protected readonly formats: SummaryFormat[] = ['key-points', 'tldr'];
  protected readonly lengths: SummaryLength[] = ['short', 'medium', 'long'];
  protected readonly formatLabel = (f: SummaryFormat) => FORMAT_LABELS[f];
  protected readonly lengthLabel = (l: SummaryLength) => LENGTH_LABELS[l];

  async ngOnInit(): Promise<void> {
    const [settings] = await Promise.all([getSummarySettings(), this.refreshStatus()]);
    this.format.set(settings.format);
    this.length.set(settings.length);
    void this.refreshAvailability();
  }

  protected async refreshStatus(): Promise<void> {
    this.state.set('loading');
    const response = (await chrome.runtime.sendMessage({
      type: 'transcript-status?',
    })) as StatusResponse | undefined;

    if (!response || ('ok' in response && response.ok === false)) {
      this.state.set('no-youtube');
      this.videoTitle.set(null);
      return;
    }

    if ('detected' in response) {
      this.videoTitle.set(response.videoTitle);
      if (!response.videoTitle) {
        this.state.set('no-youtube');
      } else if (response.detected) {
        this.state.set('ready');
      } else {
        this.state.set('open-transcript');
      }
    }
  }

  protected async refreshAvailability(): Promise<void> {
    try {
      const r = (await chrome.runtime.sendMessage({
        type: 'summarizer-availability?',
      })) as AvailabilityResponse | undefined;
      if (!r || !r.supported) {
        this.availability.set('unavailable');
        return;
      }
      this.availability.set(r.availability);
    } catch {
      this.availability.set('unavailable');
    }
  }

  protected async setFormat(f: SummaryFormat): Promise<void> {
    this.format.set(f);
    await setSummarySettings({ format: f });
    void this.refreshAvailability();
  }

  protected async setLength(l: SummaryLength): Promise<void> {
    this.length.set(l);
    await setSummarySettings({ length: l });
    void this.refreshAvailability();
  }

  protected async download(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.toast.set(null);
    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'download-transcript',
      })) as TranscriptDownloadResult | undefined;

      if (result?.ok) {
        this.toast.set({ kind: 'ok', message: `Downloaded ${result.filename}` });
      } else {
        this.toast.set({
          kind: 'err',
          message: this.errorMessage(result?.reason ?? 'content-not-ready'),
        });
      }
    } catch {
      this.toast.set({ kind: 'err', message: 'Could not reach the YouTube tab.' });
    } finally {
      this.busy.set(false);
      setTimeout(() => this.toast.set(null), 2400);
    }
  }

  protected async downloadSummary(): Promise<void> {
    if (this.busy()) return;
    if (this.availability() === 'unavailable') {
      this.toast.set({
        kind: 'err',
        message: 'Built-in Summarizer is not available in this Chrome.',
      });
      setTimeout(() => this.toast.set(null), 2800);
      return;
    }
    this.busy.set(true);
    this.toast.set(null);
    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'download-summary',
      })) as SummaryDownloadResult | undefined;
      if (result?.ok) {
        this.toast.set({ kind: 'ok', message: `Downloaded ${result.filename}` });
      } else {
        this.toast.set({
          kind: 'err',
          message: this.errorMessage(result?.reason ?? 'summarize-failed'),
        });
      }
    } catch {
      this.toast.set({ kind: 'err', message: 'Could not reach the YouTube tab.' });
    } finally {
      this.busy.set(false);
      setTimeout(() => this.toast.set(null), 2800);
    }
  }

  protected availabilityClass(): string {
    switch (this.availability()) {
      case 'available':
        return 'popup__avail popup__avail--ok';
      case 'downloadable':
      case 'downloading':
        return 'popup__avail popup__avail--warn';
      case 'unavailable':
        return 'popup__avail popup__avail--err';
      default:
        return 'popup__avail popup__avail--idle';
    }
  }

  protected availabilityText(): string {
    switch (this.availability()) {
      case 'available':
        return 'Summarizer ready';
      case 'downloadable':
        return 'Model will download on first use';
      case 'downloading':
        return 'Model is downloading…';
      case 'unavailable':
        return 'Built-in Summarizer unavailable in this Chrome';
      default:
        return 'Checking Summarizer…';
    }
  }

  private errorMessage(reason: string): string {
    switch (reason) {
      case 'no-panel':
        return 'Open the transcript panel on YouTube first.';
      case 'no-segments':
        return 'This video has no transcript available.';
      case 'unavailable':
        return 'Built-in Summarizer is not available in this Chrome.';
      case 'download-failed':
        return 'Model download failed. Try again later.';
      case 'summarize-failed':
        return 'Summary failed. The transcript may be too long.';
      case 'no-youtube-tab':
        return 'Open a YouTube video tab first.';
      default:
        return 'Reload the YouTube tab and try again.';
    }
  }

  // Helper for template — keep settings inputs disabled if not ready.
  protected disabledSettings(): boolean {
    return this.busy();
  }
}
