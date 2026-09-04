import { describe, expect, it } from 'vitest'
import config from '../vitest.config'

/*
 * LE NETTOYEUR DE DOSSIERS TEMPORAIRES NE DOIT TOURNER QU'UNE FOIS, A LA TOUTE FIN.
 *
 * DEFAUT MESURE le 2026-09-04 : `extends: true` recopie `globalSetup` dans CHAQUE groupe de la
 * suite. Son teardown s'executait donc une fois PAR GROUPE — et celui d'`unite` (groupOrder 0)
 * finit en PREMIER, alors que `git-lourd` (groupOrder 1) tourne encore. Le nettoyeur ne regarde
 * que la date de naissance d'un dossier temporaire, jamais son usage en cours
 * (`tests/temp-cleanup.ts`) : il supprimait donc les depots git que `git-lourd` etait en train
 * d'utiliser. Symptomes : « fatal: Unable to read current working directory » sur
 * `git commit -q -m init`, et `finalize` rendant `merge-failed` la ou le test attend
 * `base-in-progress`. Des tests rouges PAR INTERMITTENCE, verts en isolation — on accusait le
 * code teste alors que la cause etait la configuration de la suite.
 *
 * LA CORRECTION N'EST PAS de neutraliser l'heritage PARTOUT. Piege mesure le meme jour : des que
 * `projects` existe, vitest IGNORE le `globalSetup` de la racine — il ne s'executait donc QUE par
 * heritage. Le vider dans les deux groupes eteignait le nettoyage en entier (plus une seule ligne
 * « [nettoyage temporaire] » a la fin d'un run), remplacant un bug d'ordonnancement par une fuite
 * de disque. Le teardown reste donc sur le SEUL groupe joue en DERNIER : il tourne une fois, quand
 * plus rien d'autre ne travaille.
 */
describe('nettoyage des dossiers temporaires — un seul teardown, joué en dernier', () => {
  const racine = (config as { test: Record<string, unknown> }).test
  const groupes = racine.projects as {
    test: { name: string; globalSetup?: unknown; sequence?: { groupOrder?: number } }
  }[]
  const heritent = groupes.filter((g) => g.test.globalSetup === undefined)

  it('la racine declare bien le teardown de nettoyage', () => {
    expect(racine.globalSetup).toContain('./tests/global-nettoyage-temp.ts')
  })

  it('un seul groupe porte le teardown — sinon il range le bac des autres en cours de route', () => {
    expect(groupes.length).toBeGreaterThan(1)
    expect(heritent.map((g) => g.test.name)).toHaveLength(1)
  })

  it('ce groupe est celui joué en DERNIER', () => {
    const dernier = [...groupes].sort(
      (a, b) => (b.test.sequence?.groupOrder ?? 0) - (a.test.sequence?.groupOrder ?? 0)
    )[0]
    expect(heritent[0].test.name).toBe(dernier.test.name)
  })
})
