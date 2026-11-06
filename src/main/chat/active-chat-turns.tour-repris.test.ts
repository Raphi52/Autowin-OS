import { describe, expect, it } from 'vitest'
import { ActiveChatTurns } from './active-chat-turns'

/*
 * TOUR REPRIS APRÈS REDÉMARRAGE : il occupe le fil comme un tour normal, et se distingue d'un tour
 * normal pour que l'envoi ordinaire (`os:pilotChat`) puisse le refuser.
 *
 * Vécu le 2026-10-11 (conv-260) : le CLI du tour 2d8540b1, lancé à 22:29, a survécu au redémarrage
 * de 22:43 ; le message suivant de l'utilisateur a ouvert un SECOND claude.exe sur la même session.
 */
describe('ActiveChatTurns — tours repris après redémarrage', () => {
  it('un tour repris occupe le fil et se reconnaît comme repris', () => {
    const tours = new ActiveChatTurns()
    const reprise = new AbortController()
    tours.setRecovered('conv-260', reprise, new Promise(() => {}))

    expect(tours.isInFlight('conv-260')).toBe(true)
    expect(tours.isRecovering('conv-260')).toBe(true)
    // Une autre conversation n'est pas touchée.
    expect(tours.isRecovering('conv-1')).toBe(false)
  })

  it('un tour ORDINAIRE n’est jamais pris pour un tour repris (l’enchaînement normal reste libre)', () => {
    const tours = new ActiveChatTurns()
    tours.set('conv-260', new AbortController(), new Promise(() => {}))

    expect(tours.isInFlight('conv-260')).toBe(true)
    expect(tours.isRecovering('conv-260')).toBe(false)
  })

  it('le rejeu d’un tour repris (tour ordinaire posé par-dessus) laisse le fil « repris » jusqu’à la fin de la reprise', () => {
    const tours = new ActiveChatTurns()
    const reprise = new AbortController()
    const rejeu = new AbortController()
    tours.setRecovered('conv-260', reprise, new Promise(() => {}))
    tours.set('conv-260', rejeu, new Promise(() => {}))

    tours.delete('conv-260', rejeu)
    expect(tours.isRecovering('conv-260')).toBe(true)

    tours.delete('conv-260', reprise)
    expect(tours.isRecovering('conv-260')).toBe(false)
    expect(tours.isInFlight('conv-260')).toBe(false)
  })

  it('un contrôleur libéré puis réutilisé comme tour ordinaire n’est plus marqué repris', () => {
    const tours = new ActiveChatTurns()
    const controleur = new AbortController()
    tours.setRecovered('conv-260', controleur, new Promise(() => {}))
    tours.delete('conv-260', controleur)
    tours.set('conv-260', controleur, new Promise(() => {}))

    expect(tours.isRecovering('conv-260')).toBe(false)
  })
})
