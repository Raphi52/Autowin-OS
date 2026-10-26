import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  annoncerFinDeTour,
  issueDeCloture,
  suivreLaFinDuTour,
  verdictVeilleurInactivite,
  type RunPilotChat
} from './run-pilot-chat'

/*
 * conv-1069, candidat 3 : une règle `task_create` « quand le tour de conv-N est terminé » attend un
 * événement que personne n'émettait. L'entrée qui ferait échouer ces tests si la correction était
 * fausse : un tour qui finit sans rien annoncer, ou qui l'annonce AVANT de quitter les tours actifs
 * (l'agent réveillé lirait alors « il tourne encore » avec `pilotChatActive`).
 */
describe('annoncerFinDeTour', () => {
  it('annonce la fin du tour, avec son fil et son identifiant', () => {
    const notifyAppEvent = vi.fn(async () => {})
    annoncerFinDeTour({ notifyAppEvent }, 'conv-1065', 'tour-42')
    expect(notifyAppEvent).toHaveBeenCalledTimes(1)
    const [evenement, contexte, fil] = notifyAppEvent.mock.calls[0] as unknown as string[]
    expect(evenement).toBe('chat-turn-done')
    expect(fil).toBe('conv-1065')
    // L'identifiant du tour distingue deux fins successives (sinon l'anti-rafale les fusionne).
    expect(contexte).toContain('tour-42')
    expect(contexte).toContain('conv-1065')
  })
  it('sans moteur de réveil ou s’il échoue, le tour se ferme quand même', async () => {
    expect(() => annoncerFinDeTour(undefined, 'conv-1065', 'tour-42')).not.toThrow()
    const echec = vi.fn(async () => {
      throw new Error('moteur indisponible')
    })
    expect(() => annoncerFinDeTour({ notifyAppEvent: echec }, 'conv-1065', 'tour-42')).not.toThrow()
    await Promise.resolve()
    expect(echec).toHaveBeenCalledTimes(1)
  })
  it('est appelé dans le `finally` du tour, APRÈS sa sortie des tours actifs', () => {
    const source = readFileSync(join(__dirname, 'run-pilot-chat.ts'), 'utf8')
    const fin = source.slice(source.indexOf('    } finally {\n      tourClos = true'))
    const sortie = fin.indexOf('activeChatTurns.delete(conversationId, controller)')
    const annonce = fin.indexOf('annoncerFinDeTour(deps.watchdogEngine(), conversationId, turnId)')
    expect(sortie).toBeGreaterThan(0)
    expect(annonce).toBeGreaterThan(sortie)
  })
})

/*
 * conv-1150 — le coordinateur des plans de lots apprend la fin de CHAQUE tour, avec son issue.
 * L'entrée qui ferait échouer ces tests : une issue sans l'échec, l'arrêt ou le texte du tour, ou
 * un tour qui échoue sans être annoncé. OÙ l'annonce est branchée (autour de `trackPreparation`
 * dans index.ts) est gardé par `plans-de-lots.fin-de-tour.test.ts`.
 */
describe('issueDeCloture — tour repris clos sans rejeu (reprendreAppelChat, index.ts)', () => {
  it('sans signe de vie : agent PERDU (pas un résultat) ; arrêt, échec et fin gardent leur sens', () => {
    expect(issueDeCloture({ kind: 'interrupted' })).toMatchObject({ ok: false, perdu: true })
    expect(issueDeCloture({ kind: 'cancelled' })).toEqual({ ok: false, annule: true })
    expect(issueDeCloture({ kind: 'failed', error: 'code 1' })).toEqual({
      ok: false,
      erreur: 'code 1'
    })
    expect(issueDeCloture({ kind: 'done' })).toEqual({ ok: true })
  })
})

describe('suivreLaFinDuTour — l’issue du tour remise au coordinateur des plans', () => {
  it('un tour qui lève est annoncé en échec, puis l’erreur remonte intacte', async () => {
    const surFin = vi.fn()
    const leve: RunPilotChat = async () => {
      throw new Error('app pas prête')
    }
    const tour = suivreLaFinDuTour(leve, surFin)
    await expect(tour(undefined, [], 'conv-7')).rejects.toThrow('app pas prête')
    expect(surFin).toHaveBeenCalledWith('conv-7', { ok: false, erreur: 'app pas prête' })
  })

  it('rend l’issue complète : succès avec texte, échec, arrêt', async () => {
    const surFin = vi.fn()
    const issues: Array<Awaited<ReturnType<RunPilotChat>>> = [
      { ok: true, cancelled: false, turnId: 't1', text: 'Lot fait, code 0.' },
      { ok: false, cancelled: false, turnId: 't2', error: 'session limit' },
      { ok: false, cancelled: true, turnId: 't3' }
    ]
    for (const issue of issues) {
      const tour = suivreLaFinDuTour(async () => issue, surFin)
      expect(await tour(undefined, [], 'conv-8')).toBe(issue)
    }
    expect(surFin.mock.calls).toEqual([
      ['conv-8', { ok: true, tour: 't1', texte: 'Lot fait, code 0.' }],
      ['conv-8', { ok: false, tour: 't2', erreur: 'session limit' }],
      ['conv-8', { ok: false, tour: 't3', annule: true }]
    ])
  })

  it('sans fil, ou si l’observateur échoue, le tour rend son résultat intact', async () => {
    const issue = { ok: true, cancelled: false, turnId: 't1' }
    const casse = vi.fn(() => {
      throw new Error('coordinateur en panne')
    })
    const tour = suivreLaFinDuTour(async () => issue, casse)
    expect(await tour(undefined, [], 'conv-9')).toBe(issue)
    expect(await tour(undefined, [])).toBe(issue)
    expect(casse).toHaveBeenCalledTimes(1)
  })
})

describe('verdictVeilleurInactivite', () => {
  it('patiente tant que le plafond n est pas atteint', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 999, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('patienter')
  })
  it('coupe quand le plafond est atteint sans commande en vol', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 1000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 0, plafondMs: 1000 })
    ).toBe('couper')
  })
  it('signale une commande en vol meme au-dela du plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 5000, commandesEnVol: 1, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
  it('signale une commande en vol meme sous le plafond', () => {
    expect(
      verdictVeilleurInactivite({ inactifDepuisMs: 0, commandesEnVol: 2, plafondMs: 1000 })
    ).toBe('commande-en-vol')
  })
})
