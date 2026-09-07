import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/**
 * GARDE-FOU DETERMINISTE — aucun test ne doit RETRECIR une variable d'environnement partagee.
 *
 * `process.env` est PARTAGE par tous les fichiers de test qui tournent dans le meme worker vitest.
 * Un test qui vide `process.env.PATH` pour simuler une panne casse donc ses VOISINS pendant toute
 * la duree de sa fenetre, et seulement dans la suite complete — jamais en isolation, ce qui rend le
 * defaut tres cher a localiser.
 *
 * MESURE DU 2026-09-07 (conv-336) : `liveness-fingerprint.test.ts` vidait le PATH pour simuler une
 * panne de la sonde PowerShell. Consequence observee dans la suite complete :
 * `src/main/e2e-chaine.test.ts` echouait sur `spawnSync git ENOENT` et
 * `src/main/e2e-chaine.harness.test.ts` sur `git rev-parse refs/heads/HEAD`, alors que les deux
 * passent en isolation. Toute copie de travail isolee naissait ROUGE, ce qui refusait des editions
 * verifiees sans le moindre rapport avec elles.
 *
 * CE QUI RESTE PERMIS : AJOUTER au PATH (l'affectation cite `process.env.PATH` a droite) ne retire
 * rien a personne. Pour simuler une panne, il faut INJECTER la dependance en echec — les sondes du
 * projet acceptent deja leur implementation en parametre.
 */

function fichiersDeTest(racine: string): string[] {
  const trouves: string[] = []
  for (const entree of readdirSync(racine)) {
    const chemin = join(racine, entree)
    if (statSync(chemin).isDirectory()) trouves.push(...fichiersDeTest(chemin))
    else if (entree.endsWith('.test.ts') || entree.endsWith('.test.tsx')) trouves.push(chemin)
  }
  return trouves
}

/** Une affectation qui ne reinjecte pas la valeur courante REMPLACE la variable pour tout le worker. */
const AFFECTATION = /process\.env\.(PATH|Path)\s*=\s*([^\n]*)/g
const SUPPRESSION = /delete\s+process\.env\.(PATH|Path)\b/

describe('aucun test ne retrecit une variable d environnement partagee', () => {
  it('le PATH n est jamais vide ni remplace dans un fichier de test', () => {
    const coupables: string[] = []
    for (const fichier of fichiersDeTest(join(process.cwd(), 'src'))) {
      const source = readFileSync(fichier, 'utf8')
      for (const [entier, , droite] of source.matchAll(AFFECTATION)) {
        // Restaurer la valeur d'origine est le contraire d'une fuite : c'est le menage.
        if (/previousPath|ancienPath|pathInitial|pathAvant/.test(droite)) continue
        // Ajouter au PATH ne retire rien aux voisins.
        if (/process\.env\.(PATH|Path)/.test(droite)) continue
        coupables.push(`${fichier} :: ${entier.trim()}`)
      }
      if (SUPPRESSION.test(source) && !/previousPath|ancienPath/.test(source)) {
        coupables.push(`${fichier} :: delete process.env.PATH`)
      }
    }
    expect(coupables).toEqual([])
  })
})
