// Twitch AdBlocker - Background Service Worker

let totalAdsBlocked = 0;
let totalVodsUnlocked = 0;

// Initialize extension state on install - preserve existing counters
chrome.runtime.onInstalled.addListener((details) => {
  chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled', 'adsBlocked', 'vodsUnlocked'], (result) => {
    // Only set defaults if values don't exist - preserve lifetime stats
    const updates = {};
    if (result.adBlockEnabled === undefined) updates.adBlockEnabled = true;
    if (result.vodUnlockEnabled === undefined) updates.vodUnlockEnabled = true;
    if (result.dvrEnabled === undefined) updates.dvrEnabled = true;

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

// Handle messages from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  if (message.type === 'getState') {
    chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled', 'adsBlocked', 'vodsUnlocked'], (result) => {
      sendResponse({
        adBlockEnabled: result.adBlockEnabled !== false,
        vodUnlockEnabled: result.vodUnlockEnabled !== false,
        dvrEnabled: result.dvrEnabled !== false,
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

    chrome.storage.local.set(updates, () => {
      sendResponse({ success: true });
    });
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
