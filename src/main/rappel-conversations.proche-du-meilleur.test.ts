import { describe, expect, it } from 'vitest'
import { rappelDesEchangesPasses } from './rappel-conversations'
import type { ConversationRecherche } from './store/conversations'

/**
 * APRES LA 1re, SEULES LES CONVERSATIONS PROCHES DU MEILLEUR SONT RAPPELEES (conv-889, 2026-09-30).
 *
 * Mesure sur le corpus reel (`scripts/mesure-rappel-selectif.mts`) : le 2e rappele est juste 9 fois
 * sur 100, le 3e jamais. Un seuil a 80 % du meilleur score retire 45 % de ces inutiles pour une cible
 * perdue sur 37.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST SI LE FILTRE SAUTE : une 2e conversation a 50 % du meilleur.
 */
function resultat(id: string, score: number): ConversationRecherche {
  return {
    id,
    title: `titre ${id}`,
    provider: 'claude',
    updatedAt: 0,
    messageCount: 2,
    extraits: [{ role: 'user', ts: 0, extrait: `extrait de ${id}` }],
    score
  }
}
const rappelSur = (resultats: ConversationRecherche[]): string =>
  rappelDesEchangesPasses({ search: () => resultats }, 'pastilles', 'conv-courante', 'claude')

describe('rappel — proche du meilleur', () => {
  it('ecarte une 2e conversation loin du meilleur score', () => {
    const rendu = rappelSur([resultat('conv-1', 1), resultat('conv-2', 0.5)])
    expect(rendu).toContain('conv-1')
    expect(rendu).not.toContain('conv-2')
  })

  it('garde une 2e conversation proche du meilleur', () => {
    const rendu = rappelSur([resultat('conv-1', 1), resultat('conv-2', 0.85)])
    expect(rendu).toContain('conv-2')
  })

  it('garde une 2e conversation qui DEPASSE la 1re (le re-classement par mot porteur peut inverser)', () => {
    const rendu = rappelSur([resultat('conv-1', 0.4), resultat('conv-2', 0.9)])
    expect(rendu).toContain('conv-1')
    expect(rendu).toContain('conv-2')
  })

  it('le seuil se mesure au 1er MONTRE, apres exclusion de la conversation courante', () => {
    // La courante a le meilleur score mais n'est pas montree : la reference devient conv-1.
    const rendu = rappelSur([
      resultat('conv-courante', 10),
      resultat('conv-1', 1),
      resultat('conv-2', 0.9)
    ])
    expect(rendu).toContain('conv-1')
    expect(rendu).toContain('conv-2')
    expect(rendu).not.toContain('conv-courante')
  })
})
