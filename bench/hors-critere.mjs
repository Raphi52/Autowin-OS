#!/usr/bin/env node
/**
 * hors-critere.mjs <copie du bras> [--temoin <copie non modifiee>]
 *
 * DEUXIEME axe du banc : ce que le critere binaire NE regarde PAS. Les 6 bras ont tous fait
 * passer leur critere ; sur le banc du 2026-09-04, c'est exactement la que le pipeline complet
 * s'etait distingue — un bras peut atteindre son critere en laissant du code non formate, un
 * lint rouge, un test voisin casse ou un test devenu intermittent.
 *
 * TOUT est mesure EN DELTA contre une copie TEMOIN non modifiee, au meme commit. Sans ce
 * temoin la mesure accuse a faux : `prettier --check` etait DEJA rouge sur
 * `ChatComposer.tsx` et `scout-residus.angle-mort.test.mjs` avant tout bras, et
 * `src/shared/boot-splash.test.ts` echouait DEJA. Un rouge herite n'est pas une faute du bras,
 * et un rouge herite devenu vert est une REPARATION qu'il faut lui compter.
 *
 *   H1 formatage : prettier --check sur les fichiers modifies
 *   H2 lint      : eslint sur ceux qui sont du code
 *   H3 voisinage : les tests qui CITENT les fichiers modifies (carte figee plus bas)
 *   H4 stabilite : les tests modifies rejoues 3 fois (une donnee tiree au hasard peut rendre
 *                  un test intermittent — defaut mesure sur le test 8.3)
 *
 * Exit 0 = aucune REGRESSION (vert -> rouge) · 1 = au moins une regression · 2 = cible invalide.
 */
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

const args = process.argv.slice(2)
const iT = args.indexOf('--temoin')
const cible = path.resolve(
  args.find((a) => !a.startsWith('--') && args.indexOf(a) !== iT + 1) || process.cwd()
)
const temoin = iT >= 0 ? path.resolve(args[iT + 1]) : path.join(path.dirname(cible), 'temoin')

for (const [nom, d] of [
  ['cible', cible],
  ['temoin', temoin]
]) {
  if (!existsSync(path.join(d, 'package.json'))) {
    console.log(`RATE ${nom} invalide : ${d}`)
    process.exit(2)
  }
}

// Tests qui CITENT les fichiers de production concernes (releve par grep, fige ici pour rester
// deterministe : tous les bras d'un meme defaut sont juges sur la meme liste).
const VOISINS = {
  'src/renderer/index.html': [
    'src/shared/boot-splash.test.ts',
    'src/main/startup-splash.test.ts',
    'src/main/renderer-storage-migration.test.ts'
  ],
  'src/shared/boot-splash.ts': [
    'src/shared/boot-splash.test.ts',
    'src/main/startup-splash.test.ts',
    'src/main/renderer-storage-migration.test.ts'
  ],
  'src/renderer/src/components/ChatComposer.tsx': [
    'src/renderer/src/components/ChatComposer.dictee.test.tsx',
    'src/renderer/src/components/ChatComposer.jauge-contexte.test.tsx',
    'src/renderer/src/components/ChatComposer.jauge-contexte.style.test.ts'
  ],
  'scripts/scout-residus.angle-mort.test.mjs': ['scripts/scout-residus.angle-mort.test.mjs'],
  'scripts/scout-residus.mjs': ['scripts/scout-residus.angle-mort.test.mjs']
}

const ESC = String.fromCharCode(27)
const sansCouleur = (t) =>
  t
    .split(ESC)
    .map((m, i) => (i === 0 ? m : m.replace(/^.[0-9;]*m/, '')))
    .join('')
const lancer = (dossier, cmd, argv, timeout = 900000) =>
  spawnSync(cmd, argv, { cwd: dossier, encoding: 'utf8', shell: true, timeout })
const resume = (r, n = 3) =>
  sansCouleur(`${r.stdout || ''}${r.stderr || ''}`)
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(' | ')
    .slice(0, 260)

const modifies = lancer(cible, 'git', ['diff', '--name-only'])
  .stdout.split('\n')
  .map((l) => l.trim())
  .filter(Boolean)
if (modifies.length === 0) {
  console.log('RATE le bras n a modifie aucun fichier')
  process.exit(1)
}
console.log(`fichiers modifies : ${modifies.join(', ')}`)
console.log(`temoin : ${temoin}`)

const resultats = []
/**
 * Joue la MEME commande dans la copie du bras et dans le temoin, et classe le delta.
 * `attendu` decrit ce que la commande verifie ; `absent` sert quand il n'y a rien a mesurer.
 */
const delta = (nom, cmd, argv, options = {}) => {
  if (options.absent) {
    resultats.push({ nom, etat: 'sans objet', detail: options.absent })
    return
  }
  const rc = lancer(cible, cmd, argv)
  const rt = lancer(temoin, cmd, argv)
  const bras = rc.status === 0
  const base = rt.status === 0
  if (bras && base) resultats.push({ nom, etat: 'ok', detail: 'vert avant, vert apres' })
  else if (bras && !base)
    resultats.push({
      nom,
      etat: 'repare',
      detail: `rouge AVANT le bras, vert apres — ${resume(rt, 2)}`
    })
  else if (!bras && base)
    resultats.push({
      nom,
      etat: 'regression',
      detail: `vert avant, exit ${rc.status} apres — ${resume(rc, 4)}`
    })
  else
    resultats.push({
      nom,
      etat: 'deja rouge',
      detail: `rouge avant ET apres (exit ${rc.status}) — pas imputable au bras`
    })
}

delta('H1 formatage (prettier --check)', 'npx', ['prettier', '--check', ...modifies])

const code = modifies.filter((f) => /\.(ts|tsx|mjs|js|cjs|jsx)$/.test(f))
delta('H2 lint (eslint)', 'npx', ['eslint', '--no-cache', ...code], {
  absent: code.length === 0 ? 'aucun fichier de code modifie' : null
})

const voisins = [...new Set(modifies.flatMap((f) => VOISINS[f] || []))].filter((f) =>
  existsSync(path.join(cible, f))
)
delta(`H3 tests voisins (${voisins.length})`, 'npx', ['vitest', 'run', ...voisins], {
  absent: voisins.length === 0 ? 'aucun test ne cite les fichiers modifies' : null
})

// H4 n'a pas besoin de temoin : il mesure la STABILITE des tests que le bras a ecrits.
const testsModifies = modifies.filter((f) => /\.test\.(ts|tsx|mjs|js)$/.test(f))
if (testsModifies.length === 0) {
  resultats.push({
    nom: 'H4 stabilite',
    etat: 'sans objet',
    detail: 'le bras n a modifie aucun test'
  })
} else {
  let rouge = null
  for (let i = 1; i <= 3 && !rouge; i += 1) {
    const r = lancer(cible, 'npx', ['vitest', 'run', ...testsModifies])
    if (r.status !== 0) rouge = `passage ${i}/3 rouge — ${resume(r, 4)}`
  }
  resultats.push(
    rouge
      ? { nom: `H4 stabilite (${testsModifies.length} x3)`, etat: 'regression', detail: rouge }
      : {
          nom: `H4 stabilite (${testsModifies.length} x3)`,
          etat: 'ok',
          detail: '3 passages verts de suite'
        }
  )
}

const etiquette = {
  ok: 'OK  ',
  repare: 'MIEUX',
  regression: 'RATE',
  'deja rouge': 'HERITE',
  'sans objet': '----'
}
for (const x of resultats) console.log(`${etiquette[x.etat]} ${x.nom} — ${x.detail}`)
const regressions = resultats.filter((x) => x.etat === 'regression').length
const reparations = resultats.filter((x) => x.etat === 'repare').length
console.log(
  regressions === 0
    ? `HORS-CRITERE PROPRE (0 regression, ${reparations} reparation(s))`
    : `HORS-CRITERE : ${regressions} REGRESSION(S), ${reparations} reparation(s)`
)
process.exit(regressions === 0 ? 0 : 1)
