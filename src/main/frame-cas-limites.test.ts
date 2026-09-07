/**
 * Garde de HANDOFF frame -> terrain : un cadrage qui decrit une ENTREE utilisateur sans enumerer
 * ses cas limites ne part pas tel quel a la phase suivante.
 *
 * Mesure qui justifie la garde (banc `arena-bench-ax3`, 2026-09-07, 3 repliques par bras, une
 * vague, meme critere comportemental de 30 assertions) : enonce SANS cas limites = 0 vert / 3
 * (drapeau repete avale en silence 3x, pile Node sur valeur hors plage 2x) ; enonce AVEC la liste
 * = 3 verts / 3. Separation parfaite, p = 0,10 (plancher a n=3).
 */
import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  casLimitesEnumeres,
  enteteCasLimitesManquants,
  sortieFrameAvecCasLimites
} from './frame-cas-limites'

const BESOIN_ENTREE = `## Besoin
Rendre sure la fenetre d'observation de \`scripts/dogfood-veille.mjs\` : le drapeau \`--jours\`
accepte aujourd'hui n'importe quoi.
- [ ] toute valeur invalide sort en code non nul — preuve : node check.mjs
`

const CAS = `### Cas limites d'entree
- \`--jours\` absent : defaut 7, code 0.
- \`--jours\` sans valeur : refus, code 2, aucune pile Node.
- \`--jours abc\` : refus, code 2.
- \`--jours 0\` / \`-3\` : refus, jamais un rapport vert silencieux.
`

describe('frame-cas-limites — la garde de handoff', () => {
  it('ne voit AUCUN cas limite dans un besoin qui decrit une entree', () => {
    expect(casLimitesEnumeres(BESOIN_ENTREE)).toHaveLength(0)
  })

  it('BLOQUE le passage : la sortie portee est prefixee d un refus nomme', () => {
    const sortie = sortieFrameAvecCasLimites(BESOIN_ENTREE)
    expect(sortie).not.toBe(BESOIN_ENTREE)
    expect(sortie).toMatch(/Cas limites d'entree/i)
    expect(sortie.indexOf('⛔')).toBeLessThan(sortie.indexOf('## Besoin'))
  })

  it('renvoie le cadrage a `frame` — le blocage ROUTE, il ne se contente pas d avertir', () => {
    expect(sortieFrameAvecCasLimites(BESOIN_ENTREE)).toMatch(/SUITE:\s*frame/)
  })

  it('LAISSE PASSER un cadrage qui enumere ses cas limites (>= 3)', () => {
    const bon = `${BESOIN_ENTREE}\n${CAS}`
    expect(casLimitesEnumeres(bon).length).toBeGreaterThanOrEqual(3)
    expect(enteteCasLimitesManquants(bon)).toBeUndefined()
    expect(sortieFrameAvecCasLimites(bon)).toBe(bon)
  })

  it('BLOQUE une rubrique presente mais maigre (2 cas)', () => {
    const maigre = `${BESOIN_ENTREE}\n### Cas limites d'entree\n- \`--jours abc\` : refus.\n- \`--jours 0\` : refus.\n`
    expect(enteteCasLimitesManquants(maigre)).toMatch(/3/)
  })

  it('LAISSE PASSER un besoin sans aucune entree utilisateur', () => {
    const sansEntree = `## Besoin\nRenommer le dossier de sortie du graphe.\n- [ ] le dossier porte le nouveau nom\n`
    expect(enteteCasLimitesManquants(sansEntree)).toBeUndefined()
  })

  it('LAISSE PASSER une dispense EXPLICITE et motivee', () => {
    const dispense = `${BESOIN_ENTREE}\nCas limites : sans objet — le drapeau est produit par le script appelant.\n`
    expect(enteteCasLimitesManquants(dispense)).toBeUndefined()
  })

  it('ne lit QUE la section ## Besoin — des cas ecrits sous ## Contraintes ne comptent pas', () => {
    expect(enteteCasLimitesManquants(`${BESOIN_ENTREE}\n## Contraintes\n${CAS}`)).toBeDefined()
  })

  it('est IDEMPOTENT : une sortie deja bloquee ne se prefixe pas deux fois', () => {
    const une = sortieFrameAvecCasLimites(BESOIN_ENTREE)
    expect(sortieFrameAvecCasLimites(une)).toBe(une)
  })

  it('reste ACCROCHE dans le trajet de phase de l orchestrateur (frame seulement)', () => {
    const src = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')
    expect(src).toMatch(/sortieFrameAvecCasLimites/)
    expect(src).toMatch(/phase === 'frame'/)
  })
})
