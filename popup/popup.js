// Twitch AdBlocker Popup Script

document.addEventListener('DOMContentLoaded', () => {
    const toggleAdBlock = document.getElementById('adblockToggle');
    const toggleVod = document.getElementById('vodToggle');
    const toggleDvr = document.getElementById('dvrToggle');

    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const adsBlockedEl = document.getElementById('adsBlocked');
    const vodsUnlockedEl = document.getElementById('vodsUnlocked');

    // Load current state
    function loadState() {
        chrome.runtime.sendMessage({ type: 'getState' }, (response) => {
            if (chrome.runtime.lastError) {
                console.log('Error:', chrome.runtime.lastError);
                return;
            }

            if (response) {
                if (toggleAdBlock) toggleAdBlock.checked = response.adBlockEnabled;
                if (toggleVod) toggleVod.checked = response.vodUnlockEnabled;
                if (toggleDvr) toggleDvr.checked = response.dvrEnabled;

                updateStatus(response.adBlockEnabled || response.vodUnlockEnabled || response.dvrEnabled);

                adsBlockedEl.textContent = response.adsBlocked || 0;
                if (vodsUnlockedEl) {
                    vodsUnlockedEl.textContent = response.vodsUnlocked || 0;
                }
            }
        });
    }

    // Update status UI
    function updateStatus(anyEnabled) {
        if (anyEnabled) {
            statusIndicator.classList.remove('inactive');
            statusIndicator.classList.add('active');
            statusText.textContent = 'Actif';
        } else {
            statusIndicator.classList.remove('active');
            statusIndicator.classList.add('inactive');
            statusText.textContent = 'Inactif';
        }
    }

    // Handle toggle changes
    function saveSettings() {
        const settings = {
            adBlockEnabled: toggleAdBlock.checked,
            vodUnlockEnabled: toggleVod.checked,
            dvrEnabled: toggleDvr.checked
        };
        chrome.runtime.sendMessage({ type: 'setState', ...settings }, () => {
            updateStatus(settings.adBlockEnabled || settings.vodUnlockEnabled || settings.dvrEnabled);
        });
    }

    if (toggleAdBlock) toggleAdBlock.addEventListener('change', saveSettings);
    if (toggleVod) toggleVod.addEventListener('change', saveSettings);
    if (toggleDvr) toggleDvr.addEventListener('change', saveSettings);

    // Initial load
    loadState();

    // Refresh stats periodically
    setInterval(loadState, 2000);
});
