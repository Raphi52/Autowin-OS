#!/usr/bin/env node
// Routine de scout du code résiduel inutile (lecture seule, aucun fichier modifié).
// Sortie : rapport Markdown des candidats à `clean`, classés par catégorie.
// Usage : node scripts/scout-residus.mjs [racine=src]
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative, resolve, dirname, basename, extname } from 'node:path'

const RACINE = resolve(process.argv[2] ?? 'src')
const PROJET = process.cwd()
const EXT = new Set(['.ts', '.tsx', '.mts', '.js', '.jsx', '.mjs', '.cjs'])
const IGNORE = /(^|[\/])(node_modules|out|dist|build|worktrees|graphify-out|\.git)([\/]|$)/

// Ce que la sonde N'ANALYSE PAS, par extension. Sans ce compte, un lecteur croit le rapport
// exhaustif : sur `scripts/`, 52 des 159 fichiers sont des `.ps1` que EXT ne couvre pas, et les
// deux residus les plus flagrants du dossier y vivaient (banc /arena du 2026-09-05, bras a/b/c
// battus par un balayage direct precisement sur cet angle mort).
const horsPerimetre = new Map()
// TOUS les fichiers, extensions non analysees comprises : la passe « chemins absolus morts »
// ci-dessous doit lire les `.ps1`/`.py` que EXT laisse dehors, c'est precisement la ou vivent
// les racines codees en dur.
const tousFichiers = []

function lister(dir, acc = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (IGNORE.test(p)) continue
    if (e.isDirectory()) lister(p, acc)
    else if ((tousFichiers.push(p), EXT.has(extname(e.name)))) acc.push(p)
    else {
      const ext = extname(e.name) || '(sans extension)'
      horsPerimetre.set(ext, (horsPerimetre.get(ext) ?? 0) + 1)
    }
  }
  return acc
}

const fichiers = lister(RACINE)
const nonAnalyses = [...horsPerimetre.entries()].sort((a, b) => b[1] - a[1])
const totalNonAnalyses = nonAnalyses.reduce((n, [, c]) => n + c, 0)

const rel = (f) => relative(PROJET, f).split(String.fromCharCode(92)).join('/')
// --- 0 bis. Chemins absolus MORTS dans des fichiers par ailleurs vivants.
// Un script qui n'est pas « code mort » peut avoir cessé de FONCTIONNER : une racine codée en dur
// vers un dossier disparu le tue dès sa première ligne, sans qu'aucun détecteur de code mort ne le
// voie. Mesuré au banc /arena du 2026-09-06 : `assert-package-content.ps1` pointait
// `C:\Amitel\Autowin OS` et rendait exit 1, entraînant deux `verify-*.ps1` VIVANTS avec lui — le
// bras qui suivait la sonde les avait déclarés verts. Critère retenu : le DOSSIER PARENT du chemin
// cité n'existe pas (un fichier de sortie encore à produire est légitime, son dossier doit exister).
const cheminsMorts = []
const vusChemins = new Set()
for (const f of tousFichiers) {
  // Un fichier de TEST invente ses chemins : `C:/repo/src/a.ts` y est une donnee d'essai, pas une
  // racine de production. Les inclure noyait la passe (282 signalements sur `src/`, presque tous
  // des fixtures) et rendait la section illisible, donc inutile.
  if (/\.(test|spec)\./.test(f) || /[\\/](fixtures?|__mocks__)[\\/]/.test(f)) continue
  let contenu
  try {
    contenu = readFileSync(f, 'utf8')
  } catch {
    continue
  }
  // Un fichier qui recree son dossier de sortie ne peut pas mourir d'un dossier absent :
  // `mkdirSync(…, { recursive: true })` le refabrique a chaque execution. Mesure du banc /arena
  // v3 (2026-09-06) : ~10 signalements etaient refutes par la ligne meme qui les portait.
  if (/mkdirSync\s*\([^)]*recursive\s*:\s*true/.test(contenu)) continue
  const lignes = contenu.split(String.fromCharCode(10))
  for (let i = 0; i < lignes.length; i += 1) {
    // Un chemin qui n'est qu'un DEFAUT surchargeable n'est pas une racine morte : derriere un
    // drapeau CLI (`arg('--out-dir', 'C:/…')`) ou un repli d'environnement
    // (`process.env.X || 'C:/…'`), la valeur reelle vient de l'appelant.
    if (/['"`]--[\w-]+['"`]\s*,/.test(lignes[i])) continue
    if (/process\.env\.[A-Za-z_][A-Za-z_0-9]*\s*(\|\||\?\?)/.test(lignes[i])) continue
    // Une VRAIE racine Windows : une lettre isolée suivie de `:\` ou `:/`, jamais un schéma
    // d'URL (`http://` se termine par `p:/`) ni un double séparateur.
    for (const m of lignes[i].matchAll(/(?<![A-Za-z0-9])[A-Za-z]:[\\/](?![\\/])[^'"`\r\n)]*/g)) {
      const brut = m[0].replace(/[\s,;)\]}]+$/, '')
      const parent = dirname(brut)
      // Un chemin interpolé n'est pas vérifiable : sa valeur réelle dépend de l'exécution.
      if (brut.length < 6 || parent === brut || brut.includes('$')) continue
      const cle = f + '|' + brut
      if (vusChemins.has(cle)) continue
      vusChemins.add(cle)
      let existe = true
      try {
        statSync(parent)
      } catch {
        existe = false
      }
      if (!existe) cheminsMorts.push({ ref: rel(f) + ':' + (i + 1), chemin: brut })
    }
  }
}
const src = new Map(fichiers.map((f) => [f, readFileSync(f, 'utf8')]))

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
out.push(
  totalNonAnalyses
    ? `\n## 0. Angle mort — ${totalNonAnalyses} fichier(s) NON analysé(s)\n` +
        nonAnalyses.map(([e, c]) => `- \`${e}\` : ${c}`).join('\n') +
        `\n\nLa sonde ne lit que ${[...EXT].join(', ')}. Ces fichiers ne sont PAS propres : ils sont INVISIBLES. ` +
        `Les balayer à la main avant de conclure que le dossier est trié.`
    : `\n## 0. Angle mort — aucun : toutes les extensions présentes sont analysées.`
)
out.push(
  cheminsMorts.length
    ? `\n## 0 bis. Chemins absolus morts dans des fichiers VIVANTS (${cheminsMorts.length})\n` +
        cheminsMorts.slice(0, 40).map((x) => `- \`${x.ref}\` → \`${x.chemin}\` (dossier parent absent)`).join('\n') +
        (cheminsMorts.length > 40 ? `\n- … ${cheminsMorts.length - 40} de plus` : '') +
        `\n\nCes fichiers ne sont pas du code MORT : ils sont CASSÉS. Un script qui n'est jamais listé ` +
        `ici peut quand même ne plus marcher — EXÉCUTE ceux que tu vas déclarer vivants avant de conclure.`
    : `\n## 0 bis. Chemins absolus morts — aucun. Cela ne prouve PAS que les scripts marchent : exécute ceux que tu déclares vivants.`
)
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
