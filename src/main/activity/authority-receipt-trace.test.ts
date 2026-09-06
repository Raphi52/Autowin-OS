import { describe, expect, it } from 'vitest'
import { authorityReceiptToTraceEvent, receiptFromAnnotations } from './authority-receipt-trace'

const base = {
  id: 'turn-1:action:0:command:authority',
  conversationId: 'conv-1',
  turnId: 'turn-1',
  timestamp: '2026-09-06T18:00:00.000Z',
  sequence: 3,
  mode: 'auto' as const
}

describe('recu d autorite', () => {
  it('classe une commande en lecture seule comme non mutante et autorisee', () => {
    const receipt = receiptFromAnnotations({ readOnlyHint: true, destructiveHint: false }, 'auto')
    expect(receipt).toMatchObject({
      mutates: false,
      commandAuthority: 'automatic',
      decision: 'allow'
    })
  })

  /*
   * DEFAUT PRUDENT. Une commande sans annotation ne doit PAS passer pour inoffensive : sur-declarer
   * le risque se voit dans Observatory, le sous-declarer se tait.
   */
  it('traite une commande NON annotee comme mutante', () => {
    expect(receiptFromAnnotations(undefined, 'auto')).toMatchObject({
      mutates: true,
      commandAuthority: 'sensitive'
    })
  })

  it('exige une confirmation pour une commande destructrice', () => {
    expect(
      receiptFromAnnotations({ readOnlyHint: false, destructiveHint: true }, 'auto').decision
    ).toBe('confirm')
  })

  /*
   * L'evenement doit franchir `assertTraceEvent`, qui refuse l'enveloppe hors de la combinaison
   * exacte type/acteur/canal/frontiere. C'est CE controle qui rendait le recu impossible a ecrire
   * par inadvertance — et qui l'a laisse absent de toute la production jusqu'au 2026-09-06.
   */
  it('produit un evenement accepte par le contrat de trace', () => {
    const event = authorityReceiptToTraceEvent({
      ...base,
      command: 'get_state',
      annotations: { readOnlyHint: true, destructiveHint: false }
    })
    expect(event.type).toBe('decision')
    expect(event.actor.id).toBe('autowin-authority')
    expect(event.observation.boundary).toBe('app-command-bus')
    // Le libelle du destinataire est ce qu'Observatory affiche en tete du recu.
    expect(event.recipient?.label).toBe('get_state')
    expect(event.authority).toMatchObject({ mutates: false, decision: 'allow' })
  })

  it('rattache le recu a l appel de commande', () => {
    const event = authorityReceiptToTraceEvent({
      ...base,
      parentId: 'turn-1:action:0:command',
      command: 'edit_file'
    })
    expect(event.parentId).toBe('turn-1:action:0:command')
  })

  /*
   * LE CAS DESTRUCTIF. Une commande mutante ET destructive fait basculer la politique sur
   * « confirm », et le contrat exige alors decisionId + issue. Sans eux l'evenement est REFUSE et,
   * l'appelant avalant l'erreur, le recu disparait pour remove_conversation,
   * remove_conversations, edit_file et desktop_act — les quatre commandes les plus a risque.
   */
  it('emet aussi le recu d une commande DESTRUCTIVE, avec son issue', () => {
    const event = authorityReceiptToTraceEvent({
      ...base,
      command: 'remove_conversations',
      annotations: { readOnlyHint: false, destructiveHint: true }
    })
    expect(event.authority).toMatchObject({
      mutates: true,
      commandAuthority: 'destructive',
      decision: 'confirm',
      resolution: 'approve',
      resolvedBy: 'user'
    })
    expect(event.authority?.decisionId).toBeTruthy()
    expect(event.status).toBe('completed')
  })
})
