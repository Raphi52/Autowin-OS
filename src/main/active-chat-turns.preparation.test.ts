import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ActiveChatTurns } from './active-chat-turns'

/**
 * FAUX « Réponse interrompue avant la fin » (conv-809 le 2026-09-23, puis conv-862 le 2026-09-26 :
 * « mais après il continue comme si de rien n'était »).
 *
 * L'écran demande toutes les 4 s au processus principal si une réponse tourne (`os:pilotChat:active`) ;
 * deux « non » de suite et il déclare la réponse interrompue. Or le principal ne répondait « oui »
 * qu'une fois le tour ENREGISTRÉ (`run-pilot-chat.ts`, `activeChatTurns.set`). Tout ce qui passe
 * avant était invisible — au premier message d'une conversation non classée, `runPilotChat`
 * (index.ts) interroge d'abord le MODÈLE pour ranger la conversation. Le tour démarrait ensuite pour
 * de vrai, dans une nouvelle bulle, sous le libellé « interrompue ».
 */
describe('une demande reçue compte comme en cours pendant sa préparation', () => {
  it('rangement du premier message compris, jusqu’à la vraie fin du tour', async () => {
    const turns = new ActiveChatTurns()
    let finirRangement!: () => void
    const rangement = new Promise<void>((resolve) => {
      finirRangement = resolve
    })
    let finirTour!: () => void
    const tour = new Promise<void>((resolve) => {
      finirTour = resolve
    })
    const controller = new AbortController()

    // Même ordre que runPilotChat : rangement (appel modèle), PUIS enregistrement du tour.
    const envoi = turns.trackPreparation('conv-1', async () => {
      await rangement
      turns.set('conv-1', controller, tour)
      await tour
      turns.delete('conv-1', controller)
      return 'fini'
    })

    // LE CAS : le rangement attend le modèle, rien n'est encore enregistré.
    expect(turns.get('conv-1')).toBeUndefined()
    expect(turns.isInFlight('conv-1')).toBe(true)

    finirRangement()
    await rangement
    expect(turns.get('conv-1')).toBeDefined()
    expect(turns.isInFlight('conv-1')).toBe(true)

    finirTour()
    await expect(envoi).resolves.toBe('fini')
    expect(turns.isInFlight('conv-1')).toBe(false)
  })

  it('libère la conversation quand la préparation échoue', async () => {
    const turns = new ActiveChatTurns()
    await expect(
      turns.trackPreparation('conv-1', async () => {
        throw new Error('rangement en échec')
      })
    ).rejects.toThrow('rangement en échec')
    expect(turns.isInFlight('conv-1')).toBe(false)
  })

  it('reste en cours tant qu’une autre demande de la même conversation se prépare', async () => {
    const turns = new ActiveChatTurns()
    let finirPremiere!: () => void
    const premiere = turns.trackPreparation(
      'conv-1',
      () =>
        new Promise<void>((resolve) => {
          finirPremiere = resolve
        })
    )
    let finirSeconde!: () => void
    const seconde = turns.trackPreparation(
      'conv-1',
      () =>
        new Promise<void>((resolve) => {
          finirSeconde = resolve
        })
    )

    finirPremiere()
    await premiere
    expect(turns.isInFlight('conv-1')).toBe(true)

    finirSeconde()
    await seconde
    expect(turns.isInFlight('conv-1')).toBe(false)
  })

  it('ne touche ni les autres conversations ni les tours enregistrés', async () => {
    const turns = new ActiveChatTurns()
    let finir!: () => void
    const envoi = turns.trackPreparation(
      'conv-1',
      () =>
        new Promise<void>((resolve) => {
          finir = resolve
        })
    )
    expect(turns.isInFlight('conv-2')).toBe(false)
    // La préparation n'est pas un tour : l'attente d'inactivité du Watchdog n'en est pas changée.
    await expect(turns.waitForIdle(0)).resolves.toBe(true)
    turns.releaseIdleLease()
    finir()
    await envoi
  })

  it('ignore un identifiant de conversation absent ou vide', async () => {
    const turns = new ActiveChatTurns()
    await expect(turns.trackPreparation(undefined, async () => 1)).resolves.toBe(1)
    await expect(turns.trackPreparation('  ', async () => 2)).resolves.toBe(2)
  })
})

/** Câblage : le seul point que l'exécution ci-dessus n'atteint pas, `runPilotChat` étant une closure de index.ts. */
describe('câblage dans index.ts', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')

  it('runPilotChat enveloppe le rangement ET le lancement du tour', () => {
    const pilote = source.slice(source.indexOf('const runPilotChat: typeof lancerTour'))
    // Le lancement AVEC rangement : `await lancerTour` (le rangement tourne a cote, conv-867).
    const entete = pilote.slice(0, pilote.indexOf('return await lancerTour(...args)'))
    expect(entete).toContain('activeChatTurns.trackPreparation(args[2]')
    expect(entete.indexOf('trackPreparation')).toBeLessThan(
      entete.indexOf('rangerSurLePremierMessage')
    )
  })

  it('la sonde de l’écran et l’état de l’agent lisent la même vérité', () => {
    expect(source).toContain('return { active: activeChatTurns.isInFlight(conversationId) }')
    expect(source).toContain(
      'bus.tourDeChatActif = (conversationId) => activeChatTurns.isInFlight(conversationId)'
    )
  })
})
