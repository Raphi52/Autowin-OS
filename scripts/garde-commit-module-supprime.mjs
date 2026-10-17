/**
 * GARDE-FOU PRE-COMMIT : un commit ne supprime pas un module que l'arbre commité importe encore.
 *
 * Mesuré le 2026-10-17 (conv-318, commit 06c5ede1) : un agent a fait `git add <ses 3 fichiers> &&
 * git commit` dans l'arbre partagé. L'index portait déjà les suppressions STAGÉES d'une autre
 * conversation (conv-305, retrait de `src/main/conversation-router.ts`), dont les importeurs
 * (`src/main/index.ts:168`, `src/main/ipc/conversations.ts:37`) n'étaient modifiés QUE dans l'arbre
 * de travail. Le commit a emporté les suppressions sans les importeurs : HEAD ne compilait plus, et
 * chaque copie de travail tirée de HEAD partait rouge. Réparé par 82e58f2d.
 *
 * Contrôle : pour chaque fichier source SUPPRIMÉ par le commit, cherche dans l'INDEX (ce qui sera
 * commité, pas l'arbre de travail) un `import … from`, `export … from`, `import(…)` ou `require(…)`
 * relatif qui le désigne encore. S'il en reste un, refus (code 1) avec la liste.
 *
 * Lancé par `.githooks/pre-commit` ; testé par `src/main/githooks-pre-commit.test.ts`.
 * Usage direct : `node scripts/garde-commit-module-supprime.mjs` dans un dépôt git.
 */
import { execFileSync } from 'node:child_process'
import { posix, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXTENSIONS = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/
const SPECIFICATEUR = /\b(?:from|import|require)\s*\(?\s*['"](\.{1,2}\/[^'"]*)['"]/g

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}

/** Chemin sans extension source, et sans `/index` final : la forme qu'un import relatif vise. */
function cible(chemin) {
  return chemin.replace(EXTENSIONS, '').replace(/\/index$/, '')
}

/** Les importeurs, dans l'index, de chaque fichier source supprimé par le commit. */
export function importeursRestants() {
  const supprimes = git(['diff', '--cached', '--name-only', '--diff-filter=D', '-z'])
    .split('\0')
    .filter((f) => EXTENSIONS.test(f) && !/\.d\.[cm]?ts$/.test(f))
  if (supprimes.length === 0) return []

  const visees = new Map(supprimes.map((f) => [cible(f), f]))
  const radicaux = [...new Set(supprimes.map((f) => posix.basename(cible(f))))]
  let lignes = ''
  try {
    lignes = git([
      'grep',
      '--cached',
      '-n',
      '-I',
      '-F',
      ...radicaux.flatMap((r) => ['-e', r]),
      '--',
      '*.ts',
      '*.tsx',
      '*.mts',
      '*.cts',
      '*.js',
      '*.jsx',
      '*.mjs',
      '*.cjs'
    ])
  } catch {
    return [] // git grep rend 1 quand rien ne correspond
  }

  const trouves = []
  for (const ligne of lignes.split('\n')) {
    const m = /^([^:]+):(\d+):(.*)$/.exec(ligne)
    if (!m) continue
    const [, importeur, numero, texte] = m
    for (const s of texte.matchAll(SPECIFICATEUR)) {
      const resolu = cible(posix.normalize(posix.join(posix.dirname(importeur), s[1])))
      const supprime = visees.get(resolu)
      if (supprime)
        trouves.push({ supprime, importeur, ligne: Number(numero), specificateur: s[1] })
    }
  }
  return trouves
}

// Comparaison par chemin du SYSTÈME : sous Windows, argv[1] porte des barres obliques inverses.
const lanceDirectement =
  Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (lanceDirectement) {
  const trouves = importeursRestants()
  if (trouves.length > 0) {
    process.stderr.write(
      [
        'COMMIT REFUSÉ : il supprime un module que le reste du commit importe encore — HEAD ne compilerait plus.',
        ...trouves.map(
          (t) =>
            `  ${t.supprime} supprimé, mais ${t.importeur}:${t.ligne} importe '${t.specificateur}'`
        ),
        "Cause habituelle (arbre partagé) : l'index portait les suppressions stagées d'une autre session.",
        'Commite seulement tes fichiers : git commit -m "…" -- <tes chemins>',
        'ou ajoute au commit la modification des importeurs.',
        ''
      ].join('\n')
    )
    process.exit(1)
  }
}
