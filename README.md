<div align="center">
  <img src="icons/icon128.png" alt="Twitch AdBlocker Logo" width="128">
  <h1>🛡️ Twitch AdBlocker + DVR & VOD Unlocker</h1>
  <p>Une extension de navigateur tout-en-un pour bloquer les publicités Twitch, débloquer les VODs sub-only, et ajouter un lecteur DVR en direct.</p>
  <p><a href="README_EN.md">EN English version</a></p>

  [![Dernière Version](https://img.shields.io/github/v/release/TISARR-git/AdBlockerTwitch?label=version)](https://github.com/TISARR-git/AdBlockerTwitch/releases)
  [![Platform](https://img.shields.io/badge/Chrome-orange?logo=googlechrome&logoColor=white)](https://www.google.com/chrome/)
  [![Platform](https://img.shields.io/badge/Firefox-red?logo=firefoxbrowser&logoColor=white)](https://www.mozilla.org/firefox/)
  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-Soutenir%20le%20projet-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/tisarr)
</div>

---

## ✨ Fonctionnalités Principales

* 🚫 **Blocage de Pubs (Zero-Ad)** : Intercepte et bloque les publicités Twitch de manière transparente sans perte de qualité ni écran d'attente. Maintien du direct fluide.
* 🔓 **Débloqueur de VODs (Sub-Only)** : Contourne les restrictions des chaînes pour vous permettre de regarder gratuitement les rediffusions réservées aux abonnés.
* ⏪ **Lecteur DVR (Direct)** : Met en cache le direct pour vous permettre de reculer et d'avancer dans le stream en live. Si vous êtes déjà sub à la chaîne il ne s'affichera pas.
* 🌐 **Multi-Navigateur** : Entièrement compatible avec **Google Chrome** (et dérivés comme Brave/Edge) ainsi que **Mozilla Firefox**.
* 📥 **Mises à jour Auto** : L'extension détecte automatiquement les nouvelles versions sur GitHub et vous propose de les télécharger.
* 💬 **Chat Undelete (Anti-Modération)** : Affiche les messages supprimés par la modération dans le chat Twitch.

---

## 🚀 Installation

Puisque cette extension utilise des méthodes avancées pour contrer le lecteur Twitch, elle doit être installée manuellement. Elle est désormais compatible avec **Chrome** et **Firefox**.

### 🛠️ Pour Google Chrome (et navigateurs Chromium)
1. **Télécharger** : Téléchargez le fichier `TwitchAdBlocker-Chrome.zip` depuis la [dernière Release](https://github.com/TISARR-git/AdBlockerTwitch/releases/latest) et extrayez-le.
2. **Extensions** : Ouvrez `chrome://extensions/` dans votre navigateur.
3. **Mode Développeur** : Activez le **"Mode développeur"** en haut à droite.
4. **Charger** : Cliquez sur **"Charger l'extension non empaquetée"** (Load unpacked) et sélectionnez le dossier extrait.

### 🦊 Pour Mozilla Firefox
1. **Télécharger** : Téléchargez le fichier `TwitchAdBlocker-Firefox.xpi` depuis la [dernière Release](https://github.com/TISARR-git/AdBlockerTwitch/releases/latest).
2. **Extensions** : Ouvrez `about:addons` dans Firefox.
3. **Installer** : Cliquez sur l'icône de l'engrenage (paramètres) et choisissez **"Installer un module depuis un fichier..."**. Sélectionnez le fichier `.xpi`.

---

## 🖥️ Développement et Compilation

Si vous souhaitez modifier le code ou compiler vos propres versions :

1. Clonez le dépôt.
2. Le code source principal se trouve à la racine (format Chrome).
3. Lancez le script de build pour générer les versions spécifiques :
   ```bash
   node build.js
   ```
4. Les fichiers prêts à l'emploi se trouveront dans le dossier `dist/`.

---

## 🎮 Comment l'utiliser

Dès que l'extension est installée, elle agit silencieusement en arrière-plan sur toutes les pages `*.twitch.tv/*`.

* **Menu Popup** : Cliquez sur l'icône de l'extension pour ouvrir le panneau de contrôle et activer/désactiver les fonctions.
* **Fonctionnalité DVR** : Sur un live, passez la souris sur le lecteur. Une barre apparaît en bas. Cliquez pour reculer, cliquez sur "GO LIVE" pour revenir au direct.
* **Statistiques** : Le popup affiche le nombre de publicités bloquées et de VODs débloquées.

---

## 🛠️ Détails Techniques

L'extension utilise des injections synchrones (`document_start`) et des hooks sur les `WebWorkers` du lecteur Twitch pour intercepter les playlists HLS et en retirer les segments publicitaires avant qu'ils ne soient lus. 

---

## ⚠️ Avertissements

* **Mises à jour Twitch** : Twitch met occasionnellement à jour son lecteur vidéo pour contrer les bloqueurs. Si l'extension cesse de fonctionner, vérifiez les mises à jour sur le GitHub.
* L'extension a été optimisée pour minimiser l'usage CPU, mais le `DVR` conserve des segments en mémoire cache ce qui peut affecter les appareils très peu performants.

## 📄 Licence

Ce projet est fourni à des fins éducatives.