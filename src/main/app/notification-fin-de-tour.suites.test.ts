import { describe, expect, it, vi } from 'vitest'
import {
  contenuDeNotificationDeFinDeTour,
  creerNotifieurDeFinDeTour,
  libelleDeBouton,
  type ContenuNotification,
  type NotificationAffichable
} from './notification-fin-de-tour'

/**
 * LES SUITES PROPOSÉES, CLIQUABLES DEPUIS LA NOTIFICATION (conv-1038, 2026-10-21).
 *
 * La notification de fin de tour ne savait qu'ouvrir le fil. Les suites notées du tour
 * (`AUTOWIN_PROMPT_V1:`, les mêmes que les boutons de la saisie, lues par `extrairePropositionsSuite`)
 * deviennent ses boutons : un clic envoie la suite dans CE fil, sans rouvrir l'app.
 *
 * Les entrées qui feraient échouer une version fausse :
 *  - une suite de PUBLICATION que la demande n'a pas évoquée (« commite et pousse ») : elle ne doit
 *    jamais devenir un bouton — un clic distrait publierait ;
 *  - trois suites : deux boutons, les MIEUX notées, dans l'ordre des notes ;
 *  - un tour en échec : aucun bouton, seulement le clic qui ouvre le fil.
 */

const AVEC_SUITES = [
  'Le carnet du fil est en place.',
  '',
  'AUTOWIN_PROMPT_V1: [60] Relis le carnet sur un fil long',
  'AUTOWIN_PROMPT_V1: [90] Lance le juge sur les sept idées',
  'AUTOWIN_PROMPT_V1: [75] Construis l’idée 6 en mosaïque'
].join('\n')

const BASE = {
  ok: true,
  cancelled: false,
  text: AVEC_SUITES,
  titreDuFil: 'Refonte du chat',
  fenetreRegardee: false,
  instanceDeTest: false,
  tourDeFond: false,
  demandeDuTour: 'construis le carnet du fil'
}

describe('contenuDeNotificationDeFinDeTour — les suites deviennent des boutons', () => {
  it('les deux suites les mieux notées, dans l’ordre des notes', () => {
    expect(contenuDeNotificationDeFinDeTour(BASE)?.suites).toEqual([
      'Lance le juge sur les sept idées',
      'Construis l’idée 6 en mosaïque'
    ])
  })

  // La ligne technique sert aux boutons ; dans le corps de la bulle, elle serait du bruit.
  it('la ligne technique des suites n’entre jamais dans le texte de la bulle', () => {
    expect(contenuDeNotificationDeFinDeTour(BASE)?.body).toBe('Le carnet du fil est en place.')
  })

  it('un libellé de bouton trop long est coupé, la suite envoyée reste entière', () => {
    const longue = `Reprends ${'le travail '.repeat(10)}`.trim()
    const texte = `Fait.\nAUTOWIN_PROMPT_V1: [80] ${longue}`
    const contenu = contenuDeNotificationDeFinDeTour({ ...BASE, text: texte })
    expect(contenu?.suites).toEqual([longue])
    expect(libelleDeBouton(longue).length).toBeLessThanOrEqual(40)
    expect(libelleDeBouton(longue).endsWith('…')).toBe(true)
    expect(libelleDeBouton('Relis le diff')).toBe('Relis le diff')
  })

  it('une publication que la demande n’a pas évoquée ne devient jamais un bouton', () => {
    const texte = [
      'Fait.',
      'AUTOWIN_PROMPT_V1: [95] Commite et pousse sur main',
      'AUTOWIN_PROMPT_V1: [70] Relis le diff'
    ].join('\n')
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, text: texte })?.suites).toEqual([
      'Relis le diff'
    ])
  })

  it('tour en échec : aucun bouton', () => {
    const contenu = contenuDeNotificationDeFinDeTour({ ...BASE, ok: false, error: 'boom' })
    expect(contenu?.suites).toBeUndefined()
  })

  it('aucune suite proposée : le contenu reste celui d’avant, sans champ vide', () => {
    expect(contenuDeNotificationDeFinDeTour({ ...BASE, text: 'Rien à proposer.' })).toEqual({
      title: 'Refonte du chat — réponse prête',
      body: 'Rien à proposer.',
      fil: 'Refonte du chat',
      issue: 'prete'
    })
  })
})

/** Fausse notification qui distingue le clic sur la bulle du clic sur un bouton. */
function fausse(): {
  fabrique: (contenu: ContenuNotification) => NotificationAffichable
  creees: Array<{
    contenu: ContenuNotification
    fermee: boolean
    cliquer: () => void
    bouton: (index: number) => void
  }>
} {
  const creees: Array<{
    contenu: ContenuNotification
    fermee: boolean
    cliquer: () => void
    bouton: (index: number) => void
  }> = []
  return {
    creees,
    fabrique: (contenu) => {
      const entree = { contenu, fermee: false, cliquer: () => {}, bouton: (_index: number) => {} }
      creees.push(entree)
      return {
        show: () => {},
        close: () => {
          entree.fermee = true
        },
        on: (evenement: string, ecouteur: (details?: { actionIndex?: number }) => void) => {
          if (evenement === 'click') entree.cliquer = () => ecouteur()
          if (evenement === 'action')
            entree.bouton = (index: number) => ecouteur({ actionIndex: index })
        }
      } as NotificationAffichable
    }
  }
}

describe('creerNotifieurDeFinDeTour — un bouton envoie sa suite dans CE fil', () => {
  function notifieur(): {
    faux: ReturnType<typeof fausse>
    envoyerSuite: ReturnType<typeof vi.fn>
    ouvrirFil: ReturnType<typeof vi.fn>
    notifier: ReturnType<typeof creerNotifieurDeFinDeTour>
  } {
    const faux = fausse()
    const envoyerSuite = vi.fn()
    const ouvrirFil = vi.fn()
    const notifier = creerNotifieurDeFinDeTour({
      fabrique: faux.fabrique,
      fenetreRegardee: () => false,
      instanceDeTest: false,
      titreDuFil: () => 'Refonte du chat',
      ouvrirFil,
      envoyerSuite
    })
    return { faux, envoyerSuite, ouvrirFil, notifier }
  }

  it('le second bouton envoie la seconde suite, sans ouvrir le fil', () => {
    const { faux, envoyerSuite, ouvrirFil, notifier } = notifieur()
    notifier('conv-42', { ok: true, cancelled: false, text: AVEC_SUITES, demandeDuTour: 'x' })
    expect(faux.creees[0].contenu.suites).toHaveLength(2)
    faux.creees[0].bouton(1)
    expect(envoyerSuite).toHaveBeenCalledWith('conv-42', 'Construis l’idée 6 en mosaïque')
    expect(ouvrirFil).not.toHaveBeenCalled()
  })

  it('un index de bouton hors liste n’envoie rien', () => {
    const { faux, envoyerSuite, notifier } = notifieur()
    notifier('conv-42', { ok: true, cancelled: false, text: AVEC_SUITES, demandeDuTour: 'x' })
    faux.creees[0].bouton(5)
    expect(envoyerSuite).not.toHaveBeenCalled()
  })

  it('le clic sur la bulle ouvre toujours le fil', () => {
    const { faux, ouvrirFil, notifier } = notifieur()
    notifier('conv-42', { ok: true, cancelled: false, text: AVEC_SUITES, demandeDuTour: 'x' })
    faux.creees[0].cliquer()
    expect(ouvrirFil).toHaveBeenCalledWith('conv-42')
  })
})
