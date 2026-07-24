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

## 🏆 Partager les records entre vous deux

Les scores sont sauvegardés **dans le navigateur** (localStorage).

- **Même appareil / même navigateur** : rien à faire, les deux profils partagent
  automatiquement le tableau des records.
- **Deux appareils différents** : dans l'écran 🏆 _Records_ :
  - **⬇️ Exporter** génère un fichier `sudoq-scores.json`
  - **⬆️ Importer** fusionne un fichier reçu (on garde toujours le meilleur
    temps de chacun)

### Astuce « stockage sur GitHub »

Pour garder un historique commun versionné, déposez le `sudoq-scores.json`
exporté dans ce dépôt (par ex. en le renommant `scores.json` et en le
commitant). Chacun peut le télécharger depuis GitHub puis l'**Importer** dans
l'app pour se synchroniser. C'est une synchro manuelle simple et sans serveur —
une vraie synchro automatique nécessiterait un backend ou un jeton d'accès.

## 🗂 Structure

```
index.html        Structure de l'app
css/styles.css    Styles (thèmes clair/sombre, responsive)
js/sudoku.js      Moteur : générateur déterministe + solveur (unicité garantie)
js/app.js         Logique : niveaux, chrono, notes, records, profils, import/export
scores.json       Modèle de fichier de scores (pour le partage via GitHub)
```

## 🔧 Ajuster la difficulté

Dans `js/sudoku.js`, la table `LEVELS` définit le nombre d'indices (`clues`) de
chaque niveau — moins d'indices = plus difficile. Le `seed` fixe garantit une
grille reproductible ; changez-le pour obtenir une nouvelle grille sur un niveau.

Bon jeu, et que le meilleur gagne ! 💜
