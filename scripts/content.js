// Twitch AdBlocker - Content Script
// Injects vaft.js for ad blocking + inject.js for VOD unlock
// CRITICAL: Must inject BEFORE Twitch creates its workers

(function () {
    'use strict';

    // Check if we're on a Twitch page
    if (!window.location.hostname.includes('twitch.tv')) {
        return;
    }

    // Prevent double injection
    if (window.twitchAdBlockContentInjected) {
        return;
    }
    window.twitchAdBlockContentInjected = true;

    console.log('[TwitchAdBlocker Content] Starting...');

    // Counters
    let localAdsBlocked = 0;
    let localVodsUnlocked = 0;
    let extensionValid = true;

    // Check if extension context is valid
    function isExtensionValid() {
        try {
            return chrome.runtime && chrome.runtime.id;
        } catch (e) {
            return false;
        }
    }

    // SYNCHRONOUS injection - must happen before Twitch loads
    function injectScriptSync(scriptName, id) {
        if (document.getElementById(id)) {
            return;
        }

        if (!isExtensionValid()) {
            return;
        }

        try {
            // Create script element
            const script = document.createElement('script');
            script.id = id;
            script.src = chrome.runtime.getURL(scriptName);

            // Insert at the very beginning of the document
            const target = document.head || document.documentElement;
            if (target.firstChild) {
                target.insertBefore(script, target.firstChild);
            } else {
                target.appendChild(script);
            }

            console.log('[TwitchAdBlocker Content]', scriptName, 'injected');
        } catch (e) {
            console.log('[TwitchAdBlocker Content] Injection error:', e.message);
        }
    }

    // Safe message sending
    function sendMessage(message, callback) {
        if (!extensionValid || !isExtensionValid()) {
            extensionValid = false;
            if (callback) callback({ success: false, error: 'Extension not valid' });
            return;
        }

        try {
            chrome.runtime.sendMessage(message, (response) => {
                if (chrome.runtime.lastError) {
                    extensionValid = false;
                    if (callback) callback({ success: false, error: chrome.runtime.lastError.message });
                } else if (callback) {
                    callback(response);
                }
            });
        } catch (e) {
            extensionValid = false;
            if (callback) callback({ success: false, error: e.message });
        }
    }

    // Listen for messages from the injected scripts
    window.addEventListener('message', (event) => {
        if (event.source !== window) return;
        if (!event.data) return;

        // Ad blocked notification
        if (event.data.type === 'TWITCH_ADBLOCK_AD_BLOCKED') {
            localAdsBlocked++;
            console.log('[TwitchAdBlocker Content] Ad blocked! Total:', localAdsBlocked);
            sendMessage({ type: 'adBlocked', count: localAdsBlocked });
        }

        // VOD unlocked notification
        if (event.data.type === 'TWITCH_ADBLOCK_VOD_UNLOCKED') {
            localVodsUnlocked++;
            console.log('[TwitchAdBlocker Content] VOD unlocked! Total:', localVodsUnlocked);
            sendMessage({ type: 'vodUnlocked', count: localVodsUnlocked });
        }
    });

    // Broadcast settings to injected scripts
    function broadcastSettings(settings) {
        window.postMessage({
            type: 'TWITCH_ADBLOCK_SETTINGS',
            settings: {
                adBlockEnabled: settings.adBlockEnabled !== false,
                vodUnlockEnabled: settings.vodUnlockEnabled !== false,
                dvrEnabled: settings.dvrEnabled !== false
            }
        }, '*');
    }

    // Load initial settings and inject
    if (isExtensionValid()) {
        chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled'], (result) => {
            // First broadcast to catch any instantly executing scripts
            broadcastSettings(result);

            // Listen for changes from the popup
            chrome.storage.onChanged.addListener((changes, namespace) => {
                if (namespace === 'local') {
                    const currentSettings = {};
                    let updated = false;
                    for (let [key, { newValue }] of Object.entries(changes)) {
                        if (['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled'].includes(key)) {
                            currentSettings[key] = newValue;
                            updated = true;
                        }
                    }
                    if (updated) {
                        // Blend with existing unchanged settings
                        chrome.storage.local.get(['adBlockEnabled', 'vodUnlockEnabled', 'dvrEnabled'], (latest) => {
                            broadcastSettings(latest);
                        });
                    }
                }
            });

            // Re-broadcast after a short delay to ensure scripts are fully attached
            setTimeout(() => broadcastSettings(result), 500);
            setTimeout(() => broadcastSettings(result), 2000);
        });
    }

    // INJECT IMMEDIATELY - This is critical for hooking workers before Twitch creates them
    // inject.js (VOD unlock) MUST be injected FIRST to hook fetch before vaft.js
    injectScriptSync('scripts/inject.js', 'twitch-vod-injected');
    injectScriptSync('scripts/vaft.js', 'twitch-vaft-injected');
    injectScriptSync('scripts/dvr-ui.js', 'twitch-dvr-ui-injected');
    injectScriptSync('scripts/chat-undelete.js', 'twitch-chat-undelete-injected');
})();
