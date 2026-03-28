// Twitch AdBlocker - Background Service Worker

let totalAdsBlocked = 0;
let totalVodsUnlocked = 0;

const GITHUB_API_URL = 'https://api.github.com/repos/TISARR-git/AdBlockerTwitch/releases/latest';
const UPDATE_CHECK_INTERVAL_MS = 12 * 60 * 60 * 1000; // 12 hours

// --- Update Check Logic ---

function compareVersions(remote, local) {
  const r = remote.replace(/^v/, '').split('.').map(Number);
  const l = local.split('.').map(Number);
  for (let i = 0; i < Math.max(r.length, l.length); i++) {
    const rv = r[i] || 0;
    const lv = l[i] || 0;
    if (rv > lv) return 1;
    if (rv < lv) return -1;
  }
  return 0;
}

async function checkForUpdate() {
  try {
    const { lastUpdateCheck, updateDismissedVersion } = await chrome.storage.local.get(['lastUpdateCheck', 'updateDismissedVersion']);
    const now = Date.now();

    // Throttle: don't check more than once per interval
    if (lastUpdateCheck && (now - lastUpdateCheck) < UPDATE_CHECK_INTERVAL_MS) {
      // Still return cached update info if available
      const { latestVersion, latestDownloadUrl } = await chrome.storage.local.get(['latestVersion', 'latestDownloadUrl']);
      if (latestVersion) {
        const localVersion = chrome.runtime.getManifest().version;
        if (compareVersions(latestVersion, localVersion) > 0) {
          return { hasUpdate: true, version: latestVersion, downloadUrl: latestDownloadUrl };
        }
      }
      return { hasUpdate: false };
    }

    const response = await fetch(GITHUB_API_URL, {
      headers: { 'Accept': 'application/vnd.github.v3+json' }
    });

    if (!response.ok) {
      console.log('[TwitchAdBlocker BG] GitHub API error:', response.status);
      return { hasUpdate: false };
    }

    const release = await response.json();
    const remoteVersion = release.tag_name || '';
    const localVersion = chrome.runtime.getManifest().version;

    // Detect browser type (Firefox uses moz-extension://)
    const isFirefox = chrome.runtime.getURL('').startsWith('moz-extension://');

    // Find the correct asset based on the browser
    let downloadUrl = release.zipball_url;
    if (release.assets && release.assets.length > 0) {
      if (isFirefox) {
        // Priority: Look for Firefox .xpi (as defined in release.yml)
        const fxAsset = release.assets.find(a => a.name.endsWith('.xpi'));
        if (fxAsset) downloadUrl = fxAsset.browser_download_url;
      } else {
        // Priority: Look for Chrome .zip (specifically with 'Chrome' in name)
        const chromeAsset = release.assets.find(a => a.name.includes('Chrome') && a.name.endsWith('.zip'));
        if (chromeAsset) downloadUrl = chromeAsset.browser_download_url;
      }
    }

    await chrome.storage.local.set({
      lastUpdateCheck: now,
      latestVersion: remoteVersion.replace(/^v/, ''),
      latestDownloadUrl: downloadUrl
    });

    if (compareVersions(remoteVersion, localVersion) > 0) {
      console.log('[TwitchAdBlocker BG] Update available:', remoteVersion, '(current:', localVersion + ')');
      return { hasUpdate: true, version: remoteVersion.replace(/^v/, ''), downloadUrl };
    }

    return { hasUpdate: false };
  } catch (e) {
    console.log('[TwitchAdBlocker BG] Update check failed:', e.message);
    return { hasUpdate: false };
  }
}

async function openUpdatePopup() {
  const { updatePopupShownToday } = await chrome.storage.local.get(['updatePopupShownToday']);
  const now = Date.now();

  // Only show once per day
  if (updatePopupShownToday && (now - updatePopupShownToday) < UPDATE_CHECK_INTERVAL_MS) {
    return;
  }

  await chrome.storage.local.set({ updatePopupShownToday: now });

  // Open popup.html in a small centered window
  const popupUrl = chrome.runtime.getURL('popup/popup.html?update=true');
  chrome.windows.create({
    url: popupUrl,
    type: 'popup',
    width: 340,
    height: 560,
    focused: true
  });
}

// --- Extension Init ---

chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled', 'donationIconEnabled', 'lang', 'adsBlocked', 'vodsUnlocked'], (result) => {
    const updates = {};
    if (result.adBlockEnabled === undefined) updates.adBlockEnabled = true;
    if (result.vodUnlockEnabled === undefined) updates.vodUnlockEnabled = true;
    if (result.dvrEnabled === undefined) updates.dvrEnabled = true;
    if (result.donationIconEnabled === undefined) updates.donationIconEnabled = true;
    if (result.lang === undefined) updates.lang = 'fr';

    if (result.adsBlocked === undefined) updates.adsBlocked = 0;
    if (result.vodsUnlocked === undefined) updates.vodsUnlocked = 0;

    if (Object.keys(updates).length > 0) {
      chrome.storage.local.set(updates);
    }

    console.log('[TwitchAdBlocker BG] Installed/Updated - Lifetime stats:', {
      adsBlocked: result.adsBlocked || 0,
      vodsUnlocked: result.vodsUnlocked || 0
    });
  });
});

// --- Message Handler ---

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'getState') {
    chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled', 'donationIconEnabled', 'lang', 'adsBlocked', 'vodsUnlocked'], (result) => {
      sendResponse({
        adBlockEnabled: result.adBlockEnabled !== false,
        vodUnlockEnabled: result.vodUnlockEnabled !== false,
        dvrEnabled: result.dvrEnabled !== false,
        donationIconEnabled: result.donationIconEnabled !== false,
        lang: result.lang || 'fr',
        adsBlocked: result.adsBlocked || 0,
        vodsUnlocked: result.vodsUnlocked || 0
      });
    });
    return true;
  }

  if (message.type === 'setState') {
    const updates = {};
    if (message.adBlockEnabled !== undefined) updates.adBlockEnabled = message.adBlockEnabled;
    if (message.vodUnlockEnabled !== undefined) updates.vodUnlockEnabled = message.vodUnlockEnabled;
    if (message.dvrEnabled !== undefined) updates.dvrEnabled = message.dvrEnabled;
    if (message.donationIconEnabled !== undefined) updates.donationIconEnabled = message.donationIconEnabled;
    if (message.lang !== undefined) updates.lang = message.lang;

    chrome.storage.local.set(updates, () => {
      sendResponse({ success: true });
    });
    return true;
  }

  if (message.type === 'checkUpdate') {
    checkForUpdate().then(result => {
      if (result.hasUpdate) {
        openUpdatePopup();
      }
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'getUpdateInfo') {
    checkForUpdate().then(result => {
      sendResponse(result);
    });
    return true;
  }

  if (message.type === 'downloadUpdate') {
    if (message.url) {
      chrome.downloads.download({ url: message.url }, (downloadId) => {
        if (chrome.runtime.lastError) {
          console.log('[TwitchAdBlocker BG] Download error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          console.log('[TwitchAdBlocker BG] Download started, ID:', downloadId);
          sendResponse({ success: true, downloadId });
        }
      });
    } else {
      sendResponse({ success: false, error: 'No URL provided' });
    }
    return true;
  }

  if (message.type === 'adBlocked') {
    totalAdsBlocked++;
    chrome.storage.local.get(['adsBlocked'], (result) => {
      const newCount = (result.adsBlocked || 0) + 1;
      chrome.storage.local.set({ adsBlocked: newCount }, () => {
        console.log('[TwitchAdBlocker BG] Total ads blocked:', newCount);
        sendResponse({ adsBlocked: newCount });
      });
    });
    return true;
  }

  if (message.type === 'vodUnlocked') {
    totalVodsUnlocked++;
    chrome.storage.local.get(['vodsUnlocked'], (result) => {
      const newCount = (result.vodsUnlocked || 0) + 1;
      chrome.storage.local.set({ vodsUnlocked: newCount }, () => {
        console.log('[TwitchAdBlocker BG] Total VODs unlocked:', newCount);
        sendResponse({ vodsUnlocked: newCount });
      });
    });
    return true;
  }

  return false;
});
