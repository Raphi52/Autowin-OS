// @vitest-environment happy-dom
/**
 * Capsule « Image envoyée » ALLUMÉE comme l'image lue (conv-178, 2026-10-10 : « t'as modifié le
 * style de la capsule image lue mais pas celle d'image envoyée »).
 *
 * Les deux capsules partagent les mêmes règles ; ce qui les séparait, c'est l'ÉTAT. Pendant un tour,
 * Raisonnement, Actions et l'image lue portent `is-live` (bord vif, texte clair) ; l'image envoyée
 * restait toujours `is-done` (bord à 55 %, texte adouci), même pendant le tour qu'elle déclenchait.
 * Désormais elle suit le tour qu'elle a lancé : allumée tant que la réponse court, pâlie ensuite,
 * comme l'image lue du même tour.
 *
 * Entrées qui doivent faire échouer : une image envoyée éteinte pendant que sa réponse court, une
 * image envoyée restée allumée sur tout l'historique, ou un message suivi d'une autre question de
 * l'utilisateur pris pour un tour en cours.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import { tourDuMessageEnCours } from './chat-message-keys'
import type { Msg } from './chat-view-types'

const PNG_1PX =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII='

const question = {
  role: 'user',
  content: 'regarde',
  turnId: 't1',
  attachments: [{ name: 'image.png', mimeType: 'image/png', size: 68, turnId: 't1', content: PNG_1PX }]
} as unknown as Msg

const reponse = (done: boolean): Msg =>
  ({ role: 'assistant', content: '', parts: [], done, turnId: 't1' }) as unknown as Msg

async function capsuleEnvoyee(tourEnCours: boolean): Promise<Element | null> {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(
      createElement(ChatMessageRow, { message: question, conversationId: 'A', tourEnCours } as never)
    )
  })
  const trouve = host.querySelector('.attachment-list.sent .artifact-capsule')
  const copie = trouve ? (trouve.cloneNode(true) as Element) : null
  await act(async () => root.unmount())
  host.remove()
  return copie
}

describe('capsule « Image envoyée »', () => {
  it('est allumée pendant le tour qu elle a lancé, comme l image lue', async () => {
    const capsule = await capsuleEnvoyee(true)
    expect(capsule?.classList.contains('is-live')).toBe(true)
    expect(capsule?.classList.contains('is-done')).toBe(false)
  })

  it('pâlit une fois le tour fini', async () => {
    const capsule = await capsuleEnvoyee(false)
    expect(capsule?.classList.contains('is-done')).toBe(true)
    expect(capsule?.classList.contains('is-live')).toBe(false)
  })
})

describe('tourDuMessageEnCours', () => {
  it('suit la réponse de l agent qui suit le message', () => {
    expect(tourDuMessageEnCours([question, reponse(false)], 0, false)).toBe(true)
    expect(tourDuMessageEnCours([question, reponse(true)], 0, true)).toBe(false)
  })

  it('sans réponse encore, suit l occupation de la conversation', () => {
    expect(tourDuMessageEnCours([question], 0, true)).toBe(true)
    expect(tourDuMessageEnCours([question], 0, false)).toBe(false)
  })

  it('ne prend pas un message suivi d un autre message de l utilisateur pour un tour en cours', () => {
    expect(tourDuMessageEnCours([question, question, reponse(false)], 0, true)).toBe(false)
  })
})
