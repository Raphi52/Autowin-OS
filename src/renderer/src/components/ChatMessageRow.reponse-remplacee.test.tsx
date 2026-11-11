// @vitest-environment happy-dom
/**
 * RÉPONSE REMPLACÉE PAR UNE RELANCE, REPLIÉE DANS LE FIL (2026-11-11) : l'ancienne réponse ne
 * disparaît plus sans trace. Elle se montre repliée à sa place, et la nouvelle réponse se lit en dessous.
 *
 * Entrées qui feraient échouer une correction fausse :
 *  - aucun bloc replié (la réponse remplacée a disparu, comme avant) ;
 *  - le bloc ouvert par défaut (il prendrait la place de la nouvelle réponse) ;
 *  - le bloc placé après la nouvelle réponse (ordre d'écriture inversé) ;
 *  - le texte remplacé mêlé au corps de la nouvelle réponse.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'
import type { ChatPart } from './chat-view-model'
;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const DEBUT = 1_790_000_000_000

async function rendre(message: Record<string, unknown>): Promise<Element> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(ChatMessageRow, {
        message: message as unknown as Msg,
        conversationId: 'conv-test'
      } as never)
    )
  })
  const copie = host.querySelector('.msg.assistant')!.cloneNode(true) as Element
  await act(async () => root.unmount())
  host.remove()
  return copie
}

const texte = (streamId: string, text: string): ChatPart => ({
  kind: 'text',
  streamId,
  text,
  at: DEBUT
})
const action: ChatPart = { kind: 'action', name: 'Bash', actionId: 'a1', ok: true, at: DEBUT }

const message = (parts: ChatPart[], reponsesRemplacees: unknown[]): Record<string, unknown> => ({
  role: 'assistant',
  content: '',
  turnId: 't1',
  done: true,
  status: 'completed',
  debutDuTour: DEBUT,
  parts,
  reponsesRemplacees
})

describe('réponse remplacée par une relance, repliée dans le fil', () => {
  it('se montre repliée, avant la nouvelle réponse, sans se confondre avec elle', async () => {
    const tour = await rendre(
      message(
        [texte('1:0', 'Le chiffre est 17, vérifié.')],
        [{ rang: 0, parts: [{ kind: 'text', streamId: '0:0', text: 'Le chiffre est 42.' }] }]
      )
    )
    const repliee = tour.querySelector('details.msg-remplacee')
    expect(repliee, 'la réponse remplacée doit rester visible').not.toBeNull()
    expect(repliee?.hasAttribute('open'), 'repliée par défaut').toBe(false)
    expect(repliee?.querySelector('summary')?.textContent).toBe('Réponse remplacée par une relance')
    expect(repliee?.textContent).toContain('Le chiffre est 42.')

    const nouvelle = Array.from(tour.querySelectorAll('.msg-body')).find(
      (corps) => corps.closest('.msg-remplacee') === null
    )
    expect(nouvelle?.textContent).toBe('Le chiffre est 17, vérifié.')
    expect(
      repliee!.compareDocumentPosition(nouvelle!) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
  })

  it('se place à son rang : après la part qui la précède, avant celle qui la suit', async () => {
    const tour = await rendre(
      message(
        [texte('0:0', 'Début.'), action, texte('2:0', 'Fin.')],
        [{ rang: 2, parts: [{ kind: 'text', streamId: '1:0', text: 'Ancien milieu.' }] }]
      )
    )
    const repliee = tour.querySelector('details.msg-remplacee')!
    const debut = Array.from(tour.querySelectorAll('.msg-body')).find((corps) =>
      corps.textContent?.includes('Début.')
    )!
    const fin = Array.from(tour.querySelectorAll('.msg-body')).find((corps) =>
      corps.textContent?.includes('Fin.')
    )!
    expect(debut.compareDocumentPosition(repliee) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(repliee.compareDocumentPosition(fin) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
})
