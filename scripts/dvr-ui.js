// DVR UI - Custom seek bar for non-subscribers
(function () {
    'use strict';

    // Configuration
    const DVR_UPDATE_INTERVAL = 1000; // Update UI every second
    const DVR_BAR_ID = 'twitch-adblocker-dvr-bar';

    // State
    let dvrState = {
        enabled: false,
        userEnabled: true, // Controlled by popup toggle
        totalDuration: 0,
        currentTime: 0,
        channelName: null,
        videoElement: null,
        vodId: null,
        vodPlaylistUrl: null,   // CloudFront VOD playlist URL
        isVodMode: false,       // true when viewing VOD, false for live
        hlsInstance: null,      // HLS.js instance for VOD playback
        pendingSeekTime: null,  // Seek position after switching to VOD
        overlayVideo: null,
        lastPlayTime: 0,        // For stall detection
        userAdjustingVolume: false, // Flag to prevent guardian during user interaction
        preferredQuality: -1,   // Persist quality selection
        isSubscriber: null      // null: waiting, true: sub, false: non-sub
    };

    // Listen for early sub status before UI initializes
    window.addEventListener('twitch-sub-status', (event) => {
        const newStatus = event.detail.isSub;

        // PROTECTION: Never downgrade from confirmed sub to non-sub
        // This prevents backup anti-ad tokens from incorrectly resetting status
        if (dvrState.isSubscriber === true && newStatus === false) {
            console.log('[DVR UI] Ignoring sub status downgrade (already confirmed sub)');
            return;
        }

        dvrState.isSubscriber = newStatus;
        console.log('[DVR UI] Received sub status event:', dvrState.isSubscriber);

        // If the UI is already built and enabled, apply it immediately
        const dvrBar = document.getElementById(DVR_BAR_ID);
        if (dvrBar && dvrState.enabled) {
            dvrBar.style.display = (dvrState.isSubscriber === false) ? 'block' : 'none';
        }
    });

    // Pick up state if vaft.js already evaluated it before we loaded
    if (typeof window.__twitchSubscriberStatus !== 'undefined') {
        dvrState.isSubscriber = window.__twitchSubscriberStatus;
        console.log('[DVR UI] Found existing sub status window var:', dvrState.isSubscriber);
    }

    // Debounce timer for seeks in VOD mode
    let seekDebounceTimer = null;
    const SEEK_DEBOUNCE_MS = 300;

    // Load HLS.js dynamically
    let hlsLoaded = false;
    function loadHlsJs() {
        return new Promise((resolve, reject) => {
            if (window.Hls) {
                hlsLoaded = true;
                resolve(window.Hls);
                return;
            }
            if (hlsLoaded) {
                // Wait for it to load
                const check = setInterval(() => {
                    if (window.Hls) {
                        clearInterval(check);
                        resolve(window.Hls);
                    }
                }, 100);
                return;
            }
            hlsLoaded = true;
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/hls.js@latest';
            script.onload = () => {
                console.log('[DVR UI] HLS.js loaded');
                resolve(window.Hls);
            };
            script.onerror = () => reject(new Error('Failed to load HLS.js'));
            document.head.appendChild(script);
        });
    }

    // Format seconds to Twitch timestamp format (1h2m3s)
    function formatTwitchTimestamp(seconds) {
        if (!seconds || isNaN(seconds)) return '0s';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);

        let result = '';
        if (h > 0) result += `${h}h`;
        if (m > 0) result += `${m}m`;
        result += `${s}s`;
        return result;
    }

    // Format seconds to HH:MM:SS for display
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // Detect current quality from the original video element
    function getOriginalVideoQuality() {
        if (dvrState.videoElement) {
            const height = dvrState.videoElement.videoHeight;
            console.log('[DVR UI] Original video height:', height);
            return height || 1080; // Default to 1080 if unknown
        }
        return 1080;
    }

    // Map quality height to HLS level index (0 = highest, 5 = lowest)
    // Levels: chunked(1080), 720p60, 720p30, 480p30, 360p30, 160p30
    function getQualityLevelIndex(height, levels) {
        if (!levels || levels.length === 0) return 0;

        // Find closest level
        let bestLevel = 0;
        let bestDiff = Infinity;

        for (let i = 0; i < levels.length; i++) {
            const levelHeight = levels[i].height || 1080;
            const diff = Math.abs(levelHeight - height);
            if (diff < bestDiff) {
                bestDiff = diff;
                bestLevel = i;
            }
        }

        console.log('[DVR UI] Quality', height, 'p -> level', bestLevel);
        return bestLevel;
    }

    // Helper to find the main Twitch video element
    function findVideoElement() {
        // Try to find the main video element within the player
        const player = document.querySelector('.video-player');
        if (player) {
            return player.querySelector('video');
        }
        // Fallback to any video element if player not found
        return document.querySelector('video');
    }

    // Switch to VOD playback - Uses overlay that replaces original video
    async function switchToVod(seekTime) {
        console.log('[DVR DEBUG] Attempting switch to VOD at', seekTime);
        console.log('[DVR DEBUG] Current State:', {
            videoElement: dvrState.videoElement,
            hasPlaylistUrl: !!dvrState.vodPlaylistUrl,
            playlistUrl: dvrState.vodPlaylistUrl ? 'yes' : 'no'
        });

        // Fallback: Try to find video element if missing
        if (!dvrState.videoElement) {
            console.log('[DVR UI] Video element missing, trying to find it...');
            dvrState.videoElement = findVideoElement();
            console.log('[DVR DEBUG] Video element found?', !!dvrState.videoElement);
        }

        // OPTIMIZATION: If already in VOD mode with valid overlay, just seek!
        // This prevents rebuilding HLS, Quality resets, and black screens.
        // Also allow fast seek if hlsInstance exists, even if isVodMode flag is stale
        if ((dvrState.isVodMode || dvrState.hlsInstance) && dvrState.hlsInstance && dvrState.overlayVideo && document.body.contains(dvrState.overlayVideo)) {
            console.log('[DVR UI] Fast seek in VOD mode to', formatTime(seekTime));
            dvrState.overlayVideo.currentTime = seekTime;

            // Ensure visible (fix for black screen)
            dvrState.overlayVideo.style.visibility = 'visible';
            dvrState.overlayVideo.style.display = 'block';

            if (dvrState.overlayVideo.paused) {
                dvrState.overlayVideo.play().catch(e => console.log('[DVR UI] Seek play error:', e));
            }
            // Ensure quality is consistent
            if (dvrState.preferredQuality !== undefined && dvrState.preferredQuality !== -1 && dvrState.hlsInstance.currentLevel !== dvrState.preferredQuality) {
                console.log('[DVR UI] Fast seek restoring quality:', dvrState.preferredQuality);
                dvrState.hlsInstance.currentLevel = dvrState.preferredQuality;
            }
            return true;
        }

        if (!dvrState.vodPlaylistUrl || !dvrState.videoElement) {
            console.error('[DVR UI] Switch failed - Missing requirements:', {
                noUrl: !dvrState.vodPlaylistUrl,
                noVideo: !dvrState.videoElement
            });
            // One last try specifically for the video element
            dvrState.videoElement = document.querySelector('video');
            if (!dvrState.videoElement) return false;
        }

        try {
            const Hls = await loadHlsJs();
            if (!Hls.isSupported()) {
                console.log('[DVR UI] HLS.js not supported');
                return false;
            }

            console.log('[DVR UI] Switching to VOD mode at', formatTime(seekTime));

            // Destroy existing HLS instance if any
            if (dvrState.hlsInstance) {
                dvrState.hlsInstance.destroy();
                dvrState.hlsInstance = null;
            }

            // Clean up quality observer if exists
            if (dvrState.qualityObserver) {
                dvrState.qualityObserver.disconnect();
                dvrState.qualityObserver = null;
            }

            // Remove existing overlay if any
            const existingOverlay = document.getElementById('dvr-vod-overlay');
            if (existingOverlay) {
                existingOverlay.remove();
            }

            const originalVideo = dvrState.videoElement;

            // Save player state - if already in VOD mode, use overlay's current volume
            // Otherwise use original video's volume (first seek from live)
            let savedVolume, savedMuted;
            if (dvrState.isVodMode && dvrState.overlayVideo) {
                // Already in VOD mode - preserve overlay's volume
                savedVolume = dvrState.overlayVideo.volume;
                savedMuted = dvrState.overlayVideo.muted;
                console.log('[DVR UI] Preserving VOD volume:', savedVolume, 'muted:', savedMuted);
            } else {
                // First seek from live - read from original video
                savedVolume = originalVideo.volume;
                savedMuted = originalVideo.muted;
            }

            // Create overlay video that will REPLACE the original visually
            const overlayVideo = document.createElement('video');
            overlayVideo.id = 'dvr-vod-overlay';

            // Copy exact styling from original video
            const origRect = originalVideo.getBoundingClientRect();
            const origStyle = window.getComputedStyle(originalVideo);

            overlayVideo.style.cssText = `
                position: absolute;
                top: 0;
                left: 0;
                width: 100%;
                height: 100%;
                object-fit: contain;
                background: #000;
            `;

            // Copy playback attributes
            overlayVideo.volume = savedVolume;
            overlayVideo.muted = savedMuted;
            overlayVideo.playsInline = true;
            overlayVideo.autoplay = true;

            // Find the video-ref container and insert overlay there
            const videoRef = originalVideo.closest('.video-ref');
            if (videoRef) {
                // Insert overlay as first child of video-ref
                videoRef.style.position = 'relative';
                videoRef.insertBefore(overlayVideo, videoRef.firstChild);

                // Pause and mute the live stream (don't remove src - that breaks Twitch)
                originalVideo.style.visibility = 'hidden';
                dvrState.savedMuted = savedMuted;
                dvrState.savedVolume = savedVolume;

                // Mute and pause original - also set volume to 0 as extra safety
                originalVideo.muted = true;
                originalVideo.volume = 0;
                originalVideo.pause();
                console.log('[DVR UI] Live stream paused and muted');
            } else {
                // Fallback: insert next to original video
                originalVideo.parentElement.insertBefore(overlayVideo, originalVideo);
                originalVideo.style.visibility = 'hidden';
                dvrState.savedMuted = savedMuted;
                dvrState.savedVolume = savedVolume;

                originalVideo.muted = true;
                originalVideo.volume = 0;
                originalVideo.pause();
                console.log('[DVR UI] Live stream paused and muted (fallback)');
            }

            dvrState.overlayVideo = overlayVideo;
            dvrState.isVodMode = true;

            // Volume guardian - continuously ensure original video stays muted
            // AND keep slider display in sync with overlay volume
            if (dvrState.volumeGuardian) {
                clearInterval(dvrState.volumeGuardian);
            }
            dvrState.volumeGuardian = setInterval(() => {
                if (!dvrState.isVodMode) {
                    clearInterval(dvrState.volumeGuardian);
                    dvrState.volumeGuardian = null;
                    return;
                }

                // Force original video to stay silent
                if (dvrState.videoElement) {
                    if (!dvrState.videoElement.muted) {
                        dvrState.videoElement.muted = true;
                    }
                    if (dvrState.videoElement.volume !== 0) {
                        dvrState.videoElement.volume = 0;
                    }
                }

                // Keep slider display in sync with overlay volume
                // (Twitch React keeps resetting it to original video's volume which is 0)
                // BUT skip if user is actively adjusting volume
                if (dvrState.userAdjustingVolume) return;

                const slider = document.querySelector('[data-a-target="player-volume-slider"]');
                if (slider && dvrState.overlayVideo) {
                    const overlayVol = dvrState.overlayVideo.volume;
                    const sliderVal = parseFloat(slider.value);
                    const percent = Math.round(overlayVol * 100);

                    // Only update if significantly different to avoid jitter
                    if (Math.abs(sliderVal - overlayVol) > 0.02) {
                        slider.value = overlayVol;
                        // Update aria-valuetext for accessibility and display
                        slider.setAttribute('aria-valuetext', percent + '%');
                        slider.setAttribute('aria-valuenow', percent);

                        // Update the visual fill bar
                        const fillBar = slider.parentElement?.querySelector('[data-test-selector="tw-range__fill-value-selector"], .ScRangeFillValue-sc-q01wc3-3');
                        if (fillBar) {
                            fillBar.style.width = percent + '%';
                        }
                    }

                    // Also update tooltip if visible
                    const tooltip = document.querySelector('.tw-tooltip-wrapper');
                    if (tooltip && tooltip.innerText.includes('%')) {
                        tooltip.innerText = percent + ' %';
                    }
                }
            }, 100);

            // Create HLS instance
            const hls = new Hls({
                enableWorker: true,
                startPosition: seekTime,
                maxBufferLength: 60,
                maxMaxBufferLength: 120,
            });

            dvrState.hlsInstance = hls;

            hls.loadSource(dvrState.vodPlaylistUrl);
            hls.attachMedia(overlayVideo);

            hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
                console.log('[DVR UI] VOD manifest parsed, levels:', data.levels.length);

                // Default to MAX quality (highest resolution)
                let bestLevel = -1;
                let maxRes = 0;
                data.levels.forEach((level, index) => {
                    if (level.height > maxRes) {
                        maxRes = level.height;
                        bestLevel = index;
                    }
                });

                if (bestLevel !== -1) {
                    if (dvrState.preferredQuality !== undefined && dvrState.preferredQuality !== -1) {
                        console.log('[DVR UI] Restoring preferred quality:', dvrState.preferredQuality);
                        bestLevel = dvrState.preferredQuality;
                    } else {
                        console.log('[DVR UI] Selecting best quality (initial):', data.levels[bestLevel].height + 'p');
                    }
                    hls.currentLevel = bestLevel;
                    dvrState.currentQualityLevel = bestLevel;
                    dvrState.preferredQuality = bestLevel;
                }

                // Seek to target time
                overlayVideo.currentTime = seekTime;
            });

            // Start playback when first fragment loads
            hls.on(Hls.Events.FRAG_LOADED, function onFirstFrag() {
                hls.off(Hls.Events.FRAG_LOADED, onFirstFrag);
                overlayVideo.play().catch(e => console.log('[DVR UI] Play error:', e));
            });

            hls.on(Hls.Events.ERROR, (event, data) => {
                if (data.fatal) {
                    console.log('[DVR UI] Fatal HLS error, returning to live:', data.type);
                    switchToLive();
                }
            });

            // Setup Twitch controls to work with overlay
            setupControlsForOverlay(overlayVideo, originalVideo);

            // Update LIVE button to show we're behind
            updateLiveButton(false);

            // Force update mute button icon to show unmuted (if overlay has sound)
            setTimeout(() => {
                updateMuteButtonIcon(overlayVideo.muted);
            }, 500);

            return true;

        } catch (e) {
            console.log('[DVR UI] Error switching to VOD:', e);
            return false;
        }
    }

    // Setup Twitch controls to work with overlay video
    function setupControlsForOverlay(overlayVideo, originalVideo) {
        // Play/Pause button
        const playPauseBtn = document.querySelector('[data-a-target="player-play-pause-button"]');
        if (playPauseBtn) {
            const handler = (e) => {
                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    // Block generic Twitch handling
                    e.stopImmediatePropagation();
                    e.preventDefault();

                    if (dvrState.overlayVideo.paused) {
                        dvrState.overlayVideo.play();
                    } else {
                        dvrState.overlayVideo.pause();
                    }
                }
            };
            playPauseBtn.addEventListener('click', handler, true);

            // Sync visual icon and tooltip with actual overlay state
            const PLAY_SVG = 'M7 20.528V3.472c0-.38.405-.603.703-.388L20 12 7.703 20.916c-.298.215-.703-.008-.703-.388Z';
            const PAUSE_SVG = 'M10 4H5v16h5V4Zm9 0h-5v16h5V4Z';

            const updatePlayPauseIcon = () => {
                const svgPath = playPauseBtn.querySelector('svg path');
                if (svgPath) {
                    if (overlayVideo.paused) {
                        svgPath.setAttribute('d', PLAY_SVG);
                        playPauseBtn.setAttribute('aria-label', 'Lire');
                    } else {
                        svgPath.setAttribute('d', PAUSE_SVG);
                        playPauseBtn.setAttribute('aria-label', 'Pause');
                    }
                }
            };

            // Listen to native events so it updates even if paused via spacebar, API, etc.
            overlayVideo.addEventListener('play', updatePlayPauseIcon);
            overlayVideo.addEventListener('pause', updatePlayPauseIcon);
            // Set initial state
            updatePlayPauseIcon();
        }

        // Mute button - in VOD mode, just block the click entirely
        // We don't want to accidentally mute the overlay
        const muteBtn = document.querySelector('[data-a-target="player-mute-unmute-button"]');
        if (muteBtn) {
            muteBtn.addEventListener('click', (e) => {
                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    // Block generic Twitch handling
                    e.stopImmediatePropagation();
                    e.preventDefault();

                    // Manually toggle mute on our overlay
                    dvrState.overlayVideo.muted = !dvrState.overlayVideo.muted;
                    console.log('[DVR UI] Manual mute toggle. New state:', dvrState.overlayVideo.muted);

                    // Update the icon immediately
                    updateMuteButtonIcon(dvrState.overlayVideo.muted);
                }
            }, true);
        }

        // Volume slider - intercept ALL changes in VOD mode
        const volumeSlider = document.querySelector('[data-a-target="player-volume-slider"]');
        if (volumeSlider) {
            // Track when user starts adjusting - stop Twitch from interfering
            const startHandler = (e) => {
                dvrState.userAdjustingVolume = true;
                e.stopImmediatePropagation();
            };

            volumeSlider.addEventListener('mousedown', startHandler, true);
            volumeSlider.addEventListener('touchstart', startHandler, true);

            volumeSlider.addEventListener('input', (e) => {
                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    // Stop Twitch from handling this
                    e.stopImmediatePropagation();

                    const newVal = parseFloat(e.target.value);
                    const percent = Math.round(newVal * 100);

                    // Apply volume to overlay only
                    dvrState.overlayVideo.volume = newVal;
                    dvrState.savedVolume = newVal; // Save for later

                    // UPDATE VISUALS IMMEDIATELY
                    // Update aria attributes
                    volumeSlider.setAttribute('aria-valuetext', percent + '%');
                    volumeSlider.setAttribute('aria-valuenow', percent);

                    // Update the visual fill bar
                    const fillBar = volumeSlider.parentElement?.querySelector('[data-test-selector="tw-range__fill-value-selector"], .ScRangeFillValue-sc-q01wc3-3');
                    if (fillBar) {
                        fillBar.style.width = percent + '%';
                    }

                    // Update tooltip if visible
                    const tooltip = document.querySelector('.tw-tooltip-wrapper');
                    if (tooltip) {
                        tooltip.innerText = percent + ' %';
                    }

                    // Keep original silent
                    if (dvrState.videoElement) {
                        dvrState.videoElement.volume = 0;
                        dvrState.videoElement.muted = true;
                    }
                }
            }, true); // Capture phase

            // Also intercept 'change' event
            volumeSlider.addEventListener('change', (e) => {
                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    e.stopImmediatePropagation();
                    dvrState.overlayVideo.volume = parseFloat(e.target.value);
                    if (dvrState.videoElement) {
                        dvrState.videoElement.volume = 0;
                        dvrState.videoElement.muted = true;
                    }
                }
            }, true);

            // Reset flag when user stops adjusting
            const stopHandler = () => {
                setTimeout(() => { dvrState.userAdjustingVolume = false; }, 200);
            };
            volumeSlider.addEventListener('mouseup', stopHandler, true);
            volumeSlider.addEventListener('touchend', stopHandler, true);
        }

        // Click on video to play/pause
        overlayVideo.addEventListener('click', () => {
            if (overlayVideo.paused) {
                overlayVideo.play();
            } else {
                overlayVideo.pause();
            }
        });

        // Sync overlay play/pause state to Twitch button
        function updatePlayButtonState(isPlaying) {
            // Twitch listens to the original video's play/pause events
            // We dispatch fake events to make Twitch update its UI
            if (originalVideo) {
                if (isPlaying) {
                    // Dispatch 'playing' event to make Twitch show pause button
                    originalVideo.dispatchEvent(new Event('playing'));
                    originalVideo.dispatchEvent(new Event('play'));
                } else {
                    // Dispatch 'pause' event to make Twitch show play button  
                    originalVideo.dispatchEvent(new Event('pause'));
                }
            }

            // Also try to update aria-label as backup
            const playBtn = document.querySelector('[data-a-target="player-play-pause-button"]');
            if (playBtn) {
                playBtn.setAttribute('aria-label', isPlaying ? 'Pause (k)' : 'Play (k)');
            }
        }

        overlayVideo.addEventListener('play', () => {
            updatePlayButtonState(true);
        });

        overlayVideo.addEventListener('pause', () => {
            updatePlayButtonState(false);
        });

        // Watch for quality changes in Twitch settings menu
        function setupQualityObserver() {
            // Use MutationObserver to watch for quality menu appearing
            const observer = new MutationObserver((mutations) => {
                // Look for quality options
                const qualityOptions = document.querySelectorAll('[data-a-target="player-settings-submenu-quality-option"]');
                qualityOptions.forEach(option => {
                    if (!option.dataset.dvrHooked) {
                        option.dataset.dvrHooked = 'true';
                        option.addEventListener('click', (e) => {
                            if (!dvrState.isVodMode || !dvrState.hlsInstance) return;

                            // Parse quality from the option text
                            const text = option.textContent || '';
                            const match = text.match(/(\d+)p/);
                            if (match) {
                                const height = parseInt(match[1], 10);
                                console.log('[DVR UI] Quality changed to', height + 'p');

                                // Find and set the HLS level
                                const hls = dvrState.hlsInstance;
                                if (hls.levels) {
                                    const levelIndex = getQualityLevelIndex(height, hls.levels);
                                    hls.currentLevel = levelIndex;
                                    dvrState.currentQualityLevel = levelIndex;
                                }
                            }
                        });
                    }
                });
            });

            // Start observing the player container for menu changes
            const playerContainer = document.querySelector('.video-player__container');
            if (playerContainer) {
                observer.observe(playerContainer, { childList: true, subtree: true });
                dvrState.qualityObserver = observer; // Save for cleanup
            }
        }

        // Setup quality observer with delay to ensure DOM is ready
        setTimeout(setupQualityObserver, 500);
    }

    // Update LIVE button state
    function updateLiveButton(isLive) {
        const liveBtn = document.querySelector('.dvr-live-btn');
        if (liveBtn) {
            if (isLive) {
                liveBtn.classList.remove('behind');
                liveBtn.textContent = 'LIVE';
            } else {
                liveBtn.classList.add('behind');
                liveBtn.textContent = 'GO LIVE';
            }
        }
    }

    // Update mute button icon to match overlay state
    // Directly manipulates the SVG since Twitch React doesn't respond to events
    function updateMuteButtonIcon(isMuted) {
        const muteBtn = document.querySelector('[data-a-target="player-mute-unmute-button"]');
        if (!muteBtn) return;

        // Find the SVG inside the button
        const svg = muteBtn.querySelector('svg');
        if (!svg) return;

        // Clear existing paths
        while (svg.firstChild) {
            svg.removeChild(svg.firstChild);
        }

        if (isMuted) {
            // Muted icon (speaker with X) - single path
            const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path.setAttribute('d', 'm7 8 5.146-5.146a.5.5 0 0 1 .854.353v17.586a.5.5 0 0 1-.854.353L7 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h3Zm8.707 1.707-1.414-1.414L16.586 12l-2.293 2.293 1.414 1.414L18 13.414l2.293 2.293 1.414-1.414L19.414 12l2.293-2.293-1.414-1.414L18 10.586l-2.293-2.293Z');
            svg.appendChild(path);
            muteBtn.setAttribute('aria-label', 'Unmute (m)');
        } else {
            // Unmuted icon (speaker with waves) - two paths
            const path1 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path1.setAttribute('d', 'm7 8 5.146-5.146a.5.5 0 0 1 .854.353v17.586a.5.5 0 0 1-.854.353L7 16H4a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2h3Zm8-3a7 7 0 1 1 0 14v-2a5 5 0 0 0 0-10V5Z');
            svg.appendChild(path1);

            const path2 = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            path2.setAttribute('d', 'M15 9a3 3 0 1 1 0 6V9Z');
            svg.appendChild(path2);
            muteBtn.setAttribute('aria-label', 'Mute (m)');
        }

        console.log('[DVR UI] Updated mute button icon, showing:', isMuted ? 'muted' : 'unmuted');
    }

    // Switch back to live stream
    function switchToLive() {
        console.log('[DVR UI] Switching back to live');

        // Stop volume guardian
        if (dvrState.volumeGuardian) {
            clearInterval(dvrState.volumeGuardian);
            dvrState.volumeGuardian = null;
        }

        // Destroy HLS instance
        if (dvrState.hlsInstance) {
            dvrState.hlsInstance.destroy();
            dvrState.hlsInstance = null;
        }

        // Remove overlay video
        const overlay = document.getElementById('dvr-vod-overlay');
        if (overlay) {
            overlay.remove();
        }

        // Restore original video
        if (dvrState.videoElement) {
            dvrState.videoElement.style.visibility = 'visible';

            // Restore volume and mute state
            if (typeof dvrState.savedVolume !== 'undefined') {
                dvrState.videoElement.volume = dvrState.savedVolume;
            }
            if (typeof dvrState.savedMuted !== 'undefined') {
                dvrState.videoElement.muted = dvrState.savedMuted;
            }

            // Resume playback
            dvrState.videoElement.play().catch(e => console.log('[DVR UI] Play error:', e));
        }

        dvrState.isVodMode = false;
        dvrState.overlayVideo = null;

        // Update LIVE button
        updateLiveButton(true);
        console.log('[DVR UI] Returned to live stream');
    }

    // Handler for LIVE button click
    function goToLive() {
        if (dvrState.isVodMode) {
            switchToLive();
        }
    }


    // Create DVR seek bar UI
    function createDvrBar() {
        if (document.getElementById(DVR_BAR_ID)) return;

        const container = document.createElement('div');
        container.id = DVR_BAR_ID;
        container.innerHTML = `
            <div class="dvr-bar-wrapper">
                <div class="dvr-time-display">
                    <span class="dvr-current-time">00:00:00</span>
                    <span class="dvr-separator">/</span>
                    <span class="dvr-total-time">00:00:00</span>
                </div>
                <div class="dvr-progress-container">
                    <div class="dvr-progress-bar">
                        <div class="dvr-progress-buffered"></div>
                        <div class="dvr-progress-played"></div>
                        <div class="dvr-progress-handle"></div>
                    </div>
                    <div class="dvr-tooltip">00:00:00</div>
                </div>
                <button class="dvr-live-btn">LIVE</button>
            </div>
        `;

        // Styles
        const style = document.createElement('style');
        style.textContent = `
            #${DVR_BAR_ID} {
                display: none; /* Hide initially until enabled and sub-checked */
                position: absolute;
                bottom: 30px;
                left: 0;
                right: 0;
                z-index: 9999;
                padding: 4px 12px 8px 12px;
                background: transparent;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.2s ease;
            }
            #${DVR_BAR_ID}.visible {
                opacity: 1;
            }
            #${DVR_BAR_ID}.active {
                pointer-events: auto;
            }
            .dvr-bar-wrapper {
                display: flex;
                align-items: center;
                gap: 10px;
            }
            .dvr-time-display {
                font-family: 'Roobert', 'Inter', sans-serif;
                font-size: 13px;
                color: #fff;
                min-width: 140px;
                text-shadow: 0 1px 3px rgba(0,0,0,0.8);
            }
            .dvr-separator {
                margin: 0 4px;
                opacity: 0.7;
            }
            .dvr-progress-container {
                flex: 1;
                padding: 8px 0;
                cursor: pointer;
                position: relative;
            }
            .dvr-progress-bar {
                position: relative;
                height: 4px;
                background: rgba(255,255,255,0.25);
                border-radius: 2px;
                overflow: visible;
                transition: height 0.1s ease;
            }
            .dvr-progress-container:hover .dvr-progress-bar,
            .dvr-progress-container.dragging .dvr-progress-bar {
                height: 6px;
            }
            .dvr-progress-buffered {
                position: absolute;
                top: 0;
                left: 0;
                height: 100%;
                background: rgba(255,255,255,0.35);
                border-radius: 2px;
                width: 0%;
            }
            .dvr-progress-played {
                position: absolute;
                top: 0;
                left: 0;
                height: 100%;
                background: linear-gradient(90deg, #9147ff, #bf94ff);
                border-radius: 2px;
                width: 0%;
            }
            .dvr-progress-handle {
                position: absolute;
                top: 50%;
                left: 0%;
                width: 14px;
                height: 14px;
                background: #fff;
                border-radius: 50%;
                transform: translate(-50%, -50%) scale(0);
                box-shadow: 0 2px 4px rgba(0,0,0,0.4);
                transition: transform 0.1s ease;
            }
            .dvr-progress-container:hover .dvr-progress-handle,
            .dvr-progress-container.dragging .dvr-progress-handle {
                transform: translate(-50%, -50%) scale(1);
            }
            .dvr-tooltip {
                position: absolute;
                bottom: 24px;
                left: 0;
                background: rgba(0,0,0,0.9);
                color: #fff;
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-family: 'Roobert', 'Inter', sans-serif;
                white-space: nowrap;
                pointer-events: none;
                opacity: 0;
                transform: translateX(-50%);
                transition: opacity 0.1s ease;
                z-index: 10000;
            }
            .dvr-progress-container:hover .dvr-tooltip,
            .dvr-progress-container.dragging .dvr-tooltip {
                opacity: 1;
            }
            .dvr-live-btn {
                background: #eb0400;
                color: #fff;
                border: none;
                border-radius: 4px;
                padding: 4px 10px;
                font-size: 11px;
                font-weight: 700;
                cursor: pointer;
                text-transform: uppercase;
                transition: background 0.15s ease;
            }
            .dvr-live-btn:hover {
                background: #ff3333;
            }
            .dvr-live-btn.behind {
                background: #666;
            }
            .dvr-live-btn.behind:hover {
                background: #888;
            }
        `;

        document.head.appendChild(style);
        return container;
    }

    // Format seconds to HH:MM:SS
    function formatTime(seconds) {
        if (!seconds || isNaN(seconds)) return '00:00:00';
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
    }

    // Update DVR bar UI
    function updateDvrUI() {
        const bar = document.getElementById(DVR_BAR_ID);
        if (!bar || !dvrState.enabled) return;

        // Use overlay video when in VOD mode, otherwise use original video
        const video = dvrState.isVodMode && dvrState.overlayVideo ? dvrState.overlayVideo : dvrState.videoElement;
        if (!video) return;

        // In live mode, increment totalDuration every second (since stream is ongoing)
        if (!dvrState.isVodMode && dvrState.totalDuration > 0 && !video.paused) {
            dvrState.totalDuration += DVR_UPDATE_INTERVAL / 1000; // Add 1 second
        }

        const rawDuration = video.duration;
        const buffered = video.buffered;
        const totalDuration = dvrState.totalDuration || 0;

        let displayCurrentTime, displayDuration;

        if (dvrState.isVodMode) {
            // In VOD mode, use video's actual time
            displayCurrentTime = video.currentTime || 0;
            displayDuration = (isFinite(rawDuration) && rawDuration > 0) ? rawDuration : totalDuration;
        } else {
            // In LIVE mode, video.currentTime is relative to buffer (0-30s)
            // We need to show position relative to stream start
            // displayCurrentTime = totalDuration - (how far behind live we are)
            displayDuration = totalDuration;
            if (buffered && buffered.length > 0) {
                const bufferedEnd = buffered.end(buffered.length - 1);
                const delayFromLive = bufferedEnd - (video.currentTime || 0);
                displayCurrentTime = Math.max(0, totalDuration - delayFromLive);
            } else {
                displayCurrentTime = totalDuration; // Assume at live edge
            }
        }

        // Update time display
        const currentTimeEl = bar.querySelector('.dvr-current-time');
        const totalTimeEl = bar.querySelector('.dvr-total-time');
        if (currentTimeEl) currentTimeEl.textContent = formatTime(displayCurrentTime);
        if (totalTimeEl) totalTimeEl.textContent = formatTime(displayDuration);

        // Update progress bar
        const progress = displayDuration > 0 ? (displayCurrentTime / displayDuration) * 100 : 0;
        const playedEl = bar.querySelector('.dvr-progress-played');
        const handleEl = bar.querySelector('.dvr-progress-handle');
        if (playedEl) playedEl.style.width = `${progress}%`;
        if (handleEl) handleEl.style.left = `${progress}%`;

        // Update buffered bar (in live mode, buffer is always at the end)
        const bufferedEl = bar.querySelector('.dvr-progress-buffered');
        if (bufferedEl) {
            if (dvrState.isVodMode && buffered && buffered.length > 0) {
                const bufferedEnd = buffered.end(buffered.length - 1);
                const bufferedProgress = displayDuration > 0 ? (bufferedEnd / displayDuration) * 100 : 0;
                bufferedEl.style.width = `${bufferedProgress}%`;
            } else {
                // In live mode, buffer is at the live edge (end of the bar)
                bufferedEl.style.width = '100%';
            }
        }

        // Update live button
        const liveBtn = bar.querySelector('.dvr-live-btn');
        const isLive = !dvrState.isVodMode && (displayDuration > 0 && (displayDuration - displayCurrentTime) < 10);
        if (liveBtn) {
            liveBtn.classList.toggle('behind', !isLive);
            liveBtn.textContent = isLive ? 'LIVE' : 'GO LIVE';
        }
    }

    // Handle seek - Switch to VOD mode for backward seek
    async function handleSeek(e, progressContainer) {
        const video = dvrState.videoElement;
        if (!video) return;

        const rect = progressContainer.getBoundingClientRect();
        const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
        // For live streams, video.duration is Infinity - use totalDuration instead
        const rawDuration = video.duration;
        const duration = (isFinite(rawDuration) && rawDuration > 0) ? rawDuration : (dvrState.totalDuration || 0);
        if (!duration || duration <= 0) {
            console.log('[DVR UI] No valid duration available. totalDuration:', dvrState.totalDuration);
            return;
        }

        const seekTime = percent * duration;
        const currentTime = video.currentTime || 0;
        const bufferedEnd = video.buffered && video.buffered.length > 0 ? video.buffered.end(video.buffered.length - 1) : currentTime;

        console.log('[DVR UI] Seek requested to', formatTime(seekTime), '- Buffered end:', formatTime(bufferedEnd));

        // If already in VOD mode, debounce and seek
        if (dvrState.isVodMode) {
            // Debounce rapid seeks to prevent player freeze
            if (seekDebounceTimer) {
                clearTimeout(seekDebounceTimer);
            }
            seekDebounceTimer = setTimeout(() => {
                console.log('[DVR UI] VOD mode - debounced seek to', formatTime(seekTime));
                const activeVideo = dvrState.overlayVideo || video;
                activeVideo.currentTime = seekTime;
                activeVideo.play().catch(e => console.log('[DVR UI] Play error after seek:', e));
                updateDvrUI();
            }, SEEK_DEBOUNCE_MS);
            return;
        }

        // If seeking within the buffered region, use normal seek
        if (seekTime <= bufferedEnd && seekTime >= 0) {
            console.log('[DVR UI] Normal seek within buffer to', formatTime(seekTime));
            video.currentTime = seekTime;
            updateDvrUI();
            return;
        }

        // Seeking backward to unbuffered position - switch to VOD mode
        if (dvrState.vodPlaylistUrl) {
            console.log('[DVR UI] Switching to VOD for backward seek to', formatTime(seekTime));
            const success = await switchToVod(seekTime);
            if (!success) {
                alert('Erreur lors du chargement du VOD');
            }
        } else {
            console.log('[DVR UI] No VOD playlist URL available');
            alert('DVR non disponible - pas de VOD trouvé');
        }
    }

    // Format timestamp for Twitch VOD URL (HhMmSs format)
    function formatTimestamp(seconds) {
        const h = Math.floor(seconds / 3600);
        const m = Math.floor((seconds % 3600) / 60);
        const s = Math.floor(seconds % 60);
        return `${h}h${m}m${s}s`;
    }

    // Go to live
    function goToLive() {
        if (dvrState.isVodMode) {
            console.log('[DVR UI] Exiting VOD mode, returning to live');
            switchToLive();
        } else {
            // Already in live mode, seek to end of buffer (not video.duration which is Infinity for live)
            const video = dvrState.videoElement;
            if (video && video.buffered && video.buffered.length > 0) {
                const livePoint = video.buffered.end(video.buffered.length - 1);
                console.log('[DVR UI] Seeking to live edge:', formatTime(livePoint));
                video.currentTime = Math.max(0, livePoint - 2);
                updateDvrUI();
            }
        }
    }

    // Get channel name from URL
    function getChannelName() {
        const path = window.location.pathname;
        // Pattern: /channel or /{username}
        const match = path.match(/^\/([^\/]+)/);
        if (match && match[1] && !['directory', 'videos', 'settings', 'subscriptions', 'drops', 'wallet'].includes(match[1])) {
            return match[1].toLowerCase();
        }
        return null;
    }

    // Fetch VOD ID for current live stream
    async function fetchVodId(channelName) {
        try {
            const resp = await fetch("https://gql.twitch.tv/gql", {
                method: 'POST',
                body: JSON.stringify({
                    query: `query { user(login: "${channelName}") { videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { id, lengthSeconds } } } } }`
                }),
                headers: {
                    'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const data = await resp.json();
            if (data?.data?.user?.videos?.edges?.length > 0) {
                const node = data.data.user.videos.edges[0].node;
                return { id: node.id, duration: node.lengthSeconds };
            }
        } catch (e) {
            console.log('[DVR UI] Error fetching VOD ID:', e);
        }
        return null;
    }

    // Fetch VOD playlist URL and construct Master Playlist natively
    async function fetchVodPlaylistUrl(vodId, initialDuration) {
        try {
            console.log(`[DVR UI] Fetching playlist for VOD ${vodId} natively via GQL...`);
            const resp = await fetch("https://gql.twitch.tv/gql", {
                method: 'POST',
                body: JSON.stringify({
                    query: `query { video(id: "${vodId}") { seekPreviewsURL broadcastType } }`
                }),
                headers: {
                    'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko',
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
            const data = await resp.json();
            if (data && data.data && data.data.video && data.data.video.seekPreviewsURL) {
                const video = data.data.video;
                const currentURL = new URL(video.seekPreviewsURL);
                const domain = currentURL.host;
                const paths = currentURL.pathname.split("/");
                const sbIdx = paths.findIndex(p => p.includes("storyboards"));
                if (sbIdx > 0) {
                    const vodSpecialID = paths[sbIdx - 1];
                    const broadcastType = (video.broadcastType || 'archive').toLowerCase();
                    
                    const qualities = ['chunked', '720p60', '720p30', '480p30', '360p30', '160p30'];
                    const bandwidths = { 'chunked': 8000000, '720p60': 4500000, '720p30': 3000000, '480p30': 1500000, '360p30': 750000, '160p30': 250000 };
                    const heights = { 'chunked': 1080, '720p60': 720, '720p30': 720, '480p30': 480, '360p30': 360, '160p30': 160 };

                    let masterPlaylist = '#EXTM3U\n#EXT-X-VERSION:3\n';

                    for (const quality of qualities) {
                        let playlistUrl;
                        if (broadcastType === 'highlight') {
                            playlistUrl = `https://${domain}/${vodSpecialID}/${quality}/highlight-${vodId}.m3u8`;
                        } else {
                            playlistUrl = `https://${domain}/${vodSpecialID}/${quality}/index-dvr.m3u8`;
                        }

                        masterPlaylist += `#EXT-X-STREAM-INF:BANDWIDTH=${bandwidths[quality]},RESOLUTION=${Math.round(heights[quality] * 16 / 9)}x${heights[quality]}\n`;
                        masterPlaylist += playlistUrl + '\n';
                    }

                    console.log(`[DVR UI] Generated native M3U8 Master Playlist for VOD: ${vodId} (${vodSpecialID})`);
                    
                    const playlistDataUrl = 'data:application/vnd.apple.mpegurl;base64,' + btoa(masterPlaylist);

                    return {
                        playlistUrl: playlistDataUrl,
                        duration: initialDuration || 0,
                        createdAt: new Date().toISOString()
                    };
                }
            }
        } catch (e) {
            console.error('[DVR UI] Error fetching native VOD playlist:', e);
        }
        return null;
    }
    // Initialize DVR bar
    function initDvrBar() {
        // Only initialize DVR on live stream pages (direct channel URLs)
        // Skip on VOD pages and clip pages - native player works fine there
        const path = window.location.pathname;
        if (path.startsWith('/videos/') || path.includes('/clip/')) {
            console.log('[DVR UI] On VOD/clip page, skipping DVR');
            return;
        }

        // Also skip if not a channel page (e.g., homepage, directory, etc.)
        // Channel pages are like /channelname or /channelname?...
        const pathParts = path.split('/').filter(p => p);
        if (pathParts.length === 0 || pathParts[0] === 'directory' || pathParts[0] === 'settings') {
            return;
        }

        // Find player container
        const playerContainer = document.querySelector('[data-a-target="video-player"]') ||
            document.querySelector('.video-player') ||
            document.querySelector('.persistent-player');

        if (!playerContainer) {
            console.log('[DVR UI] Player container not found, retrying...');
            setTimeout(initDvrBar, 1000);
            return;
        }

        // Find video element
        const video = playerContainer.querySelector('video');
        if (!video) {
            console.log('[DVR UI] Video element not found, retrying...');
            setTimeout(initDvrBar, 1000);
            return;
        }

        dvrState.videoElement = video;

        // --- OVERLAY AUTO-CLICKER (Age Gate, Mature Content) ---
        function checkAndClickOverlays() {
            const overlays = [
                '[data-a-target="player-overlay-mature-accept"]',
                '[data-a-target="content-classification-gate-overlay-start-button"]',
                '.content-overlay-gate__allow-button',
                'button[aria-label="Commencer à regarder"]'
            ];

            for (const selector of overlays) {
                const btn = document.querySelector(selector);
                if (btn) {
                    console.log('[DVR UI] Overlay detected, clicking:', selector);
                    btn.click();
                    return true;
                }
            }
            return false;
        }

        // Run once initially in case overlay is already there
        checkAndClickOverlays();

        // Use a MutationObserver instead of setInterval to save CPU cycles
        const overlayObserver = new MutationObserver((mutations) => {
            for (const mutation of mutations) {
                if (mutation.addedNodes && mutation.addedNodes.length > 0) {
                    if (checkAndClickOverlays()) break;
                }
            }
        });
        
        // Observe the player container to catch overlays popping up
        if (playerContainer) {
            overlayObserver.observe(playerContainer, { childList: true, subtree: true });
        }
        // ------------------------------------------

        // Create and insert DVR bar
        const dvrBar = createDvrBar();
        if (!dvrBar) return;

        // Make player container position relative
        const playerWrapper = playerContainer.querySelector('.video-player__container') || playerContainer;
        playerWrapper.style.position = 'relative';
        playerWrapper.appendChild(dvrBar);

        console.log('[DVR UI] DVR bar injected');

        // Event listeners
        const progressContainer = dvrBar.querySelector('.dvr-progress-container');
        const tooltip = dvrBar.querySelector('.dvr-tooltip');
        const handleEl = dvrBar.querySelector('.dvr-progress-handle');

        if (progressContainer) {
            let isDragging = false;

            // Calculate time from mouse position
            function getTimeFromMousePos(e) {
                const rect = progressContainer.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const duration = dvrState.totalDuration || 0;
                return percent * duration;
            }

            // Handle seek - switch to VOD at target time (with debounce)
            let seekDebounceTimer = null;
            function handleSeek(e, container) {
                const seekTime = getTimeFromMousePos(e);

                // Debounce to prevent double calls
                if (seekDebounceTimer) {
                    clearTimeout(seekDebounceTimer);
                }

                seekDebounceTimer = setTimeout(() => {
                    console.log('[DVR UI] Seeking to', formatTime(seekTime));

                    // If seeking to near the end (within 10 seconds of live), just go to live
                    if (dvrState.totalDuration - seekTime < 10) {
                        console.log('[DVR UI] Near live edge, staying on live stream');
                        if (dvrState.isVodMode) {
                            switchToLive();
                        }
                        return;
                    }

                    // Otherwise switch to VOD
                    switchToVod(seekTime);
                }, 100); // Short debounce, just to prevent double clicks
            }

            // Update tooltip position and text
            function updateTooltip(e) {
                const rect = progressContainer.getBoundingClientRect();
                const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
                const time = getTimeFromMousePos(e);

                if (tooltip) {
                    tooltip.textContent = formatTime(time);
                    tooltip.style.left = `${percent * 100}%`;
                }

                // During drag, also move the handle visually
                if (isDragging && handleEl) {
                    handleEl.style.left = `${percent * 100}%`;
                }
            }

            // Mousemove for tooltip preview
            progressContainer.addEventListener('mousemove', updateTooltip);

            // Click to seek
            progressContainer.addEventListener('click', (e) => {
                if (!isDragging) {
                    handleSeek(e, progressContainer);
                }
            });

            // Drag support
            progressContainer.addEventListener('mousedown', (e) => {
                isDragging = true;
                progressContainer.classList.add('dragging');
                updateTooltip(e);
                e.preventDefault(); // Prevent text selection
            });

            document.addEventListener('mousemove', (e) => {
                if (isDragging) {
                    updateTooltip(e);
                }
            });

            document.addEventListener('mouseup', (e) => {
                if (isDragging) {
                    isDragging = false;
                    progressContainer.classList.remove('dragging');
                    // Perform the actual seek on mouseup
                    handleSeek(e, progressContainer);
                }
            });
        }

        const liveBtn = dvrBar.querySelector('.dvr-live-btn');
        if (liveBtn) {
            liveBtn.addEventListener('click', goToLive);
        }

        // Show/hide on player hover with 4s inactivity timeout (Sync with Twitch Native UI)
        let dvrInactivityTimeout;
        const SHOW_DURATION = 4900;

        const showDvrBar = () => {
            if (!dvrBar.classList.contains('visible')) {
                dvrBar.classList.add('visible', 'active');
            }
            clearTimeout(dvrInactivityTimeout);
            dvrInactivityTimeout = setTimeout(() => {
                // If the user's mouse is currently resting directly *on* the DVR bar, don't hide it
                if (!dvrBar.matches(':hover')) {
                    dvrBar.classList.remove('visible', 'active');
                }
            }, SHOW_DURATION);
        };

        playerContainer.addEventListener('mousemove', showDvrBar);
        playerContainer.addEventListener('mouseenter', showDvrBar);
        playerContainer.addEventListener('mouseleave', () => {
            clearTimeout(dvrInactivityTimeout);
            dvrBar.classList.remove('visible', 'active');
        });
        dvrBar.addEventListener('mousemove', showDvrBar);

        // Check if DVR is available (listen for messages from worker or settings)
        window.addEventListener('message', (event) => {
            if (!event.data) return;

            if (event.data.type === 'TWITCH_ADBLOCK_SETTINGS') {
                const settings = event.data.settings;
                if (settings && typeof settings.dvrEnabled !== 'undefined') {
                    dvrState.userEnabled = settings.dvrEnabled;
                    console.log('[DVR UI] Settings toggled. DVR User Enabled:', dvrState.userEnabled);
                    // Force update UI visibility immediately
                    if (!dvrState.userEnabled && dvrBar) {
                        dvrBar.style.display = 'none';
                    } else if (dvrState.userEnabled && dvrState.enabled && dvrState.isSubscriber === false && dvrBar) {
                        dvrBar.style.display = 'block';
                    }
                }
            } else if (event.data.type === 'DVR_STATUS') {
                dvrState.enabled = event.data.enabled;
                dvrState.totalDuration = event.data.totalDuration || 0;
                dvrState.channelName = event.data.channelName;
                dvrState.vodId = event.data.vodId;

                if (dvrState.enabled && dvrState.userEnabled) {
                    if (dvrState.isSubscriber === false) {
                        console.log('[DVR UI] DVR enabled (non-sub) for', dvrState.channelName, '- VOD:', dvrState.vodId, '- Duration:', formatTime(dvrState.totalDuration));
                        dvrBar.style.display = 'block';
                    } else if (dvrState.isSubscriber === true) {
                        dvrBar.style.display = 'none';
                    } else {
                        console.log('[DVR UI] DVR enabled but sub status is pending. Waiting for DOM fallback.');
                    }
                } else {
                    dvrBar.style.display = 'none';
                }
            }
        });

        // Update UI periodically
        setInterval(updateDvrUI, DVR_UPDATE_INTERVAL);

        // Function to initialize logic for a specific channel
        async function initializeForChannel() {
            const channelName = getChannelName();

            // Strict check: if staying on same channel (name comparison), do nothing
            // This prevents resets when URL changes but channel is same (e.g. /video/x)
            if (channelName && dvrState.channelName && channelName.toLowerCase() === dvrState.channelName.toLowerCase() && dvrState.initialized) {
                console.log('[DVR UI] Channel name unchanged (' + channelName + '), ignoring re-init');
                return;
            }

            // Reset state for new channel
            const isRealChannelChange = !dvrState.channelName || channelName.toLowerCase() !== dvrState.channelName.toLowerCase();
            dvrState.channelName = channelName;
            dvrState.initialized = true;
            dvrState.enabled = false;
            // Only reset sub status on a REAL channel change, not on re-init of the same channel
            if (isRealChannelChange) {
                dvrState.isSubscriber = null;
                console.log('[DVR UI] Channel changed to', channelName, '- resetting sub status');
            } else {
                console.log('[DVR UI] Re-init for same channel', channelName, '- keeping sub status:', dvrState.isSubscriber);
            }
            dvrState.vodId = null;
            dvrState.vodPlaylistUrl = null;
            dvrState.isVodMode = false;
            dvrState.hlsInstance = null;
            dvrState.videoElement = null; // Will be re-found

            // Clean up existing overlay if any
            const existingOverlay = document.getElementById('dvr-vod-overlay');
            if (existingOverlay) existingOverlay.remove();

            // Reset UI
            if (channelName) {
                console.log('[DVR UI] Detected channel:', channelName);

                // Fetch VOD ID and current duration for live stream
                const vodInfo = await fetchVodId(channelName);

                // CRITICAL: Find the new video element after navigation
                const newVideo = findVideoElement();
                if (newVideo) {
                    dvrState.videoElement = newVideo;
                    console.log('[DVR UI] Found and updated video element for new channel');
                } else {
                    console.warn('[DVR UI] Could not find video element for new channel!');
                }

                if (vodInfo && vodInfo.id) {
                    dvrState.vodId = vodInfo.id;
                    console.log('[DVR UI] Found VOD ID:', vodInfo.id, 'Duration:', vodInfo.duration);

                    // Get the CloudFront playlist URL
                    const vodData = await fetchVodPlaylistUrl(vodInfo.id, vodInfo.duration);
                    if (vodData && vodData.playlistUrl) {
                        dvrState.vodPlaylistUrl = vodData.playlistUrl;
                        dvrState.totalDuration = vodData.duration;
                        dvrState.enabled = true;

                        if (dvrState.isSubscriber === false) {
                            console.log('[DVR UI] DVR enabled (non-sub via token) - Duration:', formatTime(vodData.duration));
                            dvrBar.style.display = 'block';
                        } else if (dvrState.isSubscriber === true) {
                            console.log('[DVR UI] User IS a subscriber to', channelName, 'via token - hiding DVR');
                            dvrBar.style.display = 'none';
                        } else {
                            // DOM FALLBACK LOGIC
                            // Token check failed (cached out). We must poll the DOM for the native DVR (seekbar).
                            console.log('[DVR UI] Sub status pending via token for', channelName, '- starting DOM fallback check');
                            dvrBar.style.display = 'none'; // Hide temporarily until we know

                            let domChecksAttempts = 0;
                            const maxAttempts = 30; // 15 seconds max (500ms * 30)

                            const domCheckInterval = setInterval(() => {
                                // Double check if token arrived late
                                if (dvrState.isSubscriber !== null) {
                                    clearInterval(domCheckInterval);
                                    if (dvrState.isSubscriber === false) dvrBar.style.display = 'block';
                                    return;
                                }

                                domChecksAttempts++;

                                // Look for Twitch Native DVR (seekbar)
                                const nativeDvr = document.querySelector('[data-a-target="player-seekbar"]');
                                if (nativeDvr) {
                                    console.log('[DVR UI] DOM Fallback: Native DVR detected for', channelName, '(User has DVR access)');
                                    dvrState.isSubscriber = true;
                                    dvrBar.style.display = 'none';
                                    clearInterval(domCheckInterval);
                                    return;
                                }

                                // Si les contrôles du lecteur sont chargés mais qu'il n'y a pas de seekbar au bout d'environ 3 secondes (6 * 500ms)
                                const playerControls = document.querySelector('.player-controls__left-control-group') || document.querySelector('[data-a-target="player-controls"]');
                                if (playerControls && domChecksAttempts > 6) {
                                    console.log('[DVR UI] DOM Fallback: Player controls loaded but no native DVR found. Showing custom DVR.');
                                    dvrState.isSubscriber = false;
                                    dvrBar.style.display = 'block';
                                    clearInterval(domCheckInterval);
                                    return;
                                }

                                if (domChecksAttempts >= maxAttempts) {
                                    console.log('[DVR UI] DOM Fallback: Timeout (15s). Defaulting to show custom DVR.');
                                    // By default, if we can't figure it out, we show the DVR.
                                    dvrState.isSubscriber = false;
                                    dvrBar.style.display = 'block';
                                    clearInterval(domCheckInterval);
                                }
                            }, 500);
                        }
                    } else {
                        console.log('[DVR UI] Could not get VOD playlist URL');
                        dvrBar.style.display = 'none';
                    }
                } else {
                    console.log('[DVR UI] No VOD found for', channelName);
                    dvrBar.style.display = 'none';
                }
            } else {
                console.log('[DVR UI] Not on a channel page');
                dvrBar.style.display = 'none';
            }
            updateDvrUI();
        }

        // Initial check
        initializeForChannel();

        // Watch for URL changes (SPA navigation) using custom event
        window.addEventListener('TWITCH_DVR_URL_CHANGED', () => {
            console.log('[DVR UI] URL change event received - re-initializing for channel...');
            // Small delay to let SPA finish rendering
            setTimeout(initializeForChannel, 1000);
        });
    }

    // --- GLOBAL SPA NAVIGATION DETECTION ---
    // This runs permanently even if initDvrBar aborts (e.g. on home page)
    let lastPath = window.location.pathname;
    function checkUrlChange() {
        const newPath = window.location.pathname;
        if (newPath !== lastPath) {
            lastPath = newPath;
            console.log('[DVR UI] Global URL change detected:', newPath);

            // 1. Notify existing DVR instances to update
            window.dispatchEvent(new CustomEvent('TWITCH_DVR_URL_CHANGED'));

            // 2. If DVR bar is not injected yet (e.g. started on homepage), try to bootstrap it
            if (!document.getElementById(DVR_BAR_ID)) {
                console.log('[DVR UI] DVR not found on new page, attempting bootstrap...');
                setTimeout(initDvrBar, 2000);
            }
        }
    }

    // Hook pushState and replaceState
    const origPushState = history.pushState;
    history.pushState = function() {
        origPushState.apply(this, arguments);
        checkUrlChange();
    };

    const origReplaceState = history.replaceState;
    history.replaceState = function() {
        origReplaceState.apply(this, arguments);
        checkUrlChange();
    };

    // Listen for back/forward
    window.addEventListener('popstate', checkUrlChange);
    // ---------------------------------------

    // Keyboard navigation: Left/Right arrows seek -10s/+10s
    // Placed outside initDvrBar to prevent multiple bindings if init is called again
    let hasBoundKeyboardEvent = false;
    function bindKeyboardEvents() {
        if (hasBoundKeyboardEvent) return;
        hasBoundKeyboardEvent = true;

        document.addEventListener('keydown', (e) => {
            // Don't interfere with input fields
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.isContentEditable) return;

            // Only handle arrow keys
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;

            // Must have DVR enabled
            if (!dvrState.enabled || !dvrState.vodPlaylistUrl) return;

            const SEEK_STEP = 10; // seconds

            if (e.key === 'ArrowLeft') {
                e.preventDefault();

                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    // Already in VOD mode - seek backward
                    const newTime = Math.max(0, dvrState.overlayVideo.currentTime - SEEK_STEP);
                    console.log('[DVR UI] Keyboard seek backward to', formatTime(newTime));
                    dvrState.overlayVideo.currentTime = newTime;
                } else {
                    // On live - switch to VOD at (totalDuration - 10s)
                    const seekTime = Math.max(0, dvrState.totalDuration - SEEK_STEP);
                    console.log('[DVR UI] Keyboard: Switching to VOD at', formatTime(seekTime));
                    switchToVod(seekTime);
                }
            } else if (e.key === 'ArrowRight') {
                e.preventDefault();

                if (dvrState.isVodMode && dvrState.overlayVideo) {
                    // In VOD mode - seek forward
                    const maxTime = dvrState.totalDuration || dvrState.overlayVideo.duration || Infinity;
                    const newTime = Math.min(maxTime, dvrState.overlayVideo.currentTime + SEEK_STEP);
                    console.log('[DVR UI] Keyboard seek forward to', formatTime(newTime));
                    dvrState.overlayVideo.currentTime = newTime;
                }
                // If on live and pressing right, do nothing (already at live)
            }
        });
    }

    bindKeyboardEvents();

    // Wait for page load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => setTimeout(initDvrBar, 2000));
    } else {
        setTimeout(initDvrBar, 2000);
    }

    console.log('[DVR UI] Script loaded');
})();
