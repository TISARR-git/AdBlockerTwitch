// Twitch AdBlocker Popup Script

// --- i18n Translations ---
const translations = {
    fr: {
        status_active: 'Actif',
        status_inactive: 'Inactif',
        toggle_adblock: 'Bloquer les pubs',
        toggle_vod: 'Débloquer les VODs',
        toggle_dvr: 'Bouton DVR (Retour arrière)',
        toggle_donation: 'Bouton de Don (Lecteur)',
        stat_ads: '🚫 Pubs bloquées',
        stat_vods: '🔓 VODs débloquées',
        donation_btn: '☕ Soutenir le projet',
        footer_msg: 'Pubs + VODs Sub-Only = Bye bye 👋',
        flag: 'FR',
        update_available: '🔥 Mise à jour disponible !',
        update_download: '📥 Télécharger',
        update_success: '✅ ZIP téléchargé ! Extrais-le pour remplacer l\'ancienne version.'
    },
    en: {
        status_active: 'Active',
        status_inactive: 'Inactive',
        toggle_adblock: 'Block ads',
        toggle_vod: 'Unlock VODs',
        toggle_dvr: 'DVR Button (Rewind)',
        toggle_donation: 'Donation Button (Player)',
        stat_ads: '🚫 Ads blocked',
        stat_vods: '🔓 VODs unlocked',
        donation_btn: '☕ Support the project',
        footer_msg: 'Ads + Sub-Only VODs = Bye bye 👋',
        flag: 'EN',
        update_available: '🔥 Update available!',
        update_download: '📥 Download',
        update_success: '✅ ZIP downloaded! Extract it to replace the old version.'
    }
};

let currentLang = 'fr';

function applyLanguage(lang) {
    currentLang = lang;
    const dict = translations[lang] || translations.fr;

    // Update all data-i18n elements
    document.querySelectorAll('[data-i18n]').forEach(el => {
        const key = el.getAttribute('data-i18n');
        if (dict[key]) {
            el.textContent = dict[key];
        }
    });

    // Update lang button flag
    const langBtn = document.getElementById('langBtn');
    if (langBtn) langBtn.textContent = dict.flag;

    // Update status text to match current state
    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    if (statusIndicator && statusText) {
        if (statusIndicator.classList.contains('inactive')) {
            statusText.textContent = dict.status_inactive;
        } else {
            statusText.textContent = dict.status_active;
        }
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const toggleAdBlock = document.getElementById('adblockToggle');
    const toggleVod = document.getElementById('vodToggle');
    const toggleDvr = document.getElementById('dvrToggle');
    const toggleDonation = document.getElementById('donationToggle');
    const langBtn = document.getElementById('langBtn');

    const statusIndicator = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const adsBlockedEl = document.getElementById('adsBlocked');
    const vodsUnlockedEl = document.getElementById('vodsUnlocked');

    // Update banner elements
    const updateBanner = document.getElementById('updateBanner');
    const updateVersionEl = document.getElementById('updateVersion');
    const updateBtn = document.getElementById('updateBtn');
    const updateSuccess = document.getElementById('updateSuccess');

    let updateDownloadUrl = null;

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
                if (toggleDonation) toggleDonation.checked = response.donationIconEnabled;

                updateStatus(response.adBlockEnabled || response.vodUnlockEnabled || response.dvrEnabled);

                adsBlockedEl.textContent = response.adsBlocked || 0;
                if (vodsUnlockedEl) {
                    vodsUnlockedEl.textContent = response.vodsUnlocked || 0;
                }

                // Apply saved language
                if (response.lang && response.lang !== currentLang) {
                    applyLanguage(response.lang);
                }
            }
        });
    }

    // Check for updates and show banner
    function checkAndShowUpdate() {
        chrome.runtime.sendMessage({ type: 'getUpdateInfo' }, (response) => {
            if (chrome.runtime.lastError) return;

            if (response && response.hasUpdate) {
                updateDownloadUrl = response.downloadUrl;
                if (updateVersionEl) updateVersionEl.textContent = 'v' + response.version;
                if (updateBanner) updateBanner.style.display = 'flex';
            }
        });
    }

    // Update status UI
    function updateStatus(anyEnabled) {
        const dict = translations[currentLang] || translations.fr;
        if (anyEnabled) {
            statusIndicator.classList.remove('inactive');
            statusIndicator.classList.add('active');
            statusText.textContent = dict.status_active;
        } else {
            statusIndicator.classList.remove('active');
            statusIndicator.classList.add('inactive');
            statusText.textContent = dict.status_inactive;
        }
    }

    // Handle toggle changes
    function saveSettings() {
        const settings = {
            adBlockEnabled: toggleAdBlock ? toggleAdBlock.checked : true,
            vodUnlockEnabled: toggleVod ? toggleVod.checked : true,
            dvrEnabled: toggleDvr ? toggleDvr.checked : true,
            donationIconEnabled: toggleDonation ? toggleDonation.checked : true
        };
        chrome.runtime.sendMessage({ type: 'setState', ...settings }, () => {
            updateStatus(settings.adBlockEnabled || settings.vodUnlockEnabled || settings.dvrEnabled);
        });
    }

    if (toggleAdBlock) toggleAdBlock.addEventListener('change', saveSettings);
    if (toggleVod) toggleVod.addEventListener('change', saveSettings);
    if (toggleDvr) toggleDvr.addEventListener('change', saveSettings);
    if (toggleDonation) toggleDonation.addEventListener('change', saveSettings);

    // Language toggle
    if (langBtn) {
        langBtn.addEventListener('click', () => {
            const newLang = currentLang === 'fr' ? 'en' : 'fr';
            applyLanguage(newLang);
            chrome.runtime.sendMessage({ type: 'setState', lang: newLang });
        });
    }

    // Download update button
    if (updateBtn) {
        updateBtn.addEventListener('click', () => {
            if (!updateDownloadUrl) return;
            updateBtn.disabled = true;
            updateBtn.style.opacity = '0.5';

            chrome.runtime.sendMessage({ type: 'downloadUpdate', url: updateDownloadUrl }, (response) => {
                if (response && response.success) {
                    updateBtn.style.display = 'none';
                    if (updateSuccess) updateSuccess.style.display = 'block';
                } else {
                    // Fallback: open in new tab
                    window.open(updateDownloadUrl, '_blank');
                    updateBtn.disabled = false;
                    updateBtn.style.opacity = '1';
                }
            });
        });
    }

    // Initial load
    loadState();

    // Check for updates (always check when popup opens, or when opened via ?update=true)
    checkAndShowUpdate();

    // Refresh stats periodically
    setInterval(loadState, 2000);
});
