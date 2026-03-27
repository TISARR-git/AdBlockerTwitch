<div align="center">
  <img src="icons/icon128.png" alt="Twitch AdBlocker Logo" width="128">
  <h1>🛡️ Twitch AdBlocker + DVR & VOD Unlocker</h1>
  <p>Une extension de navigateur tout-en-un pour bloquer les publicités Twitch, débloquer les VODs sub-only, et ajouter un lecteur DVR en direct.</p>
  <p><a href="README_EN.md">EN English version</a></p>

  [![Dernière Version](https://img.shields.io/github/v/release/TISARR-git/AdBlockerTwitch?label=version)](https://github.com/TISARR-git/AdBlockerTwitch/releases)
  [![Platform](https://img.shields.io/badge/plateforme-Google%20Chrome-orange.svg)](https://www.google.com/chrome/)
  [![Ko-Fi](https://img.shields.io/badge/Ko--fi-Soutenir%20le%20projet-FF5E5B?style=flat&logo=ko-fi&logoColor=white)](https://ko-fi.com/tisarr)
</div>

---

## ✨ Fonctionnalités Principales

* 🚫 **Bloquage de Pubs (Zero-Ad)** : Intercepte et bloque les publicités Twitch de manière transparente sans perte de qualité ni écran d'attente. Maintien du direct fluide.
* 🔓 **Débloqueur de VODs (Sub-Only)** : Contourne les restrictions des chaînes pour vous permettre de regarder gratuitement les rediffusions réservées aux abonnés.
* ⏪ **Lecteur DVR (Direct)** : Met en cache le direct pour vous permettre de reculer et d'avancer dans le stream en live. Si vous êtes déjà sub à la chaîne il ne s'affichera pas.
* 💬 **Chat Undelete (Anti-Modération)** : Affiche en gris et barré les messages supprimés par la modération dans le chat Twitch.
* ⚙️ **Popup de Contrôle** : Activer ou désactiver chaque fonctionnalité (Adblock, VOD, DVR) à la volée via l'interface de l'extension.

---

## 🚀 Installation (Mode Développeur)

Puisque cette extension utilise des méthodes avancées pour contrer le lecteur Twitch, elle n'est pas publiée sur le Chrome Web Store. Elle a été testée uniquement sur **Google Chrome** :

1. **Télécharger le code source** : Clonez ce dépôt GitHub ou téléchargez-le sous forme de fichier `.zip` (et extrayez-le).
2. **Accéder aux Extensions** : Ouvrez **Google Chrome** et tapez `chrome://extensions/` dans la barre d'adresse.
3. **Mode Développeur** : En haut à droite, activez le bouton **"Mode développeur"**.
4. **Charger l'extension** : Cliquez sur le bouton **"Charger l'extension non empaquetée"** (ou "Load unpacked") qui est apparu en haut à gauche.
5. **Sélectionner le dossier** : Sélectionnez le dossier de l'extension (le dossier contenant `manifest.json`).

C'est prêt ! L'extension est maintenant active. 🎉

---

## 🎮 Comment l'utiliser

Dès que l'extension est installée, elle agit silencieusement en arrière-plan sur toutes les pages `*.twitch.tv/*`.

* **Menu Popup** : Cliquez sur l'icône de l'extension dans la barre de votre navigateur pour ouvrir le panneau de contrôle.
* **Fonctionnalité DVR** : Lorsque vous regardez un stream en direct, passez votre souris sur le lecteur vidéo. Une barre de progression DVR apparaîtra en bas, vous permettant de cliquer pour revenir en arrière. Pour revenir au direct, cliquez sur "GO LIVE".
* **Statistiques** : Le popup affiche en temps réel le nombre de publicités bloquées afin que vous sachiez que l'extension travaille pour vous.

---

## 🛠️ Détails Techniques et Architecture

L'extension utilise de multiples stratégies :
* **VAFT (`vaft.js`)** : Intercepte les accès `Worker` et surcharge la fonction `fetch` de Twitch pour demander des listes de lecture (playlists M3U8) propres, expurgées des segments publicitaires.
* **DVR UI (`dvr-ui.js`)** : Remplace dynamiquement le composant vidéo natif par une instance `HLS.js` lorsqu'un retour en arrière est demandé sur un stream en direct. Le CPU est préservé grâce à l'utilisation d'un `MutationObserver`.
* **Content/Inject (`content.js`, `inject.js`)** : Injections synchrones critiques déclenchées au tout début du chargement de la page (`document_start`) pour devancer l'initialisation du lecteur Twitch.

---

## ⚠️ Avertissements

* **Mises à jour Twitch** : Twitch met occasionnellement à jour son lecteur vidéo pour contrer les bloqueurs. Si l'extension cesse de fonctionner, vérifiez les mises à jour sur le GitHub.
* L'extension a été optimisée pour minimiser l'usage CPU, mais le `DVR` conserve des segments en mémoire cache ce qui peut affecter les appareils très peu performants.

## 📄 Licence

Ce projet est fourni à des fins éducatives.
