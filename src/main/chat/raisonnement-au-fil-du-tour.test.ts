/**
 * Le bloc « Raisonnement » d'un tour EN COURS ne doit plus être vide après un rechargement de la vue
 * (conv-1110, 2026-10-23 : « conv-1097 m'affiche raisonnement et rien dedans »).
 *
 * Entrées qui feraient échouer une correction fausse : la pensée réécrite EN ENTIER à la clôture
 * (elle se dédoublerait, le réducteur concatène) ; un espace entre deux rafales perdu ; un tour qui
 * échoue sans que la dernière rafale soit écrite.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { reduceChatTurn, type ChatTurnState } from '../../shared/chat-turn'
import { hydrateStoredAssistant } from '../../renderer/src/components/chat-view-model'
import { ecrivainDeRaisonnement } from './raisonnement-au-fil-du-tour'

function tourEnCours(): { etat: () => ChatTurnState; ecrire: (portion: string) => void } {
  let etat: ChatTurnState = { turnId: 't1', status: 'streaming', parts: [] }
  return {
    etat: () => etat,
    ecrire: (portion) => {
      etat = reduceChatTurn(etat, { kind: 'reasoning', text: portion })
    }
  }
}

describe('raisonnement écrit au fil du tour', () => {
  it("le tour encore en cours porte déjà sa pensée dès que le modèle passe à l'action", () => {
    const tour = tourEnCours()
    const ecrivain = ecrivainDeRaisonnement(tour.ecrire)
    for (const text of ['\n"Je valide" conf', 'irms my', ' last rec', 'ommendation.'])
      ecrivain.recevoir({ kind: 'reasoning', text })
    expect(tour.etat().reasoning).toBeUndefined()
    ecrivain.recevoir({ kind: 'provider-status', text: 'Bash · npm test' })
    expect(tour.etat().status).toBe('streaming')
    // Ce que l'écran relit après un rechargement, AVANT la fin du tour :
    const relu = hydrateStoredAssistant({
      content: '',
      status: 'streaming',
      parts: [],
      reasoning: tour.etat().reasoning
    } as never)
    expect(relu.reasoning).toBe('"Je valide" confirms my last recommendation.')
  })

  it('écrit une fois par rafale, jamais le texte entier deux fois', () => {
    const tour = tourEnCours()
    const ecritures: string[] = []
    const ecrivain = ecrivainDeRaisonnement((portion) => {
      ecritures.push(portion)
      tour.ecrire(portion)
    })
    ecrivain.recevoir({ kind: 'reasoning', text: 'Je lis le' })
    ecrivain.recevoir({ kind: 'reasoning', text: ' fichier.' })
    ecrivain.recevoir({ kind: 'command', text: undefined })
    ecrivain.recevoir({ kind: 'action-progress', text: '5 s' })
    ecrivain.recevoir({ kind: 'reasoning', text: ' Puis je corrige.' })
    ecrivain.recevoir({ kind: 'delta', text: 'Corrigé.' })
    ecrivain.recevoir({ kind: 'done' })
    ecrivain.vider()
    expect(ecritures).toEqual(['Je lis le fichier.', ' Puis je corrige.'])
    expect(tour.etat().reasoning).toBe('Je lis le fichier. Puis je corrige.')
    expect(ecrivain.texte).toBe('Je lis le fichier. Puis je corrige.')
  })

  it("un reste fait d'espaces attend la rafale suivante au lieu d'être perdu", () => {
    const tour = tourEnCours()
    const ecrivain = ecrivainDeRaisonnement(tour.ecrire)
    ecrivain.recevoir({ kind: 'reasoning', text: 'Premier.' })
    ecrivain.recevoir({ kind: 'provider-status', text: 'Read' })
    ecrivain.recevoir({ kind: 'reasoning', text: '\n\n' })
    ecrivain.recevoir({ kind: 'provider-status', text: 'Read terminé' })
    ecrivain.recevoir({ kind: 'reasoning', text: 'Second.' })
    ecrivain.vider()
    expect(tour.etat().reasoning).toBe('Premier.\n\nSecond.')
  })

  it("un tour qui échoue en pleine pensée l'écrit quand même (vider à l'arrêt)", () => {
    const tour = tourEnCours()
    const ecrivain = ecrivainDeRaisonnement(tour.ecrire)
    ecrivain.recevoir({ kind: 'reasoning', text: 'Je réfléchis encore' })
    ecrivain.vider()
    ecrivain.vider()
    expect(tour.etat().reasoning).toBe('Je réfléchis encore')
  })
})

/**
 * CÂBLAGE (contrat de source, même idiome que run-pilot-chat.orientation.test.ts) : le tour de chat
 * passe chaque événement à l'écrivain, vide l'attente à l'échec, et n'écrit plus la pensée ENTIÈRE à
 * la clôture — sinon elle serait dédoublée dans le store.
 */
describe('câblage dans run-pilot-chat.ts', () => {
  const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
  it("chaque événement du pilote passe par l'écrivain de raisonnement", () => {
    expect(source).toMatch(/raisonnementDuTour\.recevoir\(pilotEvent\)/)
  })
  it('la clôture et l’échec vident ce qui attend, sans réécrire le texte entier', () => {
    expect(source.match(/raisonnementDuTour\.vider\(\)/g)?.length ?? 0).toBeGreaterThanOrEqual(2)
    expect(source).not.toMatch(/kind: 'reasoning',\s*text: raisonnement\s*\}/)
  })
})
