import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

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
const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

describe('veilleur d’inactivité du tour de chat', () => {
  it('tout évènement du pilote compte comme un SIGNE DE VIE', () => {
    // Sans cette remise à zéro, un tour actif mais long serait coupé — on tuerait du travail réel.
    const handler = source.slice(source.indexOf('const handlePilotEvent'))
    expect(handler.slice(0, 200)).toContain('dernierSigneDeVie = Date.now()')
  })

  it('coupe avec un motif NOMMÉ, jamais un arrêt muet', () => {
    // Un tour qui s'arrête sans dire pourquoi reproduit le défaut qu'on corrige.
    const compact = source.replace(/\s+/g, ' ')
    expect(compact).toContain('aucun signe de vie depuis')
    expect(compact).toMatch(/controller\.abort\(\s*`Tour interrompu/)
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
