// ==UserScript==
// @name         TwitchAdSolutions (vaft)
// @namespace    https://github.com/pixeltris/TwitchAdSolutions
// @version      33.0.0
// @description  Multiple solutions for blocking Twitch ads (vaft)
// @updateURL    https://github.com/pixeltris/TwitchAdSolutions/raw/master/vaft/vaft.user.js
// @downloadURL  https://github.com/pixeltris/TwitchAdSolutions/raw/master/vaft/vaft.user.js
// @author       https://github.com/cleanlock/VideoAdBlockForTwitch#credits
// @match        *://*.twitch.tv/*
// @run-at       document-start
// @inject-into  page
// @grant        none
// ==/UserScript==
(function () {
    'use strict';
    const ourTwitchAdSolutionsVersion = 9999;// Used to prevent conflicts with outdated versions of the scripts
    if (typeof window.twitchAdSolutionsVersion !== 'undefined' && window.twitchAdSolutionsVersion >= ourTwitchAdSolutionsVersion) {
        console.log("skipping vaft as there's another script active. ourVersion:" + ourTwitchAdSolutionsVersion + " activeVersion:" + window.twitchAdSolutionsVersion);
        window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
        return;
    }
    window.twitchAdSolutionsVersion = ourTwitchAdSolutionsVersion;
    function declareOptions(scope) {
        scope.AdSignifier = 'stitched';
        scope.ClientID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
        scope.BackupPlayerTypes = [
            'embed',//Source
            'popout',//Source  
            'autoplay',//360p - last resort if embed/popout fail
        ];
        scope.FallbackPlayerType = 'embed';
        scope.ForceAccessTokenPlayerType = 'popout';
        scope.SkipPlayerReloadOnHevc = false;// If true this will skip player reload on streams which have 2k/4k quality (if you enable this and you use the 2k/4k quality setting you'll get error #4000 / #3000 / spinning wheel on chrome based browsers)
        scope.AlwaysReloadPlayerOnAd = false;// Always pause/play when entering/leaving ads
        scope.ReloadPlayerAfterAd = false;// FALSE = use pause/play instead of reload (less disruptive)
        scope.PlayerReloadMinimalRequestsTime = 1500;
        scope.PlayerReloadMinimalRequestsPlayerIndex = 2;//autoplay
        scope.HasTriggeredPlayerReload = false;
        scope.StreamInfos = [];
        scope.StreamInfosByUrl = [];
        scope.GQLDeviceID = null;
        scope.ClientVersion = null;
        scope.ClientSession = null;
        scope.ClientIntegrityHeader = null;
        scope.AuthorizationHeader = undefined;
        scope.SimulatedAdsDepth = 0;
        scope.PlayerBufferingFix = false;// DISABLED - was causing pause/play loops on slow connections
        scope.PlayerBufferingDelay = 500;// How often should we check the player state (in milliseconds)
        scope.PlayerBufferingSameStateCount = 3;// How many times of seeing the same player state until we trigger pause/play (it will only trigger it one time until the player state changes again)
        scope.PlayerBufferingDangerZone = 1;// The buffering time left (in seconds) when we should ignore the players playback position in the player state check
        scope.PlayerBufferingDoPlayerReload = false;// If true this will do a player reload instead of pause/play (player reloading is better at fixing the playback issues but it takes slightly longer)
        scope.PlayerBufferingMinRepeatDelay = 5000;// Minimum delay (in milliseconds) between each pause/play (this is to avoid over pressing pause/play when there are genuine buffering problems)
        scope.V2API = false;
        scope.IsAdStrippingEnabled = true;
        scope.AdBlockEnabled = true;
        scope.VodUnlockEnabled = true;
        scope.AdSegmentCache = new Map();
        scope.AllSegmentsAreAdSegments = false;
    }
    let isActivelyStrippingAds = false;
    let localStorageHookFailed = false;
    const twitchWorkers = [];
    const workerStringConflicts = [
        'twitch',
        'isVariantA'// TwitchNoSub
    ];
    const workerStringAllow = [];
    const workerStringReinsert = [
        'isVariantA',// TwitchNoSub (prior to (0.9))
        'besuper/',// TwitchNoSub (0.9)
        '${patch_url}'// TwitchNoSub (0.9.1)
    ];
    function getCleanWorker(worker) {
        let root = null;
        let parent = null;
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringConflicts.some((x) => workerString.includes(x)) && !workerStringAllow.some((x) => workerString.includes(x))) {
                if (parent !== null) {
                    Object.setPrototypeOf(parent, Object.getPrototypeOf(proto));
                }
            } else {
                if (root === null) {
                    root = proto;
                }
                parent = proto;
            }
            proto = Object.getPrototypeOf(proto);
        }
        return root;
    }
    function getWorkersForReinsert(worker) {
        const result = [];
        let proto = worker;
        while (proto) {
            const workerString = proto.toString();
            if (workerStringReinsert.some((x) => workerString.includes(x))) {
                result.push(proto);
            } else {
            }
            proto = Object.getPrototypeOf(proto);
        }
        return result;
    }
    function reinsertWorkers(worker, reinsert) {
        let parent = worker;
        for (let i = 0; i < reinsert.length; i++) {
            Object.setPrototypeOf(reinsert[i], parent);
            parent = reinsert[i];
        }
        return parent;
    }
    function isValidWorker(worker) {
        const workerString = worker.toString();
        return !workerStringConflicts.some((x) => workerString.includes(x))
            || workerStringAllow.some((x) => workerString.includes(x))
            || workerStringReinsert.some((x) => workerString.includes(x));
    }
    function hookWindowWorker() {
        const reinsert = getWorkersForReinsert(window.Worker);
        const newWorker = class Worker extends getCleanWorker(window.Worker) {
            constructor(twitchBlobUrl, options) {
                let isTwitchWorker = false;
                try {
                    isTwitchWorker = new URL(twitchBlobUrl).origin.endsWith('.twitch.tv');
                } catch { }
                if (!isTwitchWorker) {
                    super(twitchBlobUrl, options);
                    return;
                }
                const newBlobStr = `
                    const pendingFetchRequests = new Map();
                    const defaultResolutions = {
                        "chunked": { name: "1080p60", resolution: "1920x1080", frameRate: 60 },
                        "1080p60": { name: "1080p60", resolution: "1920x1080", frameRate: 60 },
                        "1080p30": { name: "1080p30", resolution: "1920x1080", frameRate: 30 },
                        "720p60": { name: "720p60", resolution: "1280x720", frameRate: 60 },
                        "720p30": { name: "720p30", resolution: "1280x720", frameRate: 30 },
                        "480p30": { name: "480p30", resolution: "854x480", frameRate: 30 },
                        "360p30": { name: "360p30", resolution: "640x360", frameRate: 30 },
                        "160p30": { name: "160p", resolution: "284x160", frameRate: 30 }
                    };
                    function createServingID() {
                        const chars = "0123456789abcdefghijklmnopqrstuvwxyz";
                        let id = "";
                        for (let i = 0; i < 32; i++) id += chars[Math.floor(Math.random() * chars.length)];
                        return id;
                    }
                    async function fetchVodGQL(vodID) {
                        const resp = await fetch("https://gql.twitch.tv/gql", {
                            method: 'POST',
                            body: JSON.stringify({ query: 'query { video(id: "' + vodID + '") { broadcastType, createdAt, seekPreviewsURL, owner { login } }}' }),
                            headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Accept': 'application/json', 'Content-Type': 'application/json' }
                        });
                        return resp.json();
                    }
                    async function isValidQuality(url) {
                        try {
                            const response = await fetch(url, { cache: "force-cache" });
                            if (response.ok) {
                                const data = await response.text();
                                if (data.includes(".ts")) {
                                    return { codec: "avc1.4D001E" };
                                }
                                if (data.includes(".mp4")) {
                                    try {
                                        const mp4Req = await fetch(url.replace("index-dvr.m3u8", "init-0.mp4"), { cache: "force-cache" });
                                        if (mp4Req.ok) {
                                            const buffer = await mp4Req.arrayBuffer();
                                            const bytes = new Uint8Array(buffer);
                                            const isHevc = findInBytes(bytes, [0x68, 0x65, 0x76, 0x31]) || findInBytes(bytes, [0x68, 0x76, 0x63, 0x31]);
                                            const codec = isHevc ? "hev1.1.6.L93.B0" : "avc1.4D001E";
                                            // Try to detect resolution from tkhd box
                                            const detectedRes = parseTkhdResolution(bytes);
                                            return { codec: codec, detectedResolution: detectedRes };
                                        }
                                    } catch(e) {}
                                    return { codec: "hev1.1.6.L93.B0" };
                                }
                            }
                        } catch(e) {}
                        return null;
                    }
                    function findInBytes(bytes, pattern) {
                        for (let i = 0; i <= bytes.length - pattern.length; i++) {
                            let found = true;
                            for (let j = 0; j < pattern.length; j++) {
                                if (bytes[i + j] !== pattern[j]) { found = false; break; }
                            }
                            if (found) return true;
                        }
                        return false;
                    }
                    function parseTkhdResolution(bytes) {
                        // Search for 'tkhd' box and extract width/height (fixed-point 16.16 at offset +76/+80 for v0, +84/+88 for v1)
                        for (let i = 0; i < bytes.length - 8; i++) {
                            if (bytes[i] === 0x74 && bytes[i+1] === 0x6B && bytes[i+2] === 0x68 && bytes[i+3] === 0x64) {
                                // Found 'tkhd', version is at i+4
                                const version = bytes[i + 4];
                                const widthOffset = version === 1 ? i + 88 : i + 80;
                                const heightOffset = version === 1 ? i + 92 : i + 84;
                                if (heightOffset + 4 <= bytes.length) {
                                    const width = (bytes[widthOffset] << 8) | bytes[widthOffset + 1];
                                    const height = (bytes[heightOffset] << 8) | bytes[heightOffset + 1];
                                    if (width > 0 && height > 0) {
                                        console.log('[VOD Unlock] Detected resolution from init segment:', width + 'x' + height);
                                        return { width: width, height: height };
                                    }
                                }
                            }
                        }
                        return null;
                    }

                    // Try to bypass sub-only VOD directly by constructing a master playlist (V2)
                    async function buildVodM3U8(vodId, isUsherV2) {
                        console.log('[VOD Unlock] Building playlist for', vodId, isUsherV2 ? '(usher v2)' : '(usher v1)');
                        const data = await fetchVodGQL(vodId);
                        if (!data || !data.data || !data.data.video) {
                            console.log('[VOD Unlock] No video data');
                            return null;
                        }
                        const vodData = data.data.video;
                        if (!vodData.seekPreviewsURL) {
                            console.log('[VOD Unlock] No seekPreviewsURL');
                            return null;
                        }
                        const channelData = vodData.owner;
                        const currentURL = new URL(vodData.seekPreviewsURL);
                        const domain = currentURL.host;
                        const paths = currentURL.pathname.split("/");
                        const sbIdx = paths.findIndex(function(p) { return p.includes("storyboards"); });
                        if (sbIdx < 1) {
                            console.log('[VOD Unlock] Invalid storyboard path');
                            return null;
                        }
                        const vodSpecialID = paths[sbIdx - 1];
                        const broadcastType = vodData.broadcastType.toLowerCase();
                        let fakePlaylist = "#EXTM3U\\n#EXT-X-TWITCH-INFO:ORIGIN=\\"s3\\",B=\\"false\\",REGION=\\"EU\\",USER-IP=\\"127.0.0.1\\",SERVING-ID=\\"" + createServingID() + "\\",CLUSTER=\\"cloudfront_vod\\",MANIFEST-CLUSTER=\\"cloudfront_vod\\"";
                        let startQuality = 8534030;
                        let found = 0;
                        const resKeys = Object.keys(defaultResolutions);
                        for (let i = 0; i < resKeys.length; i++) {
                            const resKey = resKeys[i];
                            const resValue = defaultResolutions[resKey];
                            let playlistUrl;
                            if (broadcastType === "highlight") {
                                playlistUrl = "https://" + domain + "/" + vodSpecialID + "/" + resKey + "/highlight-" + vodId + ".m3u8";
                            } else {
                                playlistUrl = "https://" + domain + "/" + vodSpecialID + "/" + resKey + "/index-dvr.m3u8";
                            }
                            const result = await isValidQuality(playlistUrl);
                            if (result) {
                                // For chunked, use the actual detected resolution if available
                                let actualResolution = resValue.resolution;
                                let actualName = resValue.name;
                                let actualFrameRate = resValue.frameRate;
                                if (resKey === "chunked" && result.detectedResolution) {
                                    const w = result.detectedResolution.width;
                                    const h = result.detectedResolution.height;
                                    actualResolution = w + "x" + h;
                                    if (h >= 2160) { actualName = "2160p60"; }
                                    else if (h >= 1440) { actualName = "1440p60"; }
                                    else if (h >= 1080) { actualName = "1080p60"; }
                                    else { actualName = h + "p" + actualFrameRate; }
                                }
                                console.log('[VOD Unlock] Found quality:', resKey, actualResolution, actualName);
                                found++;
                                const variantSource = resKey === "chunked" ? "source" : "transcode";
                                if (isUsherV2) {
                                    fakePlaylist += "\\n#EXT-X-STREAM-INF:BANDWIDTH=" + startQuality + ",CODECS=\\"" + result.codec + ",mp4a.40.2\\",RESOLUTION=" + actualResolution + ",FRAME-RATE=" + actualFrameRate + ",STABLE-VARIANT-ID=\\"" + resKey + "\\",IVS-NAME=\\"" + actualName + "\\",IVS-VARIANT-SOURCE=\\"" + variantSource + "\\"\\n" + playlistUrl;
                                } else {
                                    fakePlaylist += "\\n#EXT-X-STREAM-INF:BANDWIDTH=" + startQuality + ",CODECS=\\"" + result.codec + ",mp4a.40.2\\",RESOLUTION=" + actualResolution + ",VIDEO=\\"" + actualName + "\\",FRAME-RATE=" + actualFrameRate + "\\n" + playlistUrl;
                                }
                                startQuality -= 100;
                            }
                        }
                        if (found === 0) {
                            console.log('[VOD Unlock] No valid qualities found');
                            return null;
                        }
                        console.log('[VOD Unlock] Unlocked with', found, 'qualities');
                        return fakePlaylist;
                    }
                    
                    // DVR Feature - Get current live VOD info for a channel
                    const LiveDvrState = new Map(); // channelName -> { vodSpecialID, domain, lastCheck, quality }
                    
                    async function fetchLiveVodInfo(channelLogin) {
                        try {
                            const resp = await fetch("https://gql.twitch.tv/gql", {
                                method: 'POST',
                                body: JSON.stringify({
                                    query: 'query { user(login: "' + channelLogin + '") { videos(first: 1, type: ARCHIVE, sort: TIME) { edges { node { id, createdAt, seekPreviewsURL, broadcastType } } } } }'
                                }),
                                headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', 'Accept': 'application/json', 'Content-Type': 'application/json' }
                            });
                            const data = await resp.json();
                            if (data?.data?.user?.videos?.edges?.length > 0) {
                                const vodData = data.data.user.videos.edges[0].node;
                                if (vodData.seekPreviewsURL) {
                                    const currentURL = new URL(vodData.seekPreviewsURL);
                                    const domain = currentURL.host;
                                    const paths = currentURL.pathname.split("/");
                                    const sbIdx = paths.findIndex(function(p) { return p.includes("storyboards"); });
                                    if (sbIdx > 0) {
                                        const vodSpecialID = paths[sbIdx - 1];
                                        console.log('[DVR] Found live VOD for', channelLogin, '- vodSpecialID:', vodSpecialID);
                                        return { vodId: vodData.id, vodSpecialID, domain, createdAt: vodData.createdAt };
                                    }
                                }
                            }
                        } catch(e) {
                            console.log('[DVR] Error fetching live VOD info:', e);
                        }
                        return null;
                    }
                    
                    async function getDvrPlaylistUrl(channelName, quality) {
                        const now = Date.now();
                        let cached = LiveDvrState.get(channelName);
                        
                        // Check every 60 seconds for VOD info update
                        if (!cached || now - cached.lastCheck > 60000) {
                            console.log('[DVR] Fetching VOD info for', channelName);
                            const vodInfo = await fetchLiveVodInfo(channelName);
                            if (vodInfo) {
                                const qualityKey = quality || 'chunked';
                                const dvrPlaylistUrl = 'https://' + vodInfo.domain + '/' + vodInfo.vodSpecialID + '/' + qualityKey + '/index-dvr.m3u8';
                                cached = { ...vodInfo, dvrPlaylistUrl, quality: qualityKey, lastCheck: now };
                                LiveDvrState.set(channelName, cached);
                            } else {
                                cached = { dvrPlaylistUrl: null, lastCheck: now };
                                LiveDvrState.set(channelName, cached);
                            }
                        }
                        
                        return cached?.dvrPlaylistUrl || null;
                    }
                    
                    async function fetchDvrPlaylist(channelName, quality) {
                        const dvrUrl = await getDvrPlaylistUrl(channelName, quality);
                        if (!dvrUrl) return null;
                        
                        try {
                            const resp = await fetch(dvrUrl, { cache: 'no-cache' });
                            if (resp.ok) {
                                const playlist = await resp.text();
                                if (playlist.includes('.ts') || playlist.includes('.mp4')) {
                                    console.log('[DVR] Got DVR playlist from', dvrUrl);
                                    return { playlist, baseUrl: dvrUrl.substring(0, dvrUrl.lastIndexOf('/') + 1) };
                                }
                            }
                        } catch(e) {
                            console.log('[DVR] Error fetching DVR playlist:', e);
                        }
                        return null;
                    }
                    
                    function mergeDvrWithLive(dvrData, livePlaylist) {
                        if (!dvrData || !dvrData.playlist) return livePlaylist;
                        
                        const dvrLines = dvrData.playlist.split('\\n');
                        const liveLines = livePlaylist.split('\\n');
                        
                        // Get DVR segments with full URLs
                        const dvrSegments = [];
                        for (let i = 0; i < dvrLines.length; i++) {
                            if (dvrLines[i].startsWith('#EXTINF')) {
                                let segUrl = dvrLines[i + 1]?.trim();
                                if (segUrl && !segUrl.startsWith('#')) {
                                    if (!segUrl.startsWith('http')) {
                                        segUrl = dvrData.baseUrl + segUrl;
                                    }
                                    dvrSegments.push(dvrLines[i]);
                                    dvrSegments.push(segUrl);
                                    i++;
                                }
                            }
                        }
                        
                        // Get live segments
                        const liveSegments = [];
                        const liveHeaders = [];
                        let inSegments = false;
                        for (let i = 0; i < liveLines.length; i++) {
                            if (liveLines[i].startsWith('#EXTINF')) {
                                inSegments = true;
                            }
                            if (inSegments) {
                                liveSegments.push(liveLines[i]);
                            } else {
                                liveHeaders.push(liveLines[i]);
                            }
                        }
                        
                        // Build merged playlist - DVR segments first, then unique live segments
                        const dvrUrls = new Set(dvrSegments.filter(l => l.startsWith('http')));
                        const uniqueLiveSegments = [];
                        for (let i = 0; i < liveSegments.length; i++) {
                            const line = liveSegments[i];
                            if (line.startsWith('http') && dvrUrls.has(line)) {
                                continue; // Skip duplicate
                            }
                            uniqueLiveSegments.push(line);
                        }
                        
                        // Use live headers + DVR segments + unique live segments
                        let merged = liveHeaders.join('\\n');
                        if (!merged.includes('#EXT-X-PLAYLIST-TYPE')) {
                            merged = merged.replace('#EXTM3U', '#EXTM3U\\n#EXT-X-PLAYLIST-TYPE:EVENT');
                        }
                        merged += '\\n' + dvrSegments.join('\\n');
                        if (uniqueLiveSegments.length > 0) {
                            merged += '\\n' + uniqueLiveSegments.join('\\n');
                        }
                        
                        console.log('[DVR] Merged:', dvrSegments.length / 2, 'DVR segments +', uniqueLiveSegments.length / 2, 'live segments');
                        return merged;
                    }
                    
                    ${stripAdSegments.toString()}
                    ${getStreamUrlForResolution.toString()}
                    ${processM3U8.toString()}
                    ${hookWorkerFetch.toString()}
                    ${declareOptions.toString()}
                    ${getAccessToken.toString()}
                    ${gqlRequest.toString()}
                    ${parseAttributes.toString()}
                    ${getWasmWorkerJs.toString()}
                    ${getServerTimeFromM3u8.toString()}
                    ${replaceServerTimeInM3u8.toString()}
                    const workerString = getWasmWorkerJs('${twitchBlobUrl.replaceAll("'", "%27")}');
                    declareOptions(self);
                    GQLDeviceID = ${GQLDeviceID ? "'" + GQLDeviceID + "'" : null};
                    AuthorizationHeader = ${AuthorizationHeader ? "'" + AuthorizationHeader + "'" : undefined};
                    ClientIntegrityHeader = ${ClientIntegrityHeader ? "'" + ClientIntegrityHeader + "'" : null};
                    ClientVersion = ${ClientVersion ? "'" + ClientVersion + "'" : null};
                    ClientSession = ${ClientSession ? "'" + ClientSession + "'" : null};
                    self.addEventListener('message', function(e) {
                        if (e.data.key == 'UpdateClientVersion') {
                            ClientVersion = e.data.value;
                        } else if (e.data.key == 'UpdateClientSession') {
                            ClientSession = e.data.value;
                        } else if (e.data.key == 'UpdateClientId') {
                            ClientID = e.data.value;
                        } else if (e.data.key == 'UpdateDeviceId') {
                            GQLDeviceID = e.data.value;
                        } else if (e.data.key == 'UpdateClientIntegrityHeader') {
                            ClientIntegrityHeader = e.data.value;
                        } else if (e.data.key == 'UpdateAuthorizationHeader') {
                            AuthorizationHeader = e.data.value;
                        } else if (e.data.key == 'FetchResponse') {
                            const responseData = e.data.value;
                            if (pendingFetchRequests.has(responseData.id)) {
                                const { resolve, reject } = pendingFetchRequests.get(responseData.id);
                                pendingFetchRequests.delete(responseData.id);
                                if (responseData.error) {
                                    reject(new Error(responseData.error));
                                } else {
                                    // Create a Response object from the response data
                                    const response = new Response(responseData.body, {
                                        status: responseData.status,
                                        statusText: responseData.statusText,
                                        headers: responseData.headers
                                    });
                                    resolve(response);
                                }
                            }
                        } else if (e.data.key == 'TriggeredPlayerReload') {
                            HasTriggeredPlayerReload = true;
                        } else if (e.data.key == 'SimulateAds') {
                            SimulatedAdsDepth = e.data.value;
                            console.log('SimulatedAdsDepth: ' + SimulatedAdsDepth);
                        } else if (e.data.key == 'AllSegmentsAreAdSegments') {
                            AllSegmentsAreAdSegments = !AllSegmentsAreAdSegments;
                            console.log('AllSegmentsAreAdSegments: ' + AllSegmentsAreAdSegments);
                        } else if (e.data.key == 'UpdateSettings') {
                            const settings = e.data.value;
                            if (typeof settings.adBlockEnabled !== 'undefined') AdBlockEnabled = settings.adBlockEnabled;
                            if (typeof settings.vodUnlockEnabled !== 'undefined') VodUnlockEnabled = settings.vodUnlockEnabled;
                            console.log('[Worker] Settings updated:', { AdBlockEnabled, VodUnlockEnabled });
                        }
                    });
                    hookWorkerFetch();
                    eval(workerString);
                `;
                super(URL.createObjectURL(new Blob([newBlobStr])), options);
                twitchWorkers.push(this);
                this.addEventListener('message', (e) => {
                    if (e.data.key == 'UpdateAdBlockBanner') {
                        updateAdblockBanner(e.data);
                    } else if (e.data.key == 'PauseResumePlayer') {
                        doTwitchPlayerTask(true, false);
                    } else if (e.data.key == 'ReloadPlayer') {
                        doTwitchPlayerTask(false, true);
                    } else if (e.data.key == 'VodUnlocked') {
                        window.postMessage({ type: 'TWITCH_ADBLOCK_VOD_UNLOCKED' }, '*');
                    } else if (e.data.key == 'AdBlocked') {
                        window.postMessage({ type: 'TWITCH_ADBLOCK_AD_BLOCKED' }, '*');
                    }
                });
                this.addEventListener('message', async event => {
                    if (event.data.key == 'FetchRequest') {
                        const fetchRequest = event.data.value;
                        const responseData = await handleWorkerFetchRequest(fetchRequest);
                        this.postMessage({
                            key: 'FetchResponse',
                            value: responseData
                        });
                    }
                });
            }
        };
        let workerInstance = reinsertWorkers(newWorker, reinsert);
        Object.defineProperty(window, 'Worker', {
            get: function () {
                return workerInstance;
            },
            set: function (value) {
                if (isValidWorker(value)) {
                    workerInstance = value;
                } else {
                    console.log('Attempt to set twitch worker denied');
                }
            }
        });
    }
    function getWasmWorkerJs(twitchBlobUrl) {
        const req = new XMLHttpRequest();
        req.open('GET', twitchBlobUrl, false);
        req.overrideMimeType("text/javascript");
        req.send();
        return req.responseText;
    }
    function hookWorkerFetch() {
        console.log('hookWorkerFetch (vaft)');
        const realFetch = fetch;
        fetch = async function (url, options) {
            if (typeof url === 'string') {
                if (AdSegmentCache.has(url)) {
                    return new Promise(function (resolve, reject) {
                        const send = function () {
                            return realFetch('data:video/mp4;base64,AAAAKGZ0eXBtcDQyAAAAAWlzb21tcDQyZGFzaGF2YzFpc282aGxzZgAABEltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAYagAAAAAAABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAADAAABqHRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAURtZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAALuAAAAAAFXEAAAAAAAtaGRscgAAAAAAAAAAc291bgAAAAAAAAAAAAAAAFNvdW5kSGFuZGxlcgAAAADvbWluZgAAABBzbWhkAAAAAAAAAAAAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAACzc3RibAAAAGdzdHNkAAAAAAAAAAEAAABXbXA0YQAAAAAAAAABAAAAAAAAAAAAAgAQAAAAALuAAAAAAAAzZXNkcwAAAAADgICAIgABAASAgIAUQBUAAAAAAAAAAAAAAAWAgIACEZAGgICAAQIAAAAQc3R0cwAAAAAAAAAAAAAAEHN0c2MAAAAAAAAAAAAAABRzdHN6AAAAAAAAAAAAAAAAAAAAEHN0Y28AAAAAAAAAAAAAAeV0cmFrAAAAXHRraGQAAAADAAAAAAAAAAAAAAACAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAABAAAAAAAAAAAAAAAAAABAAAAAAoAAAAFoAAAAAAGBbWRpYQAAACBtZGhkAAAAAAAAAAAAAAAAAA9CQAAAAABVxAAAAAAALWhkbHIAAAAAAAAAAHZpZGUAAAAAAAAAAAAAAABWaWRlb0hhbmRsZXIAAAABLG1pbmYAAAAUdm1oZAAAAAEAAAAAAAAAAAAAACRkaW5mAAAAHGRyZWYAAAAAAAAAAQAAAAx1cmwgAAAAAQAAAOxzdGJsAAAAoHN0c2QAAAAAAAAAAQAAAJBhdmMxAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAoABaABIAAAASAAAAAAAAAABAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAGP//AAAAOmF2Y0MBTUAe/+EAI2dNQB6WUoFAX/LgLUBAQFAAAD6AAA6mDgAAHoQAA9CW7y4KAQAEaOuPIAAAABBzdHRzAAAAAAAAAAAAAAAQc3RzYwAAAAAAAAAAAAAAFHN0c3oAAAAAAAAAAAAAAAAAAAAQc3RjbwAAAAAAAAAAAAAASG12ZXgAAAAgdHJleAAAAAAAAAABAAAAAQAAAC4AAAAAAoAAAAAAACB0cmV4AAAAAAAAAAIAAAABAACCNQAAAAACQAAA', options).then(function (response) {
                                resolve(response);
                            })['catch'](function (err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                }
                url = url.trimEnd();

                // Strip sig and token from VOD requests to prevent the Twitch Web Player 
                // from self-sabotaging the clean Master Playlist with restricted tokens.
                if (VodUnlockEnabled && url.includes('cloudfront.net') && (url.includes('.m3u8') || url.includes('.ts') || url.includes('.mp4'))) {
                    if (url.includes('sig=') || url.includes('token=')) {
                        try {
                            const tempUrl = new URL(url);
                            tempUrl.searchParams.delete('sig');
                            tempUrl.searchParams.delete('token');
                            url = tempUrl.toString();
                        } catch (e) {}
                    }
                }

                // VOD Sub-Only Unlock
                if (VodUnlockEnabled && url.includes('usher.ttvnw.net/vod/')) {
                    return new Promise(function (resolve, reject) {
                        realFetch(url, options).then(async function (response) {
                            if (response.status !== 200) {
                                const isUsherV2 = url.includes('/vod/v2');
                                console.log('[VOD Unlock] Blocked (status ' + response.status + '), unlocking...', isUsherV2 ? '(usher v2)' : '(usher v1)');
                                const parts = url.split(".m3u8")[0].split("/");
                                const vodId = parts[parts.length - 1];
                                const playlist = await buildVodM3U8(vodId, isUsherV2);
                                if (playlist) {
                                    console.log('[VOD Unlock] SUCCESS');
                                    self.postMessage({ key: 'VodUnlocked' });
                                    resolve(new Response(playlist, {
                                        status: 200,
                                        headers: { 'Content-Type': 'application/vnd.apple.mpegurl' }
                                    }));
                                    return;
                                }
                            }
                            resolve(response);
                        }).catch(function (err) {
                            console.log('[VOD Unlock] Error:', err);
                            reject(err);
                        });
                    });
                }
                if (url.endsWith('m3u8')) {
                    return new Promise(function (resolve, reject) {
                        const processAfter = async function (response) {
                            if (response.status === 200) {
                                resolve(new Response(await processM3U8(url, await response.text(), realFetch)));
                            } else {
                                resolve(response);
                            }
                        };
                        const send = function () {
                            return realFetch(url, options).then(function (response) {
                                processAfter(response);
                            })['catch'](function (err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                } else if (url.includes('/channel/hls/') && !url.includes('picture-by-picture')) {
                    V2API = url.includes('/api/v2/');
                    const channelName = (new URL(url)).pathname.match(/([^\/]+)(?=\.\w+$)/)[0];
                    if (ForceAccessTokenPlayerType) {
                        // parent_domains is used to determine if the player is embeded and stripping it gets rid of fake ads
                        const tempUrl = new URL(url);
                        tempUrl.searchParams.delete('parent_domains');
                        url = tempUrl.toString();
                    }
                    return new Promise(function (resolve, reject) {
                        const processAfter = async function (response) {
                            if (response.status == 200) {
                                const encodingsM3u8 = await response.text();
                                const serverTime = getServerTimeFromM3u8(encodingsM3u8);
                                let streamInfo = StreamInfos[channelName];
                                if (streamInfo != null && streamInfo.EncodingsM3U8 != null && (await realFetch(streamInfo.EncodingsM3U8.match(/^https:.*\.m3u8$/m)[0])).status !== 200) {
                                    // The cached encodings are dead (the stream probably restarted)
                                    streamInfo = null;
                                }
                                if (streamInfo == null || streamInfo.EncodingsM3U8 == null) {
                                    StreamInfos[channelName] = streamInfo = {
                                        ChannelName: channelName,
                                        IsShowingAd: false,
                                        LastPlayerReload: 0,
                                        EncodingsM3U8: encodingsM3u8,
                                        ModifiedM3U8: null,
                                        IsUsingModifiedM3U8: false,
                                        UsherParams: (new URL(url)).search,
                                        RequestedAds: new Set(),
                                        Urls: [],// xxx.m3u8 -> { Resolution: "284x160", FrameRate: 30.0 }
                                        ResolutionList: [],
                                        BackupEncodingsM3U8Cache: [],
                                        ActiveBackupPlayerType: null,
                                        IsMidroll: false,
                                        IsStrippingAdSegments: false,
                                        NumStrippedAdSegments: 0
                                    };
                                    const lines = encodingsM3u8.replaceAll('\r', '').split('\n');
                                    for (let i = 0; i < lines.length - 1; i++) {
                                        if (lines[i].startsWith('#EXT-X-STREAM-INF') && lines[i + 1].includes('.m3u8')) {
                                            const attributes = parseAttributes(lines[i]);
                                            const resolution = attributes['RESOLUTION'];
                                            if (resolution) {
                                                const resolutionInfo = {
                                                    Resolution: resolution,
                                                    FrameRate: attributes['FRAME-RATE'],
                                                    Codecs: attributes['CODECS'],
                                                    Url: lines[i + 1]
                                                };
                                                streamInfo.Urls[lines[i + 1]] = resolutionInfo;
                                                streamInfo.ResolutionList.push(resolutionInfo);
                                            }
                                            StreamInfosByUrl[lines[i + 1]] = streamInfo;
                                        }
                                    }
                                    const nonHevcResolutionList = streamInfo.ResolutionList.filter((element) => element.Codecs.startsWith('avc') || element.Codecs.startsWith('av0'));
                                    if (AlwaysReloadPlayerOnAd || (nonHevcResolutionList.length > 0 && streamInfo.ResolutionList.some((element) => element.Codecs.startsWith('hev') || element.Codecs.startsWith('hvc')) && !SkipPlayerReloadOnHevc)) {
                                        if (nonHevcResolutionList.length > 0) {
                                            for (let i = 0; i < lines.length - 1; i++) {
                                                if (lines[i].startsWith('#EXT-X-STREAM-INF')) {
                                                    const resSettings = parseAttributes(lines[i].substring(lines[i].indexOf(':') + 1));
                                                    const codecsKey = 'CODECS';
                                                    if (resSettings[codecsKey].startsWith('hev') || resSettings[codecsKey].startsWith('hvc')) {
                                                        const oldResolution = resSettings['RESOLUTION'];
                                                        const [targetWidth, targetHeight] = oldResolution.split('x').map(Number);
                                                        const newResolutionInfo = nonHevcResolutionList.sort((a, b) => {
                                                            // TODO: Take into account 'Frame-Rate' when sorting (i.e. 1080p60 vs 1080p30)
                                                            const [streamWidthA, streamHeightA] = a.Resolution.split('x').map(Number);
                                                            const [streamWidthB, streamHeightB] = b.Resolution.split('x').map(Number);
                                                            return Math.abs((streamWidthA * streamHeightA) - (targetWidth * targetHeight)) - Math.abs((streamWidthB * streamHeightB) - (targetWidth * targetHeight));
                                                        })[0];
                                                        console.log('ModifiedM3U8 swap ' + resSettings[codecsKey] + ' to ' + newResolutionInfo.Codecs + ' oldRes:' + oldResolution + ' newRes:' + newResolutionInfo.Resolution);
                                                        lines[i] = lines[i].replace(/CODECS="[^"]+"/, `CODECS="${newResolutionInfo.Codecs}"`);
                                                        lines[i + 1] = newResolutionInfo.Url + ' '.repeat(i + 1);// The stream doesn't load unless each url line is unique
                                                    }
                                                }
                                            }
                                        }
                                        if (nonHevcResolutionList.length > 0 || AlwaysReloadPlayerOnAd) {
                                            streamInfo.ModifiedM3U8 = lines.join('\n');
                                        }
                                    }
                                }
                                streamInfo.LastPlayerReload = Date.now();
                                resolve(new Response(replaceServerTimeInM3u8(streamInfo.IsUsingModifiedM3U8 ? streamInfo.ModifiedM3U8 : streamInfo.EncodingsM3U8, serverTime)));
                            } else {
                                resolve(response);
                            }
                        };
                        const send = function () {
                            return realFetch(url, options).then(function (response) {
                                processAfter(response);
                            })['catch'](function (err) {
                                reject(err);
                            });
                        };
                        send();
                    });
                }
            }
            return realFetch.apply(this, arguments);
        };
    }
    function getServerTimeFromM3u8(encodingsM3u8) {
        if (V2API) {
            const matches = encodingsM3u8.match(/#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE="([^"]+)"/);
            return matches.length > 1 ? matches[1] : null;
        }
        const matches = encodingsM3u8.match('SERVER-TIME="([0-9.]+)"');
        return matches.length > 1 ? matches[1] : null;
    }
    function replaceServerTimeInM3u8(encodingsM3u8, newServerTime) {
        if (V2API) {
            return newServerTime ? encodingsM3u8.replace(/(#EXT-X-SESSION-DATA:DATA-ID="SERVER-TIME",VALUE=")[^"]+(")/, `$1${newServerTime}$2`) : encodingsM3u8;
        }
        return newServerTime ? encodingsM3u8.replace(new RegExp('(SERVER-TIME=")[0-9.]+"'), `SERVER-TIME="${newServerTime}"`) : encodingsM3u8;
    }

    function stripAdSegments(textStr, stripAllSegments, streamInfo) {
        if (!AdBlockEnabled) return textStr;
        let hasStrippedAdSegments = false;
        const lines = textStr.replaceAll('\r', '').split('\n');
        const newAdUrl = 'https://twitch.tv';
        for (let i = 0; i < lines.length; i++) {
            let line = lines[i];
            // Remove tracking urls which appear in the overlay UI
            line = line
                .replaceAll(/(X-TV-TWITCH-AD-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`)
                .replaceAll(/(X-TV-TWITCH-AD-CLICK-TRACKING-URL=")(?:[^"]*)(")/g, `$1${newAdUrl}$2`);
            if (i < lines.length - 1 && line.startsWith('#EXTINF') && (!line.includes(',live') || stripAllSegments || AllSegmentsAreAdSegments)) {
                const segmentUrl = lines[i + 1];
                if (!AdSegmentCache.has(segmentUrl)) {
                    streamInfo.NumStrippedAdSegments++;
                    // Check context: are we in a Web Worker or the Main Thread?
                    if (typeof window !== 'undefined' && window.postMessage) {
                        // Main Thread
                        window.postMessage({ type: 'TWITCH_ADBLOCK_AD_BLOCKED' }, '*');
                    } else if (typeof postMessage === 'function') {
                        // Web Worker
                        postMessage({ key: 'AdBlocked' });
                    }
                }
                AdSegmentCache.set(segmentUrl, Date.now());
                hasStrippedAdSegments = true;
            }
            if (line.includes(AdSignifier)) {
                hasStrippedAdSegments = true;
            }
        }
        if (hasStrippedAdSegments) {
            for (let i = 0; i < lines.length; i++) {
                // No low latency during ads (otherwise it's possible for the player to prefetch and display ad segments)
                if (lines[i].startsWith('#EXT-X-TWITCH-PREFETCH:')) {
                    lines[i] = '';
                }
            }
        } else {
            streamInfo.NumStrippedAdSegments = 0;
        }
        streamInfo.IsStrippingAdSegments = hasStrippedAdSegments;
        AdSegmentCache.forEach((value, key, map) => {
            if (value < Date.now() - 120000) {
                map.delete(key);
            }
        });
        return lines.join('\n');
    }
    function getStreamUrlForResolution(encodingsM3u8, resolutionInfo) {
        const encodingsLines = encodingsM3u8.replaceAll('\r', '').split('\n');
        const [targetWidth, targetHeight] = resolutionInfo.Resolution.split('x').map(Number);
        let matchedResolutionUrl = null;
        let matchedFrameRate = false;
        let closestResolutionUrl = null;
        let closestResolutionDifference = Infinity;
        for (let i = 0; i < encodingsLines.length - 1; i++) {
            if (encodingsLines[i].startsWith('#EXT-X-STREAM-INF') && encodingsLines[i + 1].includes('.m3u8')) {
                const attributes = parseAttributes(encodingsLines[i]);
                const resolution = attributes['RESOLUTION'];
                const frameRate = attributes['FRAME-RATE'];
                if (resolution) {
                    if (resolution == resolutionInfo.Resolution && (!matchedResolutionUrl || (!matchedFrameRate && frameRate == resolutionInfo.FrameRate))) {
                        matchedResolutionUrl = encodingsLines[i + 1];
                        matchedFrameRate = frameRate == resolutionInfo.FrameRate;
                        if (matchedFrameRate) {
                            return matchedResolutionUrl;
                        }
                    }
                    const [width, height] = resolution.split('x').map(Number);
                    const difference = Math.abs((width * height) - (targetWidth * targetHeight));
                    if (difference < closestResolutionDifference) {
                        closestResolutionUrl = encodingsLines[i + 1];
                        closestResolutionDifference = difference;
                    }
                }
            }
        }
        return closestResolutionUrl;
    }
    async function processM3U8(url, textStr, realFetch) {
        const streamInfo = StreamInfosByUrl[url];
        if (!streamInfo) {
            return textStr;
        }
        if (HasTriggeredPlayerReload) {
            HasTriggeredPlayerReload = false;
            streamInfo.LastPlayerReload = Date.now();
        }
        const haveAdTags = textStr.includes(AdSignifier) || SimulatedAdsDepth > 0;
        if (haveAdTags) {
            streamInfo.IsMidroll = textStr.includes('"MIDROLL"') || textStr.includes('"midroll"');
            if (!streamInfo.IsShowingAd) {
                streamInfo.IsShowingAd = true;
                postMessage({
                    key: 'UpdateAdBlockBanner',
                    isMidroll: streamInfo.IsMidroll,
                    hasAds: streamInfo.IsShowingAd,
                    isStrippingAdSegments: false
                });
            }
            if (!streamInfo.IsMidroll) {
                const lines = textStr.replaceAll('\r', '').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    const line = lines[i];
                    if (line.startsWith('#EXTINF') && lines.length > i + 1) {
                        if (!line.includes(',live') && !streamInfo.RequestedAds.has(lines[i + 1])) {
                            // Only request one .ts file per .m3u8 request to avoid making too many requests
                            //console.log('Fetch ad .ts file');
                            streamInfo.RequestedAds.add(lines[i + 1]);
                            fetch(lines[i + 1]).then((response) => { response.blob() });
                            break;
                        }
                    }
                }
            }
            const currentResolution = streamInfo.Urls[url];
            if (!currentResolution) {
                console.log('Ads will leak due to missing resolution info for ' + url);
                return textStr;
            }
            const isHevc = currentResolution.Codecs.startsWith('hev') || currentResolution.Codecs.startsWith('hvc');
            if (((isHevc && !SkipPlayerReloadOnHevc) || AlwaysReloadPlayerOnAd) && streamInfo.ModifiedM3U8 && !streamInfo.IsUsingModifiedM3U8) {
                streamInfo.IsUsingModifiedM3U8 = true;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            }
            let backupPlayerType = null;
            let backupM3u8 = null;
            let fallbackM3u8 = null;
            let startIndex = 0;
            let isDoingMinimalRequests = false;
            if (streamInfo.LastPlayerReload > Date.now() - PlayerReloadMinimalRequestsTime) {
                // When doing player reload there are a lot of requests which causes the backup stream to load in slow. Briefly prefer using a single version to prevent long delays
                startIndex = PlayerReloadMinimalRequestsPlayerIndex;
                isDoingMinimalRequests = true;
            }
            for (let playerTypeIndex = startIndex; !backupM3u8 && playerTypeIndex < BackupPlayerTypes.length; playerTypeIndex++) {
                const playerType = BackupPlayerTypes[playerTypeIndex];
                const realPlayerType = playerType.replace('-CACHED', '');
                const isFullyCachedPlayerType = playerType != realPlayerType;
                for (let i = 0; i < 2; i++) {
                    // This caches the m3u8 if it doesn't have ads. If the already existing cache has ads it fetches a new version (second loop)
                    let isFreshM3u8 = false;
                    let encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType];
                    if (!encodingsM3u8) {
                        isFreshM3u8 = true;
                        try {
                            const accessTokenResponse = await getAccessToken(streamInfo.ChannelName, realPlayerType);
                            if (accessTokenResponse.status === 200) {
                                const accessToken = await accessTokenResponse.json();
                                const urlInfo = new URL('https://usher.ttvnw.net/api/' + (V2API ? 'v2/' : '') + 'channel/hls/' + streamInfo.ChannelName + '.m3u8' + streamInfo.UsherParams);
                                urlInfo.searchParams.set('sig', accessToken.data.streamPlaybackAccessToken.signature);
                                urlInfo.searchParams.set('token', accessToken.data.streamPlaybackAccessToken.value);
                                const encodingsM3u8Response = await realFetch(urlInfo.href);
                                if (encodingsM3u8Response.status === 200) {
                                    encodingsM3u8 = streamInfo.BackupEncodingsM3U8Cache[playerType] = await encodingsM3u8Response.text();
                                }
                            }
                        } catch (err) { }
                    }
                    if (encodingsM3u8) {
                        try {
                            const streamM3u8Url = getStreamUrlForResolution(encodingsM3u8, currentResolution);
                            const streamM3u8Response = await realFetch(streamM3u8Url);
                            if (streamM3u8Response.status == 200) {
                                const m3u8Text = await streamM3u8Response.text();
                                if (m3u8Text) {
                                    if (playerType == FallbackPlayerType) {
                                        fallbackM3u8 = m3u8Text;
                                    }
                                    if ((!m3u8Text.includes(AdSignifier) && (SimulatedAdsDepth == 0 || playerTypeIndex >= SimulatedAdsDepth - 1)) || (!fallbackM3u8 && playerTypeIndex >= BackupPlayerTypes.length - 1)) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                    if (isFullyCachedPlayerType) {
                                        break;
                                    }
                                    if (isDoingMinimalRequests) {
                                        backupPlayerType = playerType;
                                        backupM3u8 = m3u8Text;
                                        break;
                                    }
                                }
                            }
                        } catch (err) { }
                    }
                    streamInfo.BackupEncodingsM3U8Cache[playerType] = null;
                    if (isFreshM3u8) {
                        break;
                    }
                }
            }
            if (!backupM3u8 && fallbackM3u8) {
                backupPlayerType = FallbackPlayerType;
                backupM3u8 = fallbackM3u8;
            }
            if (backupM3u8) {
                textStr = backupM3u8;
                if (streamInfo.ActiveBackupPlayerType != backupPlayerType) {
                    streamInfo.ActiveBackupPlayerType = backupPlayerType;
                    console.log(`Blocking${(streamInfo.IsMidroll ? ' midroll ' : ' ')}ads (${backupPlayerType})`);
                }
            }
            // TODO: Improve hevc stripping. It should always strip when there is a codec mismatch (both ways)
            const stripHevc = isHevc && streamInfo.ModifiedM3U8;
            if (IsAdStrippingEnabled || stripHevc) {
                textStr = stripAdSegments(textStr, stripHevc, streamInfo);
            }
        } else if (streamInfo.IsShowingAd) {
            console.log('Finished blocking ads');
            streamInfo.IsShowingAd = false;
            streamInfo.IsStrippingAdSegments = false;
            streamInfo.NumStrippedAdSegments = 0;
            streamInfo.ActiveBackupPlayerType = null;
            if (streamInfo.IsUsingModifiedM3U8 || ReloadPlayerAfterAd) {
                streamInfo.IsUsingModifiedM3U8 = false;
                streamInfo.LastPlayerReload = Date.now();
                postMessage({
                    key: 'ReloadPlayer'
                });
            } else {
                postMessage({
                    key: 'PauseResumePlayer'
                });
            }
        }
        postMessage({
            key: 'UpdateAdBlockBanner',
            isMidroll: streamInfo.IsMidroll,
            hasAds: streamInfo.IsShowingAd,
            isStrippingAdSegments: streamInfo.IsStrippingAdSegments,
            numStrippedAdSegments: streamInfo.NumStrippedAdSegments
        });

        // DVR Feature previously attempted to merge VOD and Live playlists here, 
        // but merging 1000+ segments caused player stalls. Disabled/Removed for stability.

        return textStr;
    }
    function parseAttributes(str) {
        return Object.fromEntries(
            str.split(/(?:^|,)((?:[^=]*)=(?:"[^"]*"|[^,]*))/)
                .filter(Boolean)
                .map(x => {
                    const idx = x.indexOf('=');
                    const key = x.substring(0, idx);
                    const value = x.substring(idx + 1);
                    const num = Number(value);
                    return [key, Number.isNaN(num) ? value.startsWith('"') ? JSON.parse(value) : value : num];
                }));
    }
    function getAccessToken(channelName, playerType) {
        const body = {
            operationName: 'PlaybackAccessToken',
            variables: {
                isLive: true,
                login: channelName,
                isVod: false,
                vodID: "",
                playerType: playerType,
                platform: playerType == 'autoplay' ? 'android' : 'web'
            },
            extensions: {
                persistedQuery: {
                    version: 1,
                    sha256Hash: "ed230aa1e33e07eebb8928504583da78a5173989fadfb1ac94be06a04f3cdbe9"
                }
            }
        };
        return gqlRequest(body, playerType);
    }
    function gqlRequest(body, playerType) {
        if (!GQLDeviceID) {
            const dcharacters = 'abcdefghijklmnopqrstuvwxyz0123456789';
            const dcharactersLength = dcharacters.length;
            for (let i = 0; i < 32; i++) {
                GQLDeviceID += dcharacters.charAt(Math.floor(Math.random() * dcharactersLength));
            }
        }
        let headers = {
            'Client-ID': ClientID,
            'X-Device-Id': GQLDeviceID,
            'Authorization': AuthorizationHeader,
            ...(ClientIntegrityHeader && { 'Client-Integrity': ClientIntegrityHeader }),
            ...(ClientVersion && { 'Client-Version': ClientVersion }),
            ...(ClientSession && { 'Client-Session-Id': ClientSession })
        };
        return new Promise((resolve, reject) => {
            const requestId = Math.random().toString(36).substring(2, 15);
            const fetchRequest = {
                id: requestId,
                url: 'https://gql.twitch.tv/gql',
                options: {
                    method: 'POST',
                    body: JSON.stringify(body),
                    headers
                }
            };
            pendingFetchRequests.set(requestId, {
                resolve,
                reject
            });
            postMessage({
                key: 'FetchRequest',
                value: fetchRequest
            });
        });
    }
    let playerForMonitoringBuffering = null;
    const playerBufferState = {
        position: 0,
        bufferedPosition: 0,
        bufferDuration: 0,
        numSame: 0,
        lastFixTime: 0,
        isLive: true
    };
    function monitorPlayerBuffering() {
        if (playerForMonitoringBuffering) {
            try {
                const player = playerForMonitoringBuffering.player;
                const state = playerForMonitoringBuffering.state;
                if (!player.core) {
                    playerForMonitoringBuffering = null;
                } else if (state.props?.content?.type === 'live' && !player.isPaused() && !player.getHTMLVideoElement()?.ended && playerBufferState.lastFixTime <= Date.now() - PlayerBufferingMinRepeatDelay && !isActivelyStrippingAds) {
                    const position = player.core?.state?.position;
                    const bufferedPosition = player.core?.state?.bufferedPosition;
                    const bufferDuration = player.getBufferDuration();
                    //console.log('position:' + position + ' bufferDuration:' + bufferDuration + ' bufferPosition:' + bufferedPosition);
                    // NOTE: This could be improved. It currently lets the player fully eat the full buffer before it triggers pause/play
                    if (position > 5 &&// changed from >0 to >5 due to issues with prerolls. TODO: Improve this, player could get stuck
                        (playerBufferState.position == position || bufferDuration < PlayerBufferingDangerZone) &&
                        playerBufferState.bufferedPosition == bufferedPosition &&
                        playerBufferState.bufferDuration >= bufferDuration &&
                        (position != 0 || bufferedPosition != 0 || bufferDuration != 0)
                    ) {
                        playerBufferState.numSame++;
                        if (playerBufferState.numSame == PlayerBufferingSameStateCount) {
                            console.log('Attempt to fix buffering position:' + playerBufferState.position + ' bufferedPosition:' + playerBufferState.bufferedPosition + ' bufferDuration:' + playerBufferState.bufferDuration);
                            doTwitchPlayerTask(!PlayerBufferingDoPlayerReload, PlayerBufferingDoPlayerReload, false);
                            const isPausePlay = !PlayerBufferingDoPlayerReload;
                            const isReload = PlayerBufferingDoPlayerReload;
                            doTwitchPlayerTask(isPausePlay, isReload);
                            playerBufferState.lastFixTime = Date.now();
                        }
                    } else {
                        playerBufferState.numSame = 0;
                    }
                    playerBufferState.position = position;
                    playerBufferState.bufferedPosition = bufferedPosition;
                    playerBufferState.bufferDuration = bufferDuration;
                }
            } catch (err) {
                console.error('error when monitoring player for buffering: ' + err);
                playerForMonitoringBuffering = null;
            }
        }
        if (!playerForMonitoringBuffering) {
            const playerAndState = getPlayerAndState();
            if (playerAndState && playerAndState.player && playerAndState.state) {
                playerForMonitoringBuffering = {
                    player: playerAndState.player,
                    state: playerAndState.state
                };
            }
        }
        const isLive = playerForMonitoringBuffering?.state?.props?.content?.type === 'live';
        if (playerBufferState.isLive && !isLive) {
            updateAdblockBanner({
                hasAds: false
            });
        }
        playerBufferState.isLive = isLive;
        setTimeout(monitorPlayerBuffering, PlayerBufferingDelay);
    }
    function updateAdblockBanner(data) {
        // Banner completely disabled for invisible ad blocking
        // Only track internal state
        isActivelyStrippingAds = data.isStrippingAdSegments;
    }
    function getPlayerAndState() {
        function findReactNode(root, constraint) {
            if (root.stateNode && constraint(root.stateNode)) {
                return root.stateNode;
            }
            let node = root.child;
            while (node) {
                const result = findReactNode(node, constraint);
                if (result) {
                    return result;
                }
                node = node.sibling;
            }
            return null;
        }
        function findReactRootNode() {
            let reactRootNode = null;
            const rootNode = document.querySelector('#root');
            if (rootNode && rootNode._reactRootContainer && rootNode._reactRootContainer._internalRoot && rootNode._reactRootContainer._internalRoot.current) {
                reactRootNode = rootNode._reactRootContainer._internalRoot.current;
            }
            if (reactRootNode == null && rootNode != null) {
                const containerName = Object.keys(rootNode).find(x => x.startsWith('__reactContainer'));
                if (containerName != null) {
                    reactRootNode = rootNode[containerName];
                }
            }
            return reactRootNode;
        }
        const reactRootNode = findReactRootNode();
        if (!reactRootNode) {
            return null;
        }
        let player = findReactNode(reactRootNode, node => node.setPlayerActive && node.props && node.props.mediaPlayerInstance);
        player = player && player.props && player.props.mediaPlayerInstance ? player.props.mediaPlayerInstance : null;
        const playerState = findReactNode(reactRootNode, node => node.setSrc && node.setInitialPlaybackSettings);
        return {
            player: player,
            state: playerState
        };
    }
    function doTwitchPlayerTask(isPausePlay, isReload) {
        const playerAndState = getPlayerAndState();
        if (!playerAndState) {
            console.log('Could not find react root');
            return;
        }
        const player = playerAndState.player;
        const playerState = playerAndState.state;
        if (!player) {
            console.log('Could not find player');
            return;
        }
        if (!playerState) {
            console.log('Could not find player state');
            return;
        }
        if (player.isPaused() || player.core?.paused) {
            return;
        }
        if (isPausePlay) {
            player.pause();
            player.play();
            return;
        }
        if (isReload) {
            const lsKeyQuality = 'video-quality';
            const lsKeyMuted = 'video-muted';
            const lsKeyVolume = 'volume';
            let currentQualityLS = null;
            let currentMutedLS = null;
            let currentVolumeLS = null;
            try {
                currentQualityLS = localStorage.getItem(lsKeyQuality);
                currentMutedLS = localStorage.getItem(lsKeyMuted);
                currentVolumeLS = localStorage.getItem(lsKeyVolume);
                if (localStorageHookFailed && player?.core?.state) {
                    localStorage.setItem(lsKeyMuted, JSON.stringify({ default: player.core.state.muted }));
                    localStorage.setItem(lsKeyVolume, player.core.state.volume);
                }
                if (localStorageHookFailed && player?.core?.state?.quality?.group) {
                    localStorage.setItem(lsKeyQuality, JSON.stringify({ default: player.core.state.quality.group }));
                }
            } catch { }
            console.log('Reloading Twitch player');
            playerState.setSrc({ isNewMediaPlayerInstance: true, refreshAccessToken: true });
            postTwitchWorkerMessage('TriggeredPlayerReload');
            player.play();
            if (localStorageHookFailed && (currentQualityLS || currentMutedLS || currentVolumeLS)) {
                setTimeout(() => {
                    try {
                        if (currentQualityLS) {
                            localStorage.setItem(lsKeyQuality, currentQualityLS);
                        }
                        if (currentMutedLS) {
                            localStorage.setItem(lsKeyMuted, currentMutedLS);
                        }
                        if (currentVolumeLS) {
                            localStorage.setItem(lsKeyVolume, currentVolumeLS);
                        }
                    } catch { }
                }, 3000);
            }
            return;
        }
    }
    window.reloadTwitchPlayer = () => {
        doTwitchPlayerTask(false, true);
    };
    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => {
            worker.postMessage({ key: key, value: value });
        });
    }
    async function handleWorkerFetchRequest(fetchRequest) {
        try {
            const response = await window.realFetch(fetchRequest.url, fetchRequest.options);
            const responseBody = await response.text();

            // Intercept PlaybackAccessToken from Worker
            if (typeof fetchRequest.url === 'string' && fetchRequest.url.includes('gql') &&
                fetchRequest.options && typeof fetchRequest.options.body === 'string' &&
                fetchRequest.options.body.includes('PlaybackAccessToken')) {
                try {
                    // Check if this is a backup anti-ad request (not the real viewer token)
                    let isBackupRequest = false;
                    try {
                        const bodyJson = JSON.parse(fetchRequest.options.body);
                        const queries = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
                        for (const q of queries) {
                            const pt = q?.variables?.playerType;
                            if (pt && (pt === 'embed' || pt === 'popout' || pt === 'autoplay')) {
                                isBackupRequest = true;
                                break;
                            }
                        }
                    } catch(e) {}

                    const data = JSON.parse(responseBody);
                    const queries = Array.isArray(data) ? data : [data];
                    let foundToken = false;
                    for (const query of queries) {
                        if (query?.data?.streamPlaybackAccessToken?.value) {
                            foundToken = true;
                            const tokenData = JSON.parse(query.data.streamPlaybackAccessToken.value);
                            const isSub = tokenData.subscriber === true || tokenData.hide_ads === true;

                            // Don't let backup tokens overwrite a confirmed sub status
                            if (isBackupRequest && window.__twitchSubscriberStatus === true && !isSub) {
                                console.log('[TwitchAdBlocker] Worker: Ignoring backup token sub=false (already confirmed sub)');
                                continue;
                            }

                            window.__twitchSubscriberStatus = isSub;
                            window.dispatchEvent(new CustomEvent('twitch-sub-status', { detail: { isSub } }));
                        }
                    }
                    if (!foundToken) { }
                } catch (e) {
                    console.log('[TwitchAdBlocker] Error parsing token JSON for sub status from worker', e);
                }
            }

            const responseObject = {
                id: fetchRequest.id,
                status: response.status,
                statusText: response.statusText,
                headers: Object.fromEntries(response.headers.entries()),
                body: responseBody
            };
            return responseObject;
        } catch (error) {
            return {
                id: fetchRequest.id,
                error: error.message
            };
        }
    }
    // --- Intercept PlaybackAccessToken to check sub status ---
    function hookFetch() {
        const realFetch = window.fetch;
        window.realFetch = realFetch;
        window.fetch = function (url, init, ...args) {
            let isPlaybackAccessTokenQuery = false;

            if (typeof url === 'string') {
                if (url.includes('gql')) {
                    if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                        isPlaybackAccessTokenQuery = true;
                    }

                    let deviceId = init.headers['X-Device-Id'];
                    if (typeof deviceId !== 'string') {
                        deviceId = init.headers['Device-ID'];
                    }
                    if (typeof deviceId === 'string' && GQLDeviceID != deviceId) {
                        GQLDeviceID = deviceId;
                        postTwitchWorkerMessage('UpdateDeviceId', GQLDeviceID);
                    }
                    if (typeof init.headers['Client-Version'] === 'string' && init.headers['Client-Version'] !== ClientVersion) {
                        postTwitchWorkerMessage('UpdateClientVersion', ClientVersion = init.headers['Client-Version']);
                    }
                    if (typeof init.headers['Client-Session-Id'] === 'string' && init.headers['Client-Session-Id'] !== ClientSession) {
                        postTwitchWorkerMessage('UpdateClientSession', ClientSession = init.headers['Client-Session-Id']);
                    }
                    if (typeof init.headers['Client-Integrity'] === 'string' && init.headers['Client-Integrity'] !== ClientIntegrityHeader) {
                        postTwitchWorkerMessage('UpdateClientIntegrityHeader', ClientIntegrityHeader = init.headers['Client-Integrity']);
                    }
                    if (typeof init.headers['Authorization'] === 'string' && init.headers['Authorization'] !== AuthorizationHeader) {
                        postTwitchWorkerMessage('UpdateAuthorizationHeader', AuthorizationHeader = init.headers['Authorization']);
                    }
                    if (ForceAccessTokenPlayerType && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken')) {
                        let replacedPlayerType = '';
                        const newBody = JSON.parse(init.body);
                        if (Array.isArray(newBody)) {
                            for (let i = 0; i < newBody.length; i++) {
                                if (newBody[i]?.variables?.playerType && newBody[i]?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                    replacedPlayerType = newBody[i].variables.playerType;
                                    newBody[i].variables.playerType = ForceAccessTokenPlayerType;
                                }
                            }
                        } else {
                            if (newBody?.variables?.playerType && newBody?.variables?.playerType !== ForceAccessTokenPlayerType) {
                                replacedPlayerType = newBody.variables.playerType;
                                newBody.variables.playerType = ForceAccessTokenPlayerType;
                            }
                        }
                        if (replacedPlayerType) {
                            console.log(`Replaced '${replacedPlayerType}' player type with '${ForceAccessTokenPlayerType}' player type`);
                            init.body = JSON.stringify(newBody);
                        }
                    }
                    // Get rid of mini player above chat - TODO: Reject this locally instead of having server reject it
                    if (init && typeof init.body === 'string' && init.body.includes('PlaybackAccessToken') && init.body.includes('picture-by-picture')) {
                        init.body = '';
                    }
                }
            }

            // Detect if this is a VOD PlaybackAccessToken query (for stripping restricted_bitrates)
            let isVodAccessTokenQuery = false;
            if (isPlaybackAccessTokenQuery && init && typeof init.body === 'string') {
                try {
                    const bodyJson = JSON.parse(init.body);
                    const queries = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
                    for (const q of queries) {
                        if (q?.operationName === 'PlaybackAccessToken' && q?.variables?.isVod === true) {
                            isVodAccessTokenQuery = true;
                            break;
                        }
                    }
                } catch(e) {}
            }

            // For VOD access token queries, we need to modify the response to strip restricted_bitrates
            if (VodUnlockEnabled && isVodAccessTokenQuery) {
                return realFetch.apply(this, arguments).then(async function(response) {
                    try {
                        const text = await response.text();
                        let data = JSON.parse(text);
                        const queries = Array.isArray(data) ? data : [data];
                        for (const query of queries) {
                            if (query?.data?.videoPlaybackAccessToken?.value) {
                                const tokenData = JSON.parse(query.data.videoPlaybackAccessToken.value);
                                if (tokenData.chansub && tokenData.chansub.restricted_bitrates && tokenData.chansub.restricted_bitrates.length > 0) {
                                    console.log('[VOD Unlock] Stripping restricted_bitrates from VOD token:', tokenData.chansub.restricted_bitrates);
                                    tokenData.chansub.restricted_bitrates = [];
                                    query.data.videoPlaybackAccessToken.value = JSON.stringify(tokenData);
                                }
                            }
                        }
                        return new Response(JSON.stringify(data), {
                            status: response.status,
                            statusText: response.statusText,
                            headers: response.headers
                        });
                    } catch(e) {
                        console.log('[VOD Unlock] Error modifying VOD token:', e);
                        return response;
                    }
                });
            }

            const fetchPromise = realFetch.apply(this, arguments);

            // Intercept the PlaybackAccessToken response safely without breaking other vaft.js overrides
            if (isPlaybackAccessTokenQuery) {
                // Check if this is a backup anti-ad request by inspecting the playerType
                let isBackupTokenRequest = false;
                if (init && typeof init.body === 'string') {
                    try {
                        const bodyJson = JSON.parse(init.body);
                        const queries = Array.isArray(bodyJson) ? bodyJson : [bodyJson];
                        for (const q of queries) {
                            const pt = q?.variables?.playerType;
                            if (pt && (pt === 'embed' || pt === 'popout' || pt === 'autoplay')) {
                                isBackupTokenRequest = true;
                                break;
                            }
                        }
                    } catch(e) {}
                }

                fetchPromise.then(response => {
                    const clone = response.clone();
                    clone.json().then(data => {
                        try {
                            const queries = Array.isArray(data) ? data : [data];
                            let foundToken = false;
                            for (const query of queries) {
                                if (query?.data?.streamPlaybackAccessToken?.value) {
                                    foundToken = true;
                                    const tokenData = JSON.parse(query.data.streamPlaybackAccessToken.value);

                                    // Based on live GraphQl trace: the props are 'subscriber' and 'hide_ads'
                                    const isSub = tokenData.subscriber === true || tokenData.hide_ads === true;

                                    // Don't let backup tokens overwrite a confirmed sub status
                                    if (isBackupTokenRequest && window.__twitchSubscriberStatus === true && !isSub) {
                                        console.log('[TwitchAdBlocker] Ignoring backup token sub=false (already confirmed sub)');
                                        continue;
                                    }

                                    console.log('[TwitchAdBlocker] Subscriber status check:', isSub, tokenData);

                                    // Set global variable for dvr-ui.js
                                    window.__twitchSubscriberStatus = isSub;
                                    // Send CustomEvent to the page
                                    window.dispatchEvent(new CustomEvent('twitch-sub-status', { detail: { isSub } }));
                                }
                            }
                            if (!foundToken) { }
                        } catch (e) {
                            console.log('[TwitchAdBlocker] Error parsing token JSON for sub status', e);
                        }
                    }).catch(() => { });
                }).catch(() => { });
            }

            return fetchPromise;
        };
    }
    function onContentLoaded() {
        // This stops Twitch from pausing the player when in another tab and an ad shows.
        // Taken from https://github.com/saucettv/VideoAdBlockForTwitch/blob/cefce9d2b565769c77e3666ac8234c3acfe20d83/chrome/content.js#L30
        try {
            Object.defineProperty(document, 'visibilityState', {
                get() {
                    return 'visible';
                }
            });
        } catch { }
        let hidden = document.__lookupGetter__('hidden');
        let webkitHidden = document.__lookupGetter__('webkitHidden');
        try {
            Object.defineProperty(document, 'hidden', {
                get() {
                    return false;
                }
            });
        } catch { }
        const block = e => {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
        };
        let wasVideoPlaying = true;
        const visibilityChange = e => {
            if (typeof chrome !== 'undefined') {
                const videos = document.getElementsByTagName('video');
                if (videos.length > 0) {
                    if (hidden.apply(document) === true || (webkitHidden && webkitHidden.apply(document) === true)) {
                        wasVideoPlaying = !videos[0].paused && !videos[0].ended;
                    } else if (wasVideoPlaying && !videos[0].ended && videos[0].paused && videos[0].muted) {
                        videos[0].play();
                    }
                }
            }
            block(e);
        };
        document.addEventListener('visibilitychange', visibilityChange, true);
        document.addEventListener('webkitvisibilitychange', visibilityChange, true);
        document.addEventListener('mozvisibilitychange', visibilityChange, true);
        document.addEventListener('hasFocus', block, true);
        try {
            if (/Firefox/.test(navigator.userAgent)) {
                Object.defineProperty(document, 'mozHidden', {
                    get() {
                        return false;
                    }
                });
            } else {
                Object.defineProperty(document, 'webkitHidden', {
                    get() {
                        return false;
                    }
                });
            }
        } catch { }
        // Hooks for preserving volume / resolution
        try {
            const keysToCache = [
                'video-quality',
                'video-muted',
                'volume',
                'lowLatencyModeEnabled',// Low Latency
                'persistenceEnabled',// Mini Player
            ];
            const cachedValues = new Map();
            for (let i = 0; i < keysToCache.length; i++) {
                cachedValues.set(keysToCache[i], localStorage.getItem(keysToCache[i]));
            }
            const realSetItem = localStorage.setItem;
            localStorage.setItem = function (key, value) {
                if (cachedValues.has(key)) {
                    cachedValues.set(key, value);
                }
                realSetItem.apply(this, arguments);
            };
            const realGetItem = localStorage.getItem;
            localStorage.getItem = function (key) {
                if (cachedValues.has(key)) {
                    return cachedValues.get(key);
                }
                return realGetItem.apply(this, arguments);
            };
            if (!localStorage.getItem.toString().includes(Object.keys({ cachedValues })[0])) {
                // These hooks are useful to preserve player state on player reload
                // Firefox doesn't allow hooking of localStorage functions but chrome does
                localStorageHookFailed = true;
            }
        } catch (err) {
            console.log('localStorageHooks failed ' + err)
            localStorageHookFailed = true;
        }
    }
    declareOptions(window);
    try {
        hookWindowWorker();
    } catch(e) {
        console.error('[TwitchAdBlocker] hookWindowWorker error:', e);
    }
    hookFetch();
    if (PlayerBufferingFix) {
        monitorPlayerBuffering();
    }
    if (document.readyState === "complete" || document.readyState === "loaded" || document.readyState === "interactive") {
        onContentLoaded();
    } else {
        window.addEventListener("DOMContentLoaded", function () {
            onContentLoaded();
        });
    }

    function postTwitchWorkerMessage(key, value) {
        twitchWorkers.forEach((worker) => {
            worker.postMessage({ key: key, value: value });
        });
    }

    // Listen for settings updates from the extension popup
    window.addEventListener('message', (event) => {
        if (event.source !== window || !event.data || event.data.type !== 'TWITCH_ADBLOCK_SETTINGS') return;

        const settings = event.data.settings;
        if (settings) {
            console.log('[TwitchAdBlocker] Applied new settings in vaft.js:', settings);
            if (typeof settings.adBlockEnabled !== 'undefined') {
                window.AdBlockEnabled = settings.adBlockEnabled;
                postTwitchWorkerMessage('UpdateSettings', settings);
            }
            if (typeof settings.vodUnlockEnabled !== 'undefined') {
                window.VodUnlockEnabled = settings.vodUnlockEnabled;
            }
        }
    });
    window.simulateAds = (depth) => {
        if (depth === undefined || depth < 0) {
            console.log('Ad depth paramter required (0 = no simulated ad, 1+ = use backup player for given depth)');
            return;
        }
        postTwitchWorkerMessage('SimulateAds', depth);
    };
    window.allSegmentsAreAdSegments = () => {
        postTwitchWorkerMessage('AllSegmentsAreAdSegments');
    };
})();
