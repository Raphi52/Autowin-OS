#!/usr/bin/env node
/**
 * LES TESTS QU'UNE MODIFICATION D'INTERFACE DOIT REPASSER, Y COMPRIS CEUX QUI NE L'IMPORTENT PAS.
 *
 * Usage : node scripts/tests-des-feuilles.mjs [fichier…] [--lancer]
 *   Sans fichier : les fichiers modifiés de l'arbre (suivis et non suivis, d'après git).
 *   Sortie : un chemin de test par ligne. `--lancer` passe la liste à vitest et rend son code.
 *
 * Pourquoi : `vitest related` suit les imports. Or les garde-fous de style de l'interface
 * (aucun flou, gabarit des vues, couleurs, variables définies…) LISENT les feuilles sur disque
 * sans les importer : il ne les trouve pas. Constat du 2026-11-12 : un `backdrop-filter` ajouté à
 * une feuille d'Agent Studio est parti rouge sur `assets/aucun-flou.test.ts`, que la liste de
 * tests choisie à la main n'avait pas retenu.
 *
 * Un test de `src/renderer` est retenu si :
 *   - il NOMME un fichier modifié (son nom de base, ex. « AgentsTopologyView.css ») ;
 *   - ou il BALAIE les feuilles (`readdirSync` + « .css ») et une feuille a changé ;
 *   - ou il BALAIE les composants (`readdirSync` + « .tsx ») et un composant a changé ;
 *   - ou il est le test voisin d'un fichier modifié (`x.ts` → `x.test.ts`).
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { basename, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const EST_UN_TEST = /\.test\.(?:ts|tsx|mjs)$/

/** Chemin à barres obliques, pour comparer et afficher pareil sous Windows. */
const normaliser = (chemin) => chemin.split(sep).join('/')

/**
 * Le cœur, sans disque ni git : quels tests retenir pour ces fichiers modifiés.
 * @param {{ modifies: string[], tests: { chemin: string, contenu: string }[] }} entree
 * @returns {string[]} chemins des tests retenus, triés, sans doublon
 */
export function testsLies({ modifies, tests }) {
  const noms = modifies.map((m) => basename(normaliser(m)))
  const feuilleChangee = modifies.some((m) => m.endsWith('.css'))
  const composantChange = modifies.some((m) => m.endsWith('.tsx'))
  const voisins = new Set(
    modifies
      .filter((m) => /\.(?:ts|tsx|mjs)$/.test(m) && !EST_UN_TEST.test(m))
      .map((m) => normaliser(m).replace(/\.(ts|tsx|mjs)$/, '.test.$1'))
  )
  const retenus = new Set()
  for (const { chemin, contenu } of tests) {
    const balaie = contenu.includes('readdirSync')
    if (
      voisins.has(normaliser(chemin)) ||
      noms.some((nom) => contenu.includes(nom)) ||
      (balaie && feuilleChangee && contenu.includes('.css')) ||
      (balaie && composantChange && contenu.includes('.tsx'))
    ) {
      retenus.add(normaliser(chemin))
    }
  }
  return [...retenus].sort()
}

function fichiersModifies(racine) {
  const sortie = execFileSync('git', ['status', '--porcelain', '--untracked-files=all'], {
    cwd: racine,
    encoding: 'utf8'
  })
  return sortie
    .split('\n')
    .filter(Boolean)
    .map((ligne) =>
      ligne
        .slice(3)
        .replace(/^.* -> /, '')
        .replace(/^"|"$/g, '')
    )
}

function testsDuRendu(racine) {
  const dossier = join(racine, 'src', 'renderer')
  return readdirSync(dossier, { recursive: true })
    .filter((chemin) => EST_UN_TEST.test(chemin) && !chemin.includes('node_modules'))
    .map((chemin) => {
      const complet = join(dossier, chemin)
      return {
        chemin: normaliser(relative(racine, complet)),
        contenu: readFileSync(complet, 'utf8')
      }
    })
}

const lanceSeul = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (lanceSeul) {
  const racine = process.cwd()
  const args = process.argv.slice(2)
  const lancer = args.includes('--lancer')
  const donnes = args.filter((a) => a !== '--lancer')
  const modifies = donnes.length > 0 ? donnes : fichiersModifies(racine)
  const liste = testsLies({ modifies, tests: testsDuRendu(racine) })
  if (!lancer) {
    process.stdout.write(liste.join('\n') + (liste.length ? '\n' : ''))
    process.exit(0)
  }
  if (liste.length === 0) {
    console.log('Aucun test lié à ces fichiers.')
    process.exit(0)
  }
  const r = spawnSync('npx', ['vitest', 'run', ...liste], { stdio: 'inherit', shell: true })
  process.exit(r.status ?? 1)
}
