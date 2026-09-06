import { describe, expect, it } from 'vitest'
import { runPreflight, type PreflightProbes } from './preflight'

/*
 * POURQUOI : quand un `conversations.json` illisible est mis de cote, l'application s'ouvre sur un
 * historique VIDE. Sans un mot A L'ECRAN, l'utilisateur conclut a une perte de ses conversations —
 * alors que le fichier est intact, juste a cote. L'avertissement ne vivait que dans la console.
 */
const sondes: PreflightProbes = {
  pingBrain: async () => true,
  hasBin: async () => true,
  claudeSession: () => 'authenticated',
  hasBrainToken: () => true,
  hasBrainRuntime: () => true
}

describe('diagnostic de demarrage : conversations mises de cote', () => {
  it('ne dit rien quand rien n a ete ecarte — le cas normal reste silencieux', async () => {
    const resultat = await runPreflight(sondes)

    expect(resultat.ok).toBe(true)
    expect(resultat.checks.some((c) => c.id === 'conversations-ecartees')).toBe(false)
  })

  it('nomme le fichier conserve, EN PREMIER, et dit que rien n a ete supprime', async () => {
    const chemin = 'D:/profil/conversations.json.illisible-2026-09-06T16-58-54-642Z'

    const resultat = await runPreflight(sondes, { conversationsEcartees: [chemin] })

    // En tete : c'est ce que l'utilisateur doit lire avant tout le reste.
    expect(resultat.checks[0]?.id).toBe('conversations-ecartees')
    expect(resultat.ok).toBe(false)
    // Le chemin ENTIER, pas un resume : c'est le geste de restauration lui-meme.
    expect(resultat.checks[0]?.detail).toContain(chemin)
    expect(resultat.checks[0]?.detail).toMatch(/supprim/i)
    expect(resultat.summary).toContain('Historique des conversations')
  })
})
