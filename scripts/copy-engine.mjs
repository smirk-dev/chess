// Copies the Stockfish *single-threaded* engine (the .js worker glue + its .wasm) from the installed
// `stockfish` npm package into public/engine/, so Vite serves the files verbatim at a stable URL
// with no bundler transformation. A single-threaded build means no SharedArrayBuffer and therefore
// no COOP/COEP cross-origin-isolation headers are needed — the app works on any static host.
//
// We deliberately copy only the lite single-threaded pair (~7 MB), NOT the full multi-threaded
// build whose .wasm is >100 MB. The lite build is still vastly stronger than any human, so an
// Elo-limited opponent is well served. The chosen entry filename is recorded in engine-manifest.json.
//
// Run automatically via the `predev` / `prebuild` npm scripts; also `npm run copy-engine`.
import { existsSync, mkdirSync, readdirSync, copyFileSync, statSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destDir = join(projectRoot, 'public', 'engine');

/** Locate the `stockfish` package root regardless of layout. */
function findStockfishPkgRoot() {
  const require = createRequire(pathToFileURL(join(projectRoot, 'package.json')));
  try {
    return dirname(require.resolve('stockfish/package.json'));
  } catch {
    return null;
  }
}

/** Directories within the package that may hold the prebuilt engine files. */
function engineDirs(pkgRoot) {
  return ['bin', 'src', '.'].map((d) => join(pkgRoot, d)).filter((d) => existsSync(d) && statSync(d).isDirectory());
}

/** Score a candidate .js filename: higher = more preferred (single-threaded + lite + simd). */
function scoreEngineJs(name) {
  const n = name.toLowerCase();
  if (!/^stockfish.*\.js$/.test(n)) return -Infinity;
  if (n.endsWith('.worker.js')) return -Infinity; // helper for MT builds, never the entry
  let s = 0;
  if (n.includes('single')) s += 100; // single-threaded — required
  if (n.includes('lite')) s += 40; // smaller NNUE, still far above human strength
  if (n.includes('asm')) s -= 30; // pure-asm fallback: huge & slow, last resort
  if (n.includes('no-simd') || n.includes('nosimd')) s -= 5;
  if (n.includes('nnue')) s += 5;
  if (n === 'stockfish.js') s += 1; // generic symlink/fallback
  return s;
}

function pickEntry() {
  const pkgRoot = findStockfishPkgRoot();
  if (!pkgRoot) return null;
  let best = null;
  for (const dir of engineDirs(pkgRoot)) {
    for (const f of readdirSync(dir)) {
      const score = scoreEngineJs(f);
      if (score === -Infinity) continue;
      // Skip symlinks — copy the real target instead (we'll catch it via its own name).
      const full = join(dir, f);
      try {
        if (statSync(full).isFile() === false) continue;
      } catch {
        continue;
      }
      if (!best || score > best.score) best = { dir, jsName: f, score };
    }
  }
  return best;
}

function main() {
  const pick = pickEntry();
  if (!pick) {
    console.warn('[copy-engine] Could not find a Stockfish single-threaded build — run `npm install` first. Skipping.');
    return;
  }

  const { dir, jsName } = pick;
  const base = jsName.replace(/\.js$/i, '');
  const companions = readdirSync(dir).filter(
    (f) => f !== jsName && (f === `${base}.wasm` || f === `${base}.worker.js` || f.startsWith(`${base}.`)),
  );
  const toCopy = [jsName, ...companions];

  if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
  mkdirSync(destDir, { recursive: true });
  const copied = [];
  for (const f of toCopy) {
    const from = join(dir, f);
    try {
      if (!existsSync(from) || !statSync(from).isFile()) continue;
    } catch {
      continue;
    }
    copyFileSync(from, join(destDir, f));
    copied.push(f);
  }

  writeFileSync(
    join(destDir, 'engine-manifest.json'),
    JSON.stringify({ engineJs: jsName, files: copied, source: dir, copiedAt: new Date().toISOString() }, null, 2) + '\n',
  );
  console.log(`[copy-engine] Copied ${copied.join(', ')} -> public/engine/  (Worker entry: engine/${jsName})`);
}

main();
