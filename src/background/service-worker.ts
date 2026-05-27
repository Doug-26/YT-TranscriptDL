/**
 * Background service worker — relays messages from the Angular popup
 * to the active tab's content script. The popup cannot call
 * chrome.tabs.sendMessage directly without going through here.
 */

type PopupMessage =
  | { type: 'transcript-status?' }
  | { type: 'download-transcript' };

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

async function relayToContent(message: PopupMessage): Promise<unknown> {
  const tab = await getActiveYouTubeTab();
  if (!tab?.id) {
    return { ok: false, reason: 'no-youtube-tab' };
  }
  try {
    return await chrome.tabs.sendMessage(tab.id, message);
  } catch {
    return { ok: false, reason: 'content-not-ready' };
  }
}

chrome.runtime.onMessage.addListener((message: PopupMessage, sender, sendResponse) => {
  if (sender.tab) return false;
  if (!message || typeof message !== 'object') return false;
  if (message.type !== 'transcript-status?' && message.type !== 'download-transcript') {
    return false;
  }

  relayToContent(message).then((response) => sendResponse(response));
  return true;
});
