import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CHAT_INACTIVITE_ABORT_PREFIX,
  estCoupureVeilleur,
  motifInactivite,
  terminalDuTour
} from './chat-turn-arret'

/**
 * MESURE conv-136, 2026-09-02 — le défaut que ces tests interdisent.
 *
 * Un tour lance une orchestration ; elle travaille 25 min (1 508 365 ms mesurées). Le veilleur
 * d'inactivité la croit morte à 20 min et coupe le tour AVEC un motif nommé. L'utilisateur n'a
 * jamais lu ce motif : le `catch` ne requalifiait que la coupure BUDGET, donc cet arrêt devenait
 * `cancelled` et le texte du tour retombait sur les étiquettes d'action. Le fil affichait
 * « [a exécuté orchestrate] » — ni réponse, ni erreur. Le run, lui, a fini VERT 5 min plus tard.
 *
 * Deux causes, deux séries de tests : la requalification de l'arrêt (ici) et le battement de vie
 * de l'orchestration (plus bas, sur la source de `commands.ts`).
 */
describe('arrêt d’un tour de chat — un motif machine n’est jamais une annulation', () => {
  it('la coupure du veilleur finit `failed` AVEC son motif, pas `cancelled`', () => {
    const reason = motifInactivite(20 * 60 * 1000)
    const terminal = terminalDuTour({ aborted: true, reason })
    expect(terminal.kind).toBe('failed')
    // Le motif doit VOYAGER : c'est le seul texte que l'utilisateur lira à la place d'une bulle muette.
    expect(terminal.kind === 'failed' && terminal.error).toContain('aucun signe de vie')
    expect(terminal.kind === 'failed' && terminal.error).toContain('20 minutes')
  })

  it('un stop VOLONTAIRE reste `cancelled` — on ne transforme pas un choix en panne', () => {
    // `activeChatTurns.abort(conversationId, 'user')` : le bouton stop du fil.
    expect(terminalDuTour({ aborted: true, reason: 'user' })).toEqual({ kind: 'cancelled' })
    expect(terminalDuTour({ aborted: true, reason: 'conversation-deleted' })).toEqual({
      kind: 'cancelled'
    })
  })

  it('la coupure BUDGET, déjà requalifiée par l’appelant, garde son motif', () => {
    const terminal = terminalDuTour({
      aborted: true,
      reason: 'budget du tour dépassé : USD 2 dépassés',
      motivee: true
    })
    expect(terminal).toEqual({
      kind: 'failed',
      error: 'budget du tour dépassé : USD 2 dépassés'
    })
  })

  it('sans abort, l’erreur levée est l’échec — et son message survit', () => {
    expect(
      terminalDuTour({ aborted: false, reason: undefined, erreur: new Error('502 amont') })
    ).toEqual({ kind: 'failed', error: '502 amont' })
  })

  it('le préfixe reconnaît le motif du veilleur, et lui seul', () => {
    expect(estCoupureVeilleur(motifInactivite(1_200_000))).toBe(true)
    expect(estCoupureVeilleur(CHAT_INACTIVITE_ABORT_PREFIX)).toBe(true)
    expect(estCoupureVeilleur('user')).toBe(false)
    expect(estCoupureVeilleur(undefined)).toBe(false)
  })
})

/**
 * CÂBLAGE — pis-aller assumé sur la SOURCE.
 *
 * `run-pilot-chat.ts` construit tout le tour (providers, store, journal, superviseur) : l'invoquer
 * demanderait de booter l'application. Ces deux tests vérifient donc que la décision pure ci-dessus
 * est bien celle qu'utilise le tour, et que le motif remonte à l'appelant. La mesure sur l'app
 * reste l'autorité.
 */
describe('câblage du tour de chat', () => {
  const source = (): string => readFileSync(join(__dirname, 'chat', 'run-pilot-chat.ts'), 'utf8')

  it('le veilleur coupe avec le motif PRÉFIXÉ, pas une chaîne libre', () => {
    // Une chaîne écrite à la main ici ne serait plus reconnue par `estCoupureVeilleur` : le
    // défaut d'origine reviendrait sans qu'aucun test ne bouge.
    expect(source()).toContain('controller.abort(motifInactivite(PLAFOND_INACTIVITE_MS))')
  })

  it('l’état terminal vient de `terminalDuTour`, et le motif est RENDU à l’appelant', () => {
    const src = source()
    expect(src).toContain('const terminal = terminalDuTour({')
    // Le `return` d'échec doit couvrir le veilleur AUSSI, pas seulement le budget.
    expect(src).toContain('if (coupureMotivee)')
  })
})

/**
 * SIGNE DE VIE — l'autre cause, celle qui déclenchait la coupure.
 *
 * `onProgress` n'était branché que sur `run` et `verify` : compté le 2026-09-02, 13 occurrences
 * dans `commands.ts`, aucune dans le bloc `case 'orchestrate'`. Une orchestration n'émettait donc
 * RIEN vers le tour pendant tout son travail, et le veilleur la prenait pour morte.
 */
describe('l’orchestration bat un signe de vie vers le tour', () => {
  it('chaque phase appelle `onProgress` depuis le rappel de `runTask`', () => {
    const src = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    const debutCas = src.indexOf("case 'orchestrate': {")
    expect(debutCas).toBeGreaterThan(0)
    const rappel = src.indexOf('const r = await this.os.runTask(', debutCas)
    expect(rappel).toBeGreaterThan(debutCas)
    // La fenêtre couvre le rappel de phase, pas tout le fichier : un `onProgress` d'un autre
    // `case` (run, verify) ne doit pas suffire à faire passer ce test.
    const corpsDuRappel = src.slice(rappel, rappel + 2000)
    expect(corpsDuRappel).toContain('onProgress?.(')
    expect(corpsDuRappel).toContain('phase ${step.step}')
  })
})
