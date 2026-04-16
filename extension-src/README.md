# CoupDEchec — Extension Chrome

Analyse Stockfish en temps réel sur chess.com. Affiche le meilleur coup avec une flèche dorée.

## Installation

### 1. Télécharger Stockfish.js (obligatoire)

L'extension requiert `stockfish.js` dans ce dossier. Deux options :

**Option A — npm (recommandé)**
```bash
npm install stockfish
cp node_modules/stockfish/src/stockfish.js ./stockfish.js
```

**Option B — téléchargement direct**
Télécharger `stockfish.js` depuis :
https://github.com/nmrugg/stockfish.js/releases

Placer le fichier à la racine du dossier `coupdechec-extension/`.

### 2. Générer les icônes PNG (optionnel)

Chrome nécessite des icônes PNG. Pour les générer depuis `icons/icon.svg` :
- Ouvrir `icons/icon.svg` dans un navigateur
- Faire une capture 16×16, 48×48, 128×128
- Sauvegarder en tant que `icons/icon16.png`, `icons/icon48.png`, `icons/icon128.png`

Ou utiliser Inkscape : `inkscape icons/icon.svg -w 128 -h 128 -o icons/icon128.png`

Sans icônes PNG, Chrome utilise une icône par défaut — l'extension fonctionne quand même.

### 3. Charger l'extension dans Chrome

1. Ouvrir `chrome://extensions`
2. Activer le **Mode développeur** (en haut à droite)
3. Cliquer **Charger l'extension non empaquetée**
4. Sélectionner ce dossier `coupdechec-extension/`

### 4. Utiliser l'extension

1. Aller sur **chess.com**
2. Jouer une partie ou ouvrir l'analyse
3. Cliquer le bouton **♟ CoupDEchec** en bas à droite de l'échiquier
4. La flèche dorée apparaît après ~1,5 seconde d'analyse

## Structure des fichiers

```
coupdechec-extension/
├── manifest.json       — Manifest MV3
├── content.js          — Script injecté dans chess.com
├── background.js       — Service worker MV3
├── popup.html          — Interface de la popup
├── popup.js            — Logique popup
├── stockfish.js        — ⚠ À télécharger (voir ci-dessus)
└── icons/
    ├── icon.svg        — Icône source
    ├── icon16.png      — À générer
    ├── icon48.png      — À générer
    └── icon128.png     — À générer
```

## Comment ça marche

1. **Lecture FEN** : `content.js` observe les mutations du DOM de `chess-board` (custom element chess.com). Chaque pièce a une classe `square-XY` (file × rank) et une classe `wp`/`bq`/etc. On reconstruit le FEN à partir de ces classes.

2. **Analyse** : Le FEN est envoyé à `stockfish.js` via un Web Worker. Stockfish analyse pendant 1,5 secondes (`movetime 1500`) et retourne le meilleur coup en notation UCI (`e2e4`).

3. **Flèche** : Un `<canvas>` est superposé sur le `chess-board`. La flèche dorée est dessinée depuis la case source vers la case cible.

4. **Détection de coup** : Un `MutationObserver` sur `chess-board` détecte chaque changement de position (déplacement de pièce) et relance l'analyse automatiquement.
