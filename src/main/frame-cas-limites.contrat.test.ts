/**
 * CONTRAT — la garde du pipeline (`frame-cas-limites.ts`) et le controle en ligne de commande
 * (`scripts/frame-cas-limites-check.mjs`) appliquent la MEME regle.
 *
 * Deux implementations existent parce que l'une est bundlee dans le process principal et l'autre
 * doit tourner sous `node` seul, sans TypeScript. Le prix de ce doublon, c'est la derive : une
 * regle durcie d'un cote et pas de l'autre laisserait passer en run ce que le controle refuse.
 * Ce test rend la derive ROUGE au lieu de silencieuse.
 */
import { describe, expect, it } from 'vitest'
import { enteteCasLimitesManquants } from './frame-cas-limites'
// Le controle CLI lui-meme (module .mjs), mis a l'epreuve contre la garde du pipeline.
import { verifierCasLimites } from '../../scripts/frame-cas-limites-check.mjs'

const BESOIN = `## Besoin
Le drapeau \`--jours\` accepte n'importe quoi.
`
const CAS = `### Cas limites d'entree
- absent : defaut 7.
- vide : refus code 2.
- non numerique : refus code 2.
`

const CAS_DE_FIGURE: Array<[string, string, boolean]> = [
  ['entree sans aucun cas limite', BESOIN, false],
  ['entree avec 3 cas limites', `${BESOIN}\n${CAS}`, true],
  ['rubrique maigre (2 cas)', `${BESOIN}\n### Cas limites\n- a : refus.\n- b : refus.\n`, false],
  ['rubrique vide', `${BESOIN}\n### Cas limites d'entree\n`, false],
  ['aucune entree utilisateur', '## Besoin\nRenommer le dossier de sortie du graphe.\n', true],
  [
    'dispense motivee',
    `${BESOIN}\nCas limites : sans objet — drapeau produit par le script appelant.\n`,
    true
  ],
  ['cas ecrits hors du besoin', `${BESOIN}\n## Contraintes\n${CAS}`, false]
]

describe('contrat garde pipeline <-> controle CLI', () => {
  it.each(CAS_DE_FIGURE)('%s : meme verdict des deux cotes', (_nom, texte, attendu) => {
    const pipelinePasse = enteteCasLimitesManquants(texte) === undefined
    const cliPasse = verifierCasLimites(texte).tenu
    expect(pipelinePasse).toBe(attendu)
    expect(cliPasse).toBe(attendu)
  })
})
