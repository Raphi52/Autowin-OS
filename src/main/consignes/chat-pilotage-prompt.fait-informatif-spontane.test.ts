import { describe, expect, it } from 'vitest'
import { buildChatPilotagePrompt } from './chat-pilotage-prompt'

/**
 * TROU MESURÉ (conv-1543) : l'utilisateur énonce un fait durable SANS demander de le retenir
 * (« je suis sur l'app dev, faut juste push sur main normalement »). Le bloc MÉMOIRE ne couvrait
 * que deux déclencheurs : « quand TU viens d'établir » et « si l'utilisateur te DEMANDE de
 * retenir ». Un fait informatif spontané ne tombait dans aucun des deux, donc rien n'était retenu.
 *
 * Le prompt est construit avec un catalogue VIDE : la prose doit porter la règle toute seule, la
 * signature de commande ne peut pas répondre à sa place.
 */
const proseSeule = (): string => buildChatPilotagePrompt([])

describe('le bloc MÉMOIRE couvre le fait informatif énoncé spontanément', () => {
  it('nomme le déclencheur « informatif » sans demande explicite de retenir', () => {
    const prompt = proseSeule()
    expect(prompt).toContain('INFORMATIF SPONTANÉ')
    expect(prompt).toContain('sans te demander de le retenir')
  })

  it('donne le critère de tri (durable/réutilisable) plutôt qu’un « retiens tout »', () => {
    const prompt = proseSeule()
    expect(prompt).toContain('vaudra encore dans 3 mois')
    // Le contre-exemple doit rester présent : un statut du moment ne se retient pas.
    expect(prompt).toContain('un statut du moment')
  })

  it('exige de le DIRE au lieu de retenir en silence', () => {
    expect(proseSeule()).toContain('dis-le en une ligne')
  })
})
