import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * CÂBLAGE de l'enchaînement auto du CHAT dans `runPilotChat` (closure locale de index.ts, que
 * l'exécution ne peut pas atteindre). Le comportement lui-même — quels fichiers partent, lesquels
 * restent — est joué sur de vrais dépôts git dans chat-turn-publication.test.ts.
 *
 * Avant conv-871 (2026-09-26), l'interrupteur « Enchaînement auto » ne publiait QUE les tâches
 * d'agent : 1 commit sur 64 poussé tout seul en deux jours, tout le travail du chat attendait un clic.
 */
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
const pilote = source.slice(source.indexOf('const runPilotChat: typeof lancerTour'))
const corps = pilote.slice(0, pilote.indexOf('startupRecoverableChatCalls'))

describe('enchaînement auto du chat — câblage de fin de tour', () => {
  it('photographie l arbre AVANT le tour, seulement quand l interrupteur est actif', () => {
    expect(corps).toMatch(
      /os\.autoCloseEnabled\(\)\s*\?\s*await photographierDebutDeTour\(dossierDuTour\(conversationId\)\)/
    )
    expect(corps.indexOf('photographierDebutDeTour(')).toBeLessThan(
      corps.indexOf('await lancerTour(...args)')
    )
  })

  it('publie seulement un tour réussi et non arrêté, sans faire attendre la réponse', () => {
    const apres = corps.slice(corps.indexOf('await lancerTour(...args)'))
    expect(apres).toMatch(/if \(debutPublication && resultat\.ok && !resultat\.cancelled\)/)
    expect(apres).toMatch(/void os\s*\.publishChatTurn\(/)
    expect(apres).not.toMatch(/await os\s*\.publishChatTurn\(/)
    expect(apres).toContain('turnId: resultat.turnId')
  })
})
