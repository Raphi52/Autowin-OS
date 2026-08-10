// MESURE D'ARCHITECTURE : où un modèle va-t-il chercher EN PREMIER, et pour combien de tokens ?
//
// Construit trois surfaces de navigation concurrentes sur le Brain, et mesure exactement ce qu'elles
// coûtent. La partie « où va le modèle » se joue ensuite avec un sous-agent par surface, dont les
// tokens RÉELLEMENT consommés sont relevés dans le transcript — Autowin ne tokenise pas de texte
// localement, il lit les chiffres d'usage renvoyés par l'API, et c'est cette source qui fait foi.
//
// Usage : node scripts/mesurer-architecture-brain.mjs "<racine du brain>" "<dossier de sortie>"
//
// POURQUOI CE SCRIPT EXISTE, ET CE QU'IL A DÉJÀ APPRIS (mesuré le 2026-08-07) :
//   · surface par catégories cognitives : 2 914 caractères
//   · surface par arbre de dossiers     : 3 466 caractères
//   · liste plate de toutes les fiches  : 67 670 caractères — soit 23× la première
//   · coût TOTAL pour atteindre la réponse sur 7 questions réelles : catégories 29 197, dossiers
//     32 005, liste plate 473 690. Le gros gain est « n'importe quelle hiérarchie plutôt qu'un vidage
//     plat » (×16) ; les catégories ne battent les dossiers bruts que de 10 % sur ce seul critère.
//   · premier choix JUSTE, un sous-agent par surface : catégories 4/7, dossiers 2/7, plate 1/7, pour
//     63 322 / 63 192 / 83 276 tokens réels. n=1, donc l'écart 4-contre-2 reste dans le bruit.
//
// LA LIMITE À NE PAS OUBLIER : un seul tirage par surface ne départage rien. Pour conclure il faut
// répéter — plusieurs tirages par surface, et de préférence plus de 7 questions.

import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const NL = String.fromCharCode(10)
const BRAIN = process.argv[2]
const SORTIE = process.argv[3]

if (!BRAIN || !existsSync(BRAIN) || !SORTIE) {
  console.log('usage : node scripts/mesurer-architecture-brain.mjs "<racine du brain>" "<sortie>"')
  process.exit(2)
}
if (!existsSync(SORTIE)) mkdirSync(SORTIE, { recursive: true })

/** Consignes à la racine du vault : des règles de conduite, pas des inclassables. */
const RACINE_CONDUITE = new Set(['claude.md', 'agents.md', 'readme.md', 'home.md', 'index.md'])

/**
 * Même règle de rattachement que la vue (`graph-brain-categories.ts`). Elle est DUPLIQUÉE ici à
 * dessein : ce script doit pouvoir mesurer une règle CANDIDATE sans qu'on touche à l'application,
 * et la mesure perdrait son sens si modifier l'une changeait l'autre en silence.
 */
function categorieDe(rel, tags) {
  const seg = rel.toLowerCase().split('/')
  const a = (...t) => t.some((x) => tags.has(x))
  if (a('environnement', 'environment')) return 'Environnement et contraintes'
  if (seg[0] === 'integrations') return 'Environnement et contraintes'
  if (a('kit', 'process', 'preference')) return 'Comportement'
  if (seg[0] === 'governance') return 'Comportement'
  if (seg[1] === 'preferences') return 'Comportement'
  if (seg.length === 1 && RACINE_CONDUITE.has(seg[0])) return 'Comportement'
  if (a('decision-tracee', 'lesson')) return 'Mémoires'
  if (seg.includes('decisions') || seg.includes('lessons')) return 'Mémoires'
  if (a('code-map', 'area', 'relation', 'graphify')) return 'Code'
  if (seg[0] === 'projects' && !seg.includes('decisions')) return 'Code'
  if (seg.includes('rigapplication-documentation')) return 'Documentation'
  if (seg[0] === 'knowledge' || seg[0] === 'projects') return 'Savoir'
  if (seg[0] === 'inbox') return 'À trier'
  return 'Non classé'
}

const IGNORE = ['.git', 'tooling', '_generated', 'graphify-out']
function fiches(dir, base = '') {
  let out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (IGNORE.includes(e.name)) continue
    const rel = base === '' ? e.name : base + '/' + e.name
    if (e.isDirectory()) out = out.concat(fiches(join(dir, e.name), rel))
    else if (e.name.endsWith('.md')) {
      const txt = readFileSync(join(dir, e.name), 'utf8')
      const tete = txt.slice(0, 900)
      const tg = tete.match(new RegExp('^tags: *\\[(.*?)\\]', 'm'))
      const tags = new Set(
        tg ? tg[1].split(',').map((t) => t.trim().replace(/["']/g, '').toLowerCase()) : []
      )
      const h1 = tete.match(new RegExp('^# +(.+)$', 'm'))
      out.push({
        rel,
        titre: (h1 ? h1[1] : e.name.replace(/\.md$/, '')).trim(),
        categorie: categorieDe(rel, tags)
      })
    }
  }
  return out
}

const toutes = fiches(BRAIN)

// --- SURFACE A : l'arbre de dossiers, comme un explorateur de fichiers.
const parDossier = new Map()
for (const f of toutes) {
  const d = f.rel.includes('/') ? f.rel.slice(0, f.rel.lastIndexOf('/')) : '(racine)'
  parDossier.set(d, (parDossier.get(d) ?? 0) + 1)
}
const A =
  'Arborescence des dossiers du vault (dossier — nombre de fiches) :' +
  NL +
  [...parDossier.entries()]
    .sort()
    .map(([d, n]) => `  ${d}/  (${n})`)
    .join(NL)

// --- SURFACE B : les catégories cognitives, puis leurs sous-groupes.
const ORDRE = [
  'Comportement',
  'Mémoires',
  'Environnement et contraintes',
  'Savoir',
  'Documentation',
  'Code',
  'À trier',
  'Non classé'
]
const parCat = new Map()
for (const f of toutes) {
  const seg = f.rel.split('/')
  const sous = seg.length > 1 ? seg.slice(0, 2).join('/') : '(racine)'
  if (!parCat.has(f.categorie)) parCat.set(f.categorie, new Map())
  const m = parCat.get(f.categorie)
  m.set(sous, (m.get(sous) ?? 0) + 1)
}
let B = 'Le Brain rangé par catégorie cognitive (catégorie — nombre de fiches) :' + NL
for (const c of ORDRE) {
  const m = parCat.get(c)
  if (!m) {
    B += NL + `${c} (0)` + NL
    continue
  }
  const tot = [...m.values()].reduce((x, y) => x + y, 0)
  B +=
    NL +
    `${c} (${tot})` +
    NL +
    [...m.entries()]
      .sort()
      .map(([s, n]) => `    ${s}  (${n})`)
      .join(NL) +
    NL
}

// --- SURFACE C : la liste plate, tout à plat avec les titres.
const C =
  'Toutes les fiches du vault (chemin — titre) :' +
  NL +
  toutes
    .slice()
    .sort((a, b) => a.rel.localeCompare(b.rel))
    .map((f) => `  ${f.rel} — ${f.titre}`)
    .join(NL)

for (const [nom, txt] of [
  ['A-dossiers', A],
  ['B-categories', B],
  ['C-plate', C]
]) {
  writeFileSync(join(SORTIE, nom + '.txt'), txt, 'utf8')
  console.log(
    `  ${nom.padEnd(14)} ${String(txt.length).padStart(7)} caractères  ${String(txt.split(NL).length).padStart(5)} lignes`
  )
}

const comptes = new Map()
for (const f of toutes) comptes.set(f.categorie, (comptes.get(f.categorie) ?? 0) + 1)
console.log(NL + `répartition sur ${toutes.length} fiches :`)
for (const c of ORDRE) {
  const n = comptes.get(c) ?? 0
  console.log(
    `  ${c.padEnd(14)} ${String(n).padStart(4)}   ${((100 * n) / toutes.length).toFixed(1)} %`
  )
}
