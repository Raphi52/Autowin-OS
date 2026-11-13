import { describe, expect, it, vi } from 'vitest'
import { ConversationStore } from '../store/conversations'
import {
  composerMessageDeReprise,
  etatDeRepriseDuFil,
  filsCoupesALire,
  type FilLu
} from './reprise-fil-apres-quota'

/**
 * LES FILS QUE LA REPRISE RELIT AVEC LEURS MESSAGES.
 *
 * Seul un fil dont le dernier tour est une coupure par le quota peut être repris. Le résumé le dit
 * (`dernierTourCoupeParQuota`), donc la reprise ne relit l'historique que de ces fils-là.
 *
 * Ce qui ferait échouer ces tests : un drapeau absent du résumé, une relecture de l'historique de
 * chaque fil, ou un fil écarté alors que la reprise l'aurait repris avec un état.
 */

const COUPE_A = Date.parse('2026-11-01T10:00:00+01:00')
const MAINTENANT = COUPE_A + 60_000
const MUR = "You've hit your 5-hour limit · resets 11pm (Europe/Paris)"

/** Chaque appel avance d'une milliseconde, à partir de l'heure de la coupure. */
function horloge(): () => number {
  let t = COUPE_A
  return () => t++
}

/** Un store avec des fils de chaque sorte : coupés par le quota (avec ou sans suite) et les autres. */
function magasinDeCas(): { store: ConversationStore; ids: Record<string, string> } {
  const store = new ConversationStore(horloge())
  const ids: Record<string, string> = {}
  const tourEchoue = (nom: string, error: string, demande = 'corrige a.ts'): string => {
    const fil = store.create({ title: nom, provider: 'claude' })
    const turnId = `tour-${nom}`
    store.beginTurn(
      fil.id,
      { content: demande },
      { turnId, runtime: { provider: 'claude', ouvertDepuisLeChat: true } }
    )
    store.applyTurnEvent(fil.id, turnId, { kind: 'failed', error })
    ids[nom] = fil.id
    return fil.id
  }

  // Coupé par le quota : repris (ou annoncé à reprendre) selon la suite.
  tourEchoue('coupe', MUR)
  store.append(tourEchoue('coupeAvecConsigne', MUR), {
    role: 'user',
    content: 'fais aussi b.ts',
    orientation: true
  })
  // Un essai automatique a déjà été écrit avant cette coupure : la reprise n'en refait pas.
  tourEchoue('essaiFait', MUR, composerMessageDeReprise())
  store.marquerInactive(tourEchoue('inactive', MUR), true)

  // Pas coupé par le quota : aucune reprise possible, quel que soit son historique.
  store.append(tourEchoue('repriseParUtilisateur', MUR), { role: 'user', content: 'reprends' })
  tourEchoue('autreErreur', 'TypeError: boom')
  const terminee = store.create({ title: 'terminee', provider: 'claude' })
  store.append(terminee.id, { role: 'user', content: 'question' })
  store.append(terminee.id, { role: 'assistant', content: 'réponse' })
  ids.terminee = terminee.id

  return { store, ids }
}

const decisions = (fils: readonly FilLu[]): [string, unknown][] =>
  fils
    .map(
      (fil) =>
        [
          fil.id,
          etatDeRepriseDuFil({
            fil,
            maintenant: MAINTENANT,
            planDeLots: () => false,
            runAReprendre: () => false
          })
        ] as [string, unknown]
    )
    .filter(([, etat]) => etat !== undefined)

describe('filsCoupesALire — la reprise ne relit que les fils coupés par le quota', () => {
  it('le résumé dit quels fils ont été coupés par le quota à leur dernier tour', () => {
    const { store, ids } = magasinDeCas()

    const drapeaux = Object.fromEntries(
      store.listResumes().map((resume) => [resume.id, resume.dernierTourCoupeParQuota === true])
    )

    expect(drapeaux).toEqual({
      [ids.coupe]: true,
      [ids.coupeAvecConsigne]: true,
      [ids.essaiFait]: true,
      [ids.inactive]: true,
      [ids.repriseParUtilisateur]: false,
      [ids.autreErreur]: false,
      [ids.terminee]: false
    })
  })

  it('ne charge avec ses messages que les fils coupés, jamais la liste complète', () => {
    const { store, ids } = magasinDeCas()
    const liste = vi.spyOn(store, 'listAvecMessages')
    const lecture = vi.spyOn(store, 'get')

    const relus = filsCoupesALire(store).map((fil) => fil.id)

    const coupes = [ids.coupe, ids.coupeAvecConsigne, ids.essaiFait, ids.inactive]
    expect(liste).not.toHaveBeenCalled()
    expect(lecture.mock.calls.map(([id]) => id).sort()).toEqual([...coupes].sort())
    expect(relus.sort()).toEqual([...coupes].sort())
  })

  it('ne décide pas autrement : chaque fil qui a un état de reprise le garde par la lecture réduite', () => {
    const { store } = magasinDeCas()

    const parLaLectureReduite = decisions(filsCoupesALire(store))
    const parLaListeComplete = decisions(store.listAvecMessages())

    // Sans cette borne, deux listes vides seraient égales : le cas doit contenir de vraies décisions.
    expect(parLaListeComplete.map(([, etat]) => (etat as { etat: string }).etat).sort()).toEqual([
      'attente',
      'attente',
      'essai-rate',
      'manuelle'
    ])
    expect(parLaLectureReduite).toEqual(parLaListeComplete)
  })
})
