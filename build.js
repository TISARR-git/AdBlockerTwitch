const fs = require('fs');
const path = require('path');

const BUILD_DIR = path.join(__dirname, 'dist');
const CHROME_DIR = path.join(BUILD_DIR, 'chrome');
const FIREFOX_DIR = path.join(BUILD_DIR, 'firefox');

// Files/folders to exclude from the build copy
const IGNORE_LIST = [
    '.git',
    '.github',
    'dist',
    'build.js',
    'README.md',
    'README_EN.md',
    '.gitignore'
];

function copyFolderSync(from, to) {
    if (!fs.existsSync(to)) {
        fs.mkdirSync(to, { recursive: true });
    }
    const elements = fs.readdirSync(from);
    for (const el of elements) {
        if (IGNORE_LIST.includes(el)) continue;
        const srcPath = path.join(from, el);
        const destPath = path.join(to, el);
        const stat = fs.lstatSync(srcPath);

        if (stat.isFile()) {
            fs.copyFileSync(srcPath, destPath);
        } else if (stat.isDirectory()) {
            copyFolderSync(srcPath, destPath);
        }
    }
}

function buildChrome() {
    console.log('Building Chrome version...');
    copyFolderSync(__dirname, CHROME_DIR);
    console.log('✅ Chrome version ready.');
}

function buildFirefox() {
    console.log('Building Firefox version...');
    copyFolderSync(__dirname, FIREFOX_DIR);

    // Patch manifest.json
    const manifestPath = path.join(FIREFOX_DIR, 'manifest.json');
    let manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    // 1. Add the polyfill to the content script
    if (manifest.content_scripts && manifest.content_scripts.length > 0) {
        manifest.content_scripts[0].js.unshift('scripts/browser-polyfill.js');
    }

    // 2. Transform the background (service_worker -> scripts)
    manifest.background = {
        "scripts": ["scripts/browser-polyfill.js", "scripts/background.js"]
    };

    // 3. Add Firefox specific settings
    manifest.browser_specific_settings = {
        "gecko": {
            "id": "twitch-adblocker-plus@tisarr.dev",
            "strict_min_version": "109.0"
        }
    };

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

    // Patch popup.html
    const popupPath = path.join(FIREFOX_DIR, 'popup', 'popup.html');
    let popupHtml = fs.readFileSync(popupPath, 'utf8');
    popupHtml = popupHtml.replace('<script src="popup.js"></script>', '<script src="../scripts/browser-polyfill.js"></script>\n  <script src="popup.js"></script>');
    fs.writeFileSync(popupPath, popupHtml);

    console.log('✅ Firefox version ready.');
}

// Cleanup and compilation
console.log('Cleaning build directory...');
if (fs.existsSync(BUILD_DIR)) {
    fs.rmSync(BUILD_DIR, { recursive: true, force: true });
}

buildChrome();
buildFirefox();

console.log('🚀 Build successful. Ready for packaging!');
