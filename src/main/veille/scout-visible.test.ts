import { describe, expect, it, vi } from 'vitest'
import { genererCandidatsEnConversation } from './scout-visible'
import { lireStockVeille } from './candidats-store'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

/**
 * « Le bouton doit lancer une conversation VISIBLE » (utilisateur, 13/08) : le scout interne tourne
 * comme un tour de conversation via le runtime des tâches planifiées — pas comme un CLI muet.
 */
const params = {
  racineDepot: 'C:/depot',
  racineDonnees: 'C:/donnees',
  binding: { provider: 'claude', model: 'sonnet' }
}

const SORTIE_VALIDE =
  '[{"titre":"Vue coût par rôle","url":"src/main/dashboards/cost.ts:42","dateSource":"2026-08-13","citation":"const parRole = new Map<string, number>()","langue":"fr","pertinence":80}]'

function runtime(reponse: { ok: boolean; cancelled?: boolean; error?: string; text?: string }): {
  createConversation: ReturnType<typeof vi.fn>
  runPrompt: ReturnType<typeof vi.fn>
} {
  return {
    createConversation: vi.fn(() => ({ id: 'conv-scout' })),
    runPrompt: vi.fn(async () => reponse)
  }
}

describe('scout interne en conversation visible', () => {
  it('crée une conversation nommée, lance le tour en lecture seule, écrit le stock', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aos-scoutvis-'))
    const chemin = join(racine, 'stock.json')
    try {
      const rt = runtime({ ok: true, text: `voilà : ${SORTIE_VALIDE}` })
      const resultat = await genererCandidatsEnConversation({
        ...params,
        runtime: rt,
        chemin,
        maintenant: () => '2026-08-13T21:00:00.000Z'
      })
      expect(rt.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({ title: expect.stringContaining('[veille] scout interne') })
      )
      // Lecture seule et arrière-plan : un scout n'écrit rien et ne vole pas le focus.
      expect(rt.runPrompt).toHaveBeenCalledWith(
        'conv-scout',
        expect.stringContaining('DE L’INTÉRIEUR'),
        params.binding,
        expect.objectContaining({ readOnly: true, background: true })
      )
      expect(resultat.conversationId).toBe('conv-scout')
      expect(resultat.retenus).toBe(1)
      const stock = lireStockVeille(chemin)
      expect(stock.candidats[0]).toMatchObject({ concurrent: 'Autowin OS', type: 'ajout' })
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('un tour interrompu ou en échec JETTE en nommant la conversation — rien n’est écrit', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'aos-scoutvis2-'))
    const chemin = join(racine, 'stock.json')
    try {
      await expect(
        genererCandidatsEnConversation({
          ...params,
          runtime: runtime({ ok: true, cancelled: true }),
          chemin
        })
      ).rejects.toThrow(/interrompu.*conv-scout/)
      await expect(
        genererCandidatsEnConversation({
          ...params,
          runtime: runtime({ ok: false, error: 'provider mort' }),
          chemin
        })
      ).rejects.toThrow(/provider mort/)
      expect(lireStockVeille(chemin).candidats).toHaveLength(0)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('une réponse sans JSON JETTE une erreur nommée plutôt que d’écrire du vide', async () => {
    await expect(
      genererCandidatsEnConversation({
        ...params,
        runtime: runtime({ ok: true, text: 'rien d’exploitable' }),
        chemin: 'C:/nulle-part/stock.json'
      })
    ).rejects.toThrow(/illisible/)
  })

  it('un « [] » nu, sans synthèse d’exploration, est un ÉCHEC nommé — pas « 0 candidat »', async () => {
    // Mesuré sur conv-1154 : 717 tokens, 2,7 s, zéro outil — l'agent a rendu [] sans rien lire.
    await expect(
      genererCandidatsEnConversation({
        ...params,
        runtime: runtime({ ok: true, text: '[]' }),
        chemin: 'C:/nulle-part/stock.json'
      })
    ).rejects.toThrow(/vide sans exploration/)
  })
})
