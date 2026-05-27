import { ChangeDetectionStrategy, Component, OnInit, signal } from '@angular/core';

type DownloadResult =
  | { ok: true; filename: string; segmentCount: number }
  | { ok: false; reason: 'no-panel' | 'no-segments' | 'no-youtube-tab' | 'content-not-ready' };

type StatusResponse =
  | { detected: boolean; videoTitle: string | null }
  | { ok: false; reason: 'no-youtube-tab' | 'content-not-ready' };

type ViewState = 'loading' | 'no-youtube' | 'open-transcript' | 'ready';

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

  ngOnInit(): void {
    void this.refreshStatus();
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

  protected async download(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.toast.set(null);
    try {
      const result = (await chrome.runtime.sendMessage({
        type: 'download-transcript',
      })) as DownloadResult | undefined;

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

  private errorMessage(reason: string): string {
    switch (reason) {
      case 'no-panel':
        return 'Open the transcript panel on YouTube first.';
      case 'no-segments':
        return 'This video has no transcript available.';
      case 'no-youtube-tab':
        return 'Open a YouTube video tab first.';
      default:
        return 'Reload the YouTube tab and try again.';
    }
  }
}
