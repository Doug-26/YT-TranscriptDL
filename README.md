# YouTube Transcript Downloader

A Chrome extension that adds a clean **Download** button to YouTube's transcript panel. Click it and the transcript is saved as a `.txt` file named after the video — **no timestamps**, just the text.

## Stack

- **Angular 21** (standalone components, zoneless, signals) for the popup
- **TypeScript** content script bundled with **esbuild**
- **Manifest V3** Chrome extension

## Build

```powershell
npm install
npm run build
```

Output lands in `dist/extension/`. Load it in Chrome:

1. Visit `chrome://extensions`
2. Toggle **Developer mode** on
3. Click **Load unpacked** → select `dist/extension`

## Use

1. Open any YouTube video that has a transcript.
2. Click `...` → **Show transcript** under the video.
3. A red-accented **Download** button appears in the transcript panel header.
4. Click it. A `.txt` file named after the video downloads to your default folder.

The toolbar popup mirrors this — it shows detection status and a fallback Download button.

## Project layout

```
manifest.json              MV3 manifest
src/
  popup/                   Angular 21 popup app
  content/content.ts       Injects button, scrapes segments, triggers download
  content/content.css      Button styles (scoped via .ytx-download-btn)
  background/              Service worker — message relay popup ↔ content
public/icons/              Generated placeholder icons (replace with real art)
esbuild.config.mjs         Bundles content + background scripts
scripts/                   Clean / copy / icon generator
dist/extension/            Build output — load this in Chrome
```

## Why Angular only in the popup?

A content script runs on every YouTube page load and shares the DOM with YouTube's own code. Angular's runtime is too heavy to ship there. The popup is a separate page Chrome loads from `popup/index.html`, so Angular fits naturally without affecting YouTube performance.
