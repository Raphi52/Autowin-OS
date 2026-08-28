#!/usr/bin/env node
// Routine de scout du code résiduel inutile (lecture seule, aucun fichier modifié).
// Sortie : rapport Markdown des candidats à `clean`, classés par catégorie.
// Usage : node scripts/scout-residus.mjs [racine=src]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname, basename, extname } from 'node:path'

const RACINE = resolve(process.argv[2] ?? 'src')
const PROJET = process.cwd()
const EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx'])
const IGNORE = /(^|[\/])(node_modules|out|dist|build|worktrees|graphify-out|\.git)([\/]|$)/

function lister(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (IGNORE.test(p)) continue
    if (e.isDirectory()) lister(p, acc)
    else if (EXT.has(extname(e.name))) acc.push(p)
  }
  return acc
}

const fichiers = lister(RACINE)
const src = new Map(fichiers.map((f) => [f, readFileSync(f, 'utf8')]))
const rel = (f) => relative(PROJET, f).split(String.fromCharCode(92)).join('/')
const estTest = (f) => /\.(test|spec)\.[tj]sx?$/.test(f)

// --- 1. Fichiers jamais importés (hors tests, hors points d'entrée)
const importsBruts = new Map() // fichier -> [specifiers]
for (const [f, c] of src) {
  const specs = [...c.matchAll(/(?:from\s+|import\s*\(|require\(\s*)['"]([^'"]+)['"]/g)].map((m) => m[1])
  importsBruts.set(f, specs)
}
const cibles = new Set()
for (const [f, specs] of importsBruts) {
  for (const s of specs) {
    if (!s.startsWith('.')) continue
    const base = resolve(dirname(f), s).split(String.fromCharCode(92)).join('/')
    for (const cand of [base, base + '.ts', base + '.tsx', base + '.js', base + '/index.ts', base + '/index.tsx']) {
      cibles.add(cand)
    }
    cibles.add(base.replace(/\.js$/, '.ts'))
  }
}
const ENTREES = /(src\/main\/index\.ts|src\/preload\/|src\/renderer\/src\/main\.tsx|\.d\.ts$)/
const orphelins = fichiers
  .filter((f) => !estTest(f) && !ENTREES.test(rel(f)))
  .filter((f) => !cibles.has(f.split(String.fromCharCode(92)).join('/')))

// --- 2. Exports jamais référencés ailleurs
const exportsMorts = []
for (const [f, c] of src) {
  if (estTest(f)) continue
  const noms = [
    ...c.matchAll(/^export\s+(?:async\s+)?(?:const|function|class|type|interface|enum)\s+([A-Za-z0-9_$]+)/gm)
  ].map((m) => m[1])
  for (const n of noms) {
    let vus = 0
    for (const [g, cg] of src) {
      if (g === f) continue
      if (new RegExp(`\\b${n}\\b`).test(cg)) vus++
    }
    if (vus === 0) exportsMorts.push({ fichier: rel(f), nom: n })
  }
}

// --- 3. Résidus textuels (marqueurs, debug, code commenté)
const MOTIFS = [
  ['TODO/FIXME/HACK', /\b(TODO|FIXME|HACK|XXX)\b/],
  ['console.log/debug', /console\.(log|debug|trace)\s*\(/],
  ['catch vide', /catch\s*\([^)]*\)\s*\{\s*\}/],
  ['@ts-ignore', /@ts-(ignore|expect-error)/],
  ['test désactivé', /\b(it|test|describe)\.(skip|todo)\b/],
  ['code commenté', /^\s*\/\/\s*(const|let|function|import|return|if)\b/]
]
const residus = []
for (const [f, c] of src) {
  const lignes = c.split(/\r?\n/)
  lignes.forEach((l, i) => {
    for (const [cat, re] of MOTIFS) {
      if (re.test(l)) residus.push({ cat, ref: `${rel(f)}:${i + 1}`, extrait: l.trim().slice(0, 110) })
    }
  })
}

// --- Rapport
const groupe = (arr, k) => arr.reduce((m, x) => ((m[x[k]] ??= []).push(x), m), {})
const out = []
out.push(`# Scout du code résiduel — ${rel(RACINE)}`)
out.push(`\n_${fichiers.length} fichiers scannés · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_`)
out.push(`\n## 1. Fichiers jamais importés (${orphelins.length})`)
out.push(orphelins.length ? orphelins.map((f) => `- \`${rel(f)}\``).join('\n') : '- rien')
out.push(`\n## 2. Exports jamais référencés ailleurs (${exportsMorts.length})`)
out.push(
  exportsMorts.length
    ? Object.entries(groupe(exportsMorts, 'fichier'))
        .slice(0, 60)
        .map(([f, xs]) => `- \`${f}\` → ${xs.map((x) => x.nom).join(', ')}`)
        .join('\n')
    : '- rien'
)
out.push(`\n## 3. Résidus dans le code (${residus.length})`)
for (const [cat, xs] of Object.entries(groupe(residus, 'cat'))) {
  out.push(`\n### ${cat} (${xs.length})`)
  out.push(xs.slice(0, 40).map((x) => `- \`${x.ref}\` — ${x.extrait}`).join('\n'))
  if (xs.length > 40) out.push(`- … ${xs.length - 40} de plus`)
}
out.push(
  `\n> Lecture seule : rien n'a été supprimé. Chaque item est un CANDIDAT — vérifier l'appelant réel (chargement dynamique, IPC, test) avant tout retrait, puis passer par \`clean\`.`
)
console.log(out.join('\n'))
