/* =========================================================================
 * SudoQ — Moteur Sudoku
 * Générateur déterministe (seed) + solveur.
 * Chaque niveau produit TOUJOURS la même grille -> temps comparables.
 * ========================================================================= */

/* --- Générateur pseudo-aléatoire déterministe (mulberry32) --- */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/* --- Utilitaires grille (tableau plat de 81 cases, 0 = vide) --- */
function isSafe(grid, pos, val) {
  const row = Math.floor(pos / 9);
  const col = pos % 9;
  for (let i = 0; i < 9; i++) {
    if (grid[row * 9 + i] === val) return false; // ligne
    if (grid[i * 9 + col] === val) return false; // colonne
  }
  const boxRow = Math.floor(row / 3) * 3;
  const boxCol = Math.floor(col / 3) * 3;
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      if (grid[(boxRow + r) * 9 + (boxCol + c)] === val) return false; // bloc
    }
  }
  return true;
}

/* Remplit une grille complète et valide, de manière déterministe */
function generateFull(rng) {
  const grid = new Array(81).fill(0);

  function fill(pos) {
    if (pos === 81) return true;
    if (grid[pos] !== 0) return fill(pos + 1);
    const nums = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9], rng);
    for (const n of nums) {
      if (isSafe(grid, pos, n)) {
        grid[pos] = n;
        if (fill(pos + 1)) return true;
        grid[pos] = 0;
      }
    }
    return false;
  }

  fill(0);
  return grid;
}

/* Compte les solutions (s'arrête dès qu'on dépasse `limit`) */
function countSolutions(grid, limit = 2) {
  let count = 0;
  const work = grid.slice();

  function solve(pos) {
    if (count >= limit) return;
    if (pos === 81) {
      count++;
      return;
    }
    if (work[pos] !== 0) {
      solve(pos + 1);
      return;
    }
    for (let n = 1; n <= 9; n++) {
      if (isSafe(work, pos, n)) {
        work[pos] = n;
        solve(pos + 1);
        work[pos] = 0;
        if (count >= limit) return;
      }
    }
  }

  solve(0);
  return count;
}

/* Résout une grille (renvoie la solution ou null) */
function solveGrid(grid) {
  const work = grid.slice();
  function solve(pos) {
    if (pos === 81) return true;
    if (work[pos] !== 0) return solve(pos + 1);
    for (let n = 1; n <= 9; n++) {
      if (isSafe(work, pos, n)) {
        work[pos] = n;
        if (solve(pos + 1)) return true;
        work[pos] = 0;
      }
    }
    return false;
  }
  return solve(0) ? work : null;
}

/* Génère un puzzle (grille jouable + solution) pour un seed et un nb d'indices.
 * Retrait symétrique (180°) pour l'esthétique, avec garantie d'unicité. */
function generatePuzzle(seed, targetClues) {
  const rng = mulberry32(seed);
  const solution = generateFull(rng);
  const puzzle = solution.slice();

  // Ordre de retrait : on parcourt les paires symétriques.
  const positions = shuffle(
    Array.from({ length: 81 }, (_, i) => i),
    rng
  );

  let clues = 81;
  for (const pos of positions) {
    if (clues <= targetClues) break;
    if (puzzle[pos] === 0) continue;

    const sym = 80 - pos; // case symétrique par rotation 180°
    const backup1 = puzzle[pos];
    const backup2 = puzzle[sym];

    puzzle[pos] = 0;
    let removed = 1;
    if (sym !== pos && puzzle[sym] !== 0) {
      puzzle[sym] = 0;
      removed = 2;
    }

    // On garde le retrait seulement si la solution reste unique.
    if (countSolutions(puzzle, 2) === 1) {
      clues -= removed;
    } else {
      puzzle[pos] = backup1;
      puzzle[sym] = backup2;
    }
  }

  return { puzzle, solution, clues };
}

/* Configuration des 15 niveaux : label, bande de difficulté, nb d'indices.
 * Moins d'indices = plus difficile. Seed dérivé de l'index -> déterministe. */
const LEVELS = [
  { band: "Facile", clues: 46 },
  { band: "Facile", clues: 44 },
  { band: "Facile", clues: 42 },
  { band: "Moyen", clues: 40 },
  { band: "Moyen", clues: 38 },
  { band: "Moyen", clues: 36 },
  { band: "Moyen", clues: 34 },
  { band: "Difficile", clues: 32 },
  { band: "Difficile", clues: 30 },
  { band: "Difficile", clues: 29 },
  { band: "Difficile", clues: 28 },
  { band: "Très difficile", clues: 27 },
  { band: "Très difficile", clues: 26 },
  { band: "Très difficile", clues: 25 },
  { band: "Très difficile", clues: 24 },
].map((lvl, i) => ({
  index: i,
  number: i + 1,
  seed: 1000 + i * 137, // seed fixe et distinct par niveau
  ...lvl,
}));

const BAND_META = {
  Facile: { color: "#34d399", ink: "#059669", emoji: "🌱" },
  Moyen: { color: "#60a5fa", ink: "#2563eb", emoji: "🌊" },
  Difficile: { color: "#f59e0b", ink: "#d97706", emoji: "🔥" },
  "Très difficile": { color: "#f43f5e", ink: "#e11d48", emoji: "💀" },
};

// Cache des puzzles générés (génération à la demande, potentiellement lente).
const _puzzleCache = {};
function getLevelPuzzle(index) {
  if (_puzzleCache[index]) return _puzzleCache[index];
  const lvl = LEVELS[index];
  const p = generatePuzzle(lvl.seed, lvl.clues);
  _puzzleCache[index] = p;
  return p;
}

if (typeof window !== "undefined") {
  window.Sudoku = {
    LEVELS,
    BAND_META,
    getLevelPuzzle,
    solveGrid,
    isSafe,
    generatePuzzle,
  };
}
