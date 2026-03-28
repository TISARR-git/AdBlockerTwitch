<div align="center">
  <img src="icons/icon128.png" alt="Twitch AdBlocker Logo" width="128">
  <h1>🛡️ Twitch AdBlocker + DVR & VOD Unlocker</h1>
  <p>An all-in-one browser extension to block Twitch ads, unlock sub-only VODs, and add a live DVR player.</p>
  <p><a href="README.md">FR Version française</a></p>

  [![Latest Version](https://img.shields.io/github/v/release/TISARR-git/AdBlockerTwitch?label=version)](https://github.com/TISARR-git/AdBlockerTwitch/releases)
  [![Platform](https://img.shields.io/badge/Chrome-orange?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
  [![Platform](https://img.shields.io/badge/Firefox-red?logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)
  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-Support%20the%20project-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/tisarr)
</div>

---

## ✨ Main Features

* 🚫 **Ad Blocking (Zero-Ad)**: Intercepts and blocks Twitch ads seamlessly without quality loss or loading screens. Keeps the live stream smooth.
* 🔓 **VOD Unlocker (Sub-Only)**: Bypasses channel restrictions to let you watch subscriber-only replays for free.
* ⏪ **DVR Player (Live)**: Caches the live stream so you can rewind and fast-forward during a live broadcast. If you're already subscribed to the channel, it won't appear.
* 🌐 **Cross-Browser**: Fully compatible with **Google Chrome** (and Chromium-based browsers like Brave/Edge) and **Mozilla Firefox**.
* 📥 **Auto Updates**: The extension automatically detects new versions on GitHub and prompts you for download.
* 💬 **Chat Undelete (Anti-Moderation)**: Displays messages deleted by moderation in the Twitch chat.

---

## 🚀 Installation

Because this extension uses advanced methods to counter the Twitch player, it must be installed manually. It is now compatible with **Chrome** and **Firefox**.

### 🛠️ For Google Chrome (and Chromium browsers)
1. **Download**: Download the `TwitchAdBlocker-Chrome.zip` file from the [latest Release](https://github.com/TISARR-git/AdBlockerTwitch/releases/latest) and extract it.
2. **Extensions**: Open `chrome://extensions/` in your browser.
3. **Developer Mode**: Enable **"Developer mode"** in the top right.
4. **Load**: Click on **"Load unpacked"** and select the extracted folder.

### 🦊 For Mozilla Firefox
1. **Download**: Download the `TwitchAdBlocker-Firefox.xpi` file from the [latest Release](https://github.com/TISARR-git/AdBlockerTwitch/releases/latest).
2. **Extensions**: Open `about:addons` in Firefox.
3. **Install**: Click on the gear icon (settings) and choose **"Install Add-on From File..."**. Select the `.xpi` file.

---

## 🖥️ Development & Compilation

If you want to modify the code or compile your own versions:

1. Clone the repository.
2. The main source code is at the root (Chrome format).
3. Run the build script to generate specific versions:
   ```bash
   node build.js
   ```
4. The ready-to-use files will be in the `dist/` folder.

---

## 🎮 How to Use

Once the extension is installed, it works silently in the background on all `*.twitch.tv/*` pages.

* **Popup Menu**: Click on the extension icon to open the control panel and toggle features.
* **DVR Feature**: During a live stream, hover over the player. A bar appears at the bottom. Click to rewind, click "GO LIVE" to return to the live broadcast.
* **Statistics**: The popup shows the number of ads blocked and VODs unlocked.

---

## 🛠️ Technical Details

The extension uses synchronous injections (`document_start`) and hooks into the Twitch player's `WebWorkers` to intercept HLS playlists and remove ad segments before they are played.

---

## ⚠️ Warnings

* **Twitch Updates**: Twitch occasionally updates its video player to counter ad blockers. If the extension stops working, check for updates on GitHub.
* The extension has been optimized to minimize CPU usage, but the `DVR` keeps segments in memory cache which may affect very low-performance devices.

## 📄 License

This project is provided for educational purposes.