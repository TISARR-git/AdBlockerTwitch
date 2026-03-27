<div align="center">
  <img src="icons/icon128.png" alt="Twitch AdBlocker Logo" width="128">
  <h1>🛡️ Twitch AdBlocker + DVR & VOD Unlocker</h1>
  <p>An all-in-one browser extension to block Twitch ads, unlock sub-only VODs, and add a live DVR player.</p>
  <p><a href="README.md">FR Version française</a></p>

  [![Latest Version](https://img.shields.io/github/v/release/TISARR-git/AdBlockerTwitch?label=version)](https://github.com/TISARR-git/AdBlockerTwitch/releases)
  [![Platform](https://img.shields.io/badge/platform-Google%20Chrome-orange.svg)](https://www.google.com/chrome/)
  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-Support%20the%20project-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/tisarr)
</div>

---

## ✨ Main Features

* 🚫 **Ad Blocking (Zero-Ad)**: Intercepts and blocks Twitch ads seamlessly without quality loss or loading screens. Keeps the live stream smooth.
* 🔓 **VOD Unlocker (Sub-Only)**: Bypasses channel restrictions to let you watch subscriber-only replays for free.
* ⏪ **DVR Player (Live)**: Caches the live stream so you can rewind and fast-forward during a live broadcast. If you're already subscribed to the channel, it won't appear.
* 💬 **Chat Undelete (Anti-Moderation)**: Displays deleted messages (by moderation) in grey and strikethrough in the Twitch chat.
* ⚙️ **Control Popup**: Enable or disable each feature (Adblock, VOD, DVR) on the fly via the extension interface.

---

## 🚀 Installation (Developer Mode)

Since this extension uses advanced methods to counter the Twitch player, it is not published on the Chrome Web Store. It has only been tested on **Google Chrome**:

1. **Download the source code**: Clone this GitHub repository or download it as a `.zip` file (and extract it).
2. **Access Extensions**: Open **Google Chrome** and type `chrome://extensions/` in the address bar.
3. **Developer Mode**: In the top right corner, enable the **"Developer mode"** toggle.
4. **Load the extension**: Click the **"Load unpacked"** button that appeared in the top left.
5. **Select the folder**: Select the extension folder (the folder containing `manifest.json`).

That's it! The extension is now active. 🎉

---

## 🎮 How to Use

Once the extension is installed, it works silently in the background on all `*.twitch.tv/*` pages.

* **Popup Menu**: Click on the extension icon in your browser bar to open the control panel.
* **DVR Feature**: When watching a live stream, hover over the video player. A DVR progress bar will appear at the bottom, allowing you to click to rewind. To return to live, click on "GO LIVE".
* **Statistics**: The popup displays in real-time the number of ads blocked so you know the extension is working for you.

---

## 🛠️ Technical Details & Architecture

The extension uses multiple strategies:
* **VAFT (`vaft.js`)**: Intercepts `Worker` access and overrides Twitch's `fetch` function to request clean playlists (M3U8), stripped of ad segments.
* **DVR UI (`dvr-ui.js`)**: Dynamically replaces the native video component with an `HLS.js` instance when a rewind is requested on a live stream. CPU is preserved through the use of a `MutationObserver`.
* **Content/Inject (`content.js`, `inject.js`)**: Critical synchronous injections triggered at the very beginning of page load (`document_start`) to get ahead of the Twitch player initialization.

---

## ⚠️ Warnings

* **Twitch Updates**: Twitch occasionally updates its video player to counter ad blockers. If the extension stops working, check for updates on GitHub.
* The extension has been optimized to minimize CPU usage, but the `DVR` keeps segments in memory cache which may affect very low-performance devices.

## 📄 License

This project is provided for educational purposes.
