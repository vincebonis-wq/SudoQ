# 🧩 SudoQ — Sudoku à deux

Une application de Sudoku belle et légère, faite pour se **défier à deux** :
15 niveaux progressifs, chronomètre, mode notes, et un **tableau comparatif de
vos records**.

> Chaque niveau génère **toujours la même grille** (génération déterministe par
> _seed_) — vos temps sont donc réellement comparables entre les deux joueurs.

## ✨ Fonctionnalités

- **15 niveaux** du plus doux au plus redoutable
  - 🌱 Facile · 🌊 Moyen · 🔥 Difficile · 💀 Très difficile
- **Progression** : chaque niveau terminé débloque le suivant
- **Chronomètre** et enregistrement automatique du **meilleur temps** par joueur
- **Deux profils** personnalisables (toi & ta copine) avec un sélecteur en haut
- **Tableau des records** : meilleur temps par niveau, vainqueur mis en avant,
  décompte des niveaux gagnés (couronne 👑 au leader)
- **Synchro automatique entre vos deux téléphones** 💕 via un « code de couple »
  (stockage cloud gratuit, **sans compte** — voir plus bas)
- **Saisie tactile** : on clique sur une case, puis sur un chiffre (1-9)
- **Mode notes / crayon ✏️** : place les petits chiffres candidats dans les cases
- **Confort de jeu** : surbrillance ligne/colonne/bloc, chiffres identiques,
  détection des erreurs, indice 💡, vérification, pause ⏸
- **Thème clair / sombre 🌙**
- **Clavier** : chiffres `1-9`, `Backspace` pour effacer, `N` ou `Espace` pour
  les notes, flèches pour se déplacer, `H` pour un indice
- 100 % **hors-ligne**, aucune dépendance, aucun serveur

## 🚀 Lancer l'app

### En local

Ouvre simplement `index.html` dans ton navigateur. (Un petit serveur local
évite les soucis de sécurité selon les navigateurs :)

```bash
python3 -m http.server 8000
# puis ouvre http://localhost:8000
```

### En ligne gratuitement (GitHub Pages)

1. Va dans **Settings → Pages** du dépôt
2. **Source** : branche `main` (ou ta branche), dossier `/ (root)`
3. Enregistre : ton app est publiée sur
   `https://<ton-user>.github.io/<nom-du-repo>/`

Vous pouvez alors y jouer chacun depuis votre téléphone.

## 🏆 Synchroniser vos records (espace de couple)

Les scores se synchronisent **automatiquement entre vos deux téléphones**, via
un petit stockage cloud gratuit et **sans aucun compte à créer**
([jsonblob.com](https://jsonblob.com)). Un « code de couple » unique relie vos deux
appareils.

### Mise en route (une seule fois)

1. Sur **ton** téléphone : bouton 💕 (en haut) → **Créer notre espace**
2. Un **code de couple** s'affiche → **copie-le** et envoie-le à ta copine
3. Sur **son** téléphone : bouton 💕 → colle le code → **Rejoindre l'espace**

C'est tout ! Ensuite, chaque record est envoyé et récupéré automatiquement :
la pastille en haut passe au **vert 🟢** quand la synchro est active, et le
tableau des records se met à jour tout seul (rafraîchissement à l'ouverture de
l'app et toutes les 20 s).

> Chacun choisit **qui il est** (toi / ta copine) avec le sélecteur en haut à
> gauche. Les meilleurs temps sont toujours **fusionnés** : on garde le
> meilleur des deux, aucune donnée n'est écrasée.

### Filets de sécurité

- Tout est **aussi sauvegardé en local** sur chaque téléphone (localStorage) :
  même hors-ligne, ou si le cloud est momentanément indisponible, tu continues
  de jouer et tes records repartent à la synchro suivante.
- Dans l'écran 🏆 _Records_, tu peux **⬇️ Exporter** / **⬆️ Importer** un
  fichier `sudoq-scores.json` (sauvegarde manuelle, ou pour archiver un
  historique commun dans ce dépôt GitHub).

### Bon à savoir

- Le stockage `jsonblob.com` est gratuit et sans compte ; c'est un service tiers
  léger. Si un jour il ne répondait pas, la synchro se met en pause (l'app
  affiche « sauvegarde locale active ») sans jamais bloquer le jeu.
- Pour changer de fournisseur cloud, tout est isolé dans **`js/sync.js`**
  (3 fonctions : `createSpace`, `pull`, `push`).

## 🗂 Structure

```
index.html        Structure de l'app
css/styles.css    Styles (thèmes clair/sombre, responsive)
js/sudoku.js      Moteur : générateur déterministe + solveur (unicité garantie)
js/sync.js        Synchro cloud gratuite sans compte (espace de couple, jsonblob.com)
js/app.js         Logique : niveaux, chrono, notes, records, profils, synchro
scores.json       Modèle de fichier de scores (sauvegarde/export manuel)
```

## 🔧 Ajuster la difficulté

Dans `js/sudoku.js`, la table `LEVELS` définit le nombre d'indices (`clues`) de
chaque niveau — moins d'indices = plus difficile. Le `seed` fixe garantit une
grille reproductible ; changez-le pour obtenir une nouvelle grille sur un niveau.

Bon jeu, et que le meilleur gagne ! 💜
