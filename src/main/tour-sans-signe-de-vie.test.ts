import { describe, expect, it } from 'vitest'
import { zoneDuTourDeChat } from './source-process-principal.test-helpers'
import { estCoupureVeilleur, motifInactivite } from './chat-turn-arret'

/**
 * UN TOUR QUI NE FINIT JAMAIS NE DOIT PAS RESTER SILENCIEUX.
 *
 * Vécu deux fois par l'utilisateur le même jour : `conv-1181` le matin, `conv-1242` le soir. Toutes
 * deux figées en statut `streaming`, contenu « [a exécuté orchestrate] », action `ok: null` — ni
 * réponse, ni erreur, ni moyen de savoir que c'était mort. Sa demande : « ma dernière convers in app
 * a encore foiré, répare pour les prochains prompts ».
 *
 * Les quatre gardes de forme posées le même jour ne peuvent RIEN ici : elles s'arment à la FIN d'un
 * tour, et ce tour n'en a pas. Il fallait donc surveiller l'ABSENCE de signe de vie.
 *
 * Test de SOURCE, pis-aller assumé : ce module construit toute l'application au chargement, donc
 * l'invoquer demanderait de booter Electron. Il vérifie le câblage — armement, remise à zéro,
 * extinction — pas l'effet. La mesure sur l'app reste l'autorité.
 */
// La ZONE du tour de chat, pas un chemin : le veilleur a quitte `index.ts` pour
// `chat/run-pilot-chat.ts`, et ces trois controles rougissaient sans qu'aucun cablage n'ait change
// -- c'est ce faux vert qui a laisse passer la coupure muette de conv-136 (2026-09-02).
const source = zoneDuTourDeChat()

describe('veilleur d’inactivité du tour de chat', () => {
  it('tout évènement du pilote compte comme un SIGNE DE VIE', () => {
    // Sans cette remise à zéro, un tour actif mais long serait coupé — on tuerait du travail réel.
    const handler = source.slice(source.indexOf('const handlePilotEvent'))
    expect(handler.slice(0, 200)).toContain('dernierSigneDeVie = Date.now()')
  })

  it('coupe avec un motif NOMMÉ, jamais un arrêt muet', () => {
    // Un tour qui s'arrête sans dire pourquoi reproduit le défaut qu'on corrige.
    // Le motif vit desormais dans `chat-turn-arret.ts`, PREFIXE : c'est ce prefixe qui le
    // requalifie en echec au lieu de le laisser passer pour une annulation volontaire. Une chaine
    // ecrite a la main ici ne serait plus reconnue, et le motif repartirait a la poubelle.
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).toContain('controller.abort(motifInactivite(PLAFOND_INACTIVITE_MS))')
    expect(motifInactivite(20 * 60 * 1000)).toContain('aucun signe de vie depuis 20 minutes')
    expect(estCoupureVeilleur(motifInactivite(20 * 60 * 1000))).toBe(true)
  })

  it('laisse une marge LARGE : on distingue « long » de « mort »', () => {
    // Une orchestration légitime peut travailler longtemps ; le veilleur ne doit pas la brider.
    expect(source).toContain('PLAFOND_INACTIVITE_MS = 20 * 60 * 1000')
  })

  it('ne SURVIT jamais à son tour', () => {
    // Un minuteur orphelin couperait un tour suivant — pire que le défaut d'origine.
    const teardown = source.slice(
      source.indexOf('} finally {', source.indexOf('const handlePilotEvent'))
    )
    expect(teardown.slice(0, 300)).toContain('clearInterval(veilleur)')
  })
})
