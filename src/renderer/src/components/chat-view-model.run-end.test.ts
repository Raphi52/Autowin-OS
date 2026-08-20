import { describe, expect, it } from 'vitest'
import { settleOrchestrationOnRunEnd, type ChatPart } from './chat-view-model'

/**
 * LE SYMPTOME EXACT, rapporte le 20/08 : le fil affiche « 1 action en cours » alors que le panneau
 * Sous-agents est vide. Les deux surfaces ne lisent pas la meme chose — le badge se derive des parts
 * du tour, le panneau des runs vivants, vide a `orchestrate-end` — et rien ne les reconciliait.
 */
const orchestration = (ok?: boolean, interrupted?: boolean): ChatPart =>
  ({
    kind: 'action',
    name: 'orchestrate',
    ...(ok !== undefined ? { ok } : {}),
    ...(interrupted ? { interrupted } : {})
  }) as unknown as ChatPart

const texte = (t: string): ChatPart => ({ kind: 'text', text: t })

describe('settleOrchestrationOnRunEnd — le run fini donne son issue a l’action', () => {
  it('un run vert rend l’action réussie : plus rien « en cours »', () => {
    const parts = [texte('Je lance.'), orchestration()]
    const regle = settleOrchestrationOnRunEnd(parts, 'green')
    expect(regle).not.toBe(parts)
    expect(regle[1]).toMatchObject({ kind: 'action', name: 'orchestrate', ok: true })
  })

  it('un run rouge rend l’action échouée, il ne la laisse pas ouverte', () => {
    const regle = settleOrchestrationOnRunEnd([orchestration()], 'red')
    expect(regle[0]).toMatchObject({ ok: false })
  })

  it('ne retouche PAS une action qui a déjà son issue', () => {
    const parts = [orchestration(true)]
    expect(settleOrchestrationOnRunEnd(parts, 'red')).toBe(parts)
    const interrompue = [orchestration(undefined, true)]
    expect(settleOrchestrationOnRunEnd(interrompue, 'green')).toBe(interrompue)
  })

  it('rend le tableau TEL QUEL quand rien ne change — pas de rendu React inutile', () => {
    const sansOrchestration = [texte('bonjour')]
    expect(settleOrchestrationOnRunEnd(sansOrchestration, 'green')).toBe(sansOrchestration)
  })

  it('ne touche ni les autres actions, ni le texte du tour', () => {
    const verify = { kind: 'action', name: 'verify' } as unknown as ChatPart
    const regle = settleOrchestrationOnRunEnd([verify, orchestration(), texte('fin')], 'green')
    expect(regle[0]).toBe(verify)
    expect(regle[2]).toMatchObject({ kind: 'text', text: 'fin' })
  })

  it('sur un fan-out, règle la DERNIÈRE sans issue et laisse les autres — limite assumée', () => {
    const premiere = orchestration()
    const seconde = orchestration()
    const regle = settleOrchestrationOnRunEnd([premiere, texte('entre'), seconde], 'green')
    // La derniere recoit le statut du run qui vient de finir ; la premiere garde son etat, faute
    // d'un identifiant de run sur la part. Un chiffre trop haut vaut mieux qu'une issue fausse.
    expect(regle[2]).toMatchObject({ ok: true })
    expect(regle[0]).toBe(premiere)
  })
})
