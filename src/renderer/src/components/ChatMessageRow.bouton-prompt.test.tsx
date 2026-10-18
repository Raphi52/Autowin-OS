// @vitest-environment happy-dom
/**
 * Bouton « prompter » d'un bloc html-render (conv-302, 2026-10-17 : « et faut un bouton pour
 * prompter au lieu du bloc ask »). Le clic sur un lien `#autowin-prompt` envoie son libellé par le
 * chemin d'une réponse `ask`, avec les MÊMES garde-fous que le bloc `ask` :
 *   - rien ne part tant que le tour court (ChatMessageRow.ask-attend-fin-de-tour) ;
 *   - un seul envoi, même au double-clic ;
 *   - le bloc reste fermé quand le fil contient déjà la réponse (`askReponse`).
 * Entrée qui ferait échouer une correction fausse : un clic qui change l'adresse de l'app, ou un
 * envoi pendant le tour (perdu à la fermeture du tour, comme le vivait le bloc `ask`).
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

const TEXTE =
  'Voici la galerie.\n\n```html-render\n<div><a href="#autowin-prompt">Affiner la 3 · Éditorial</a>' +
  '<a href="#ailleurs">ailleurs</a></div>\n```\n'

let hote: HTMLDivElement
let racine: Root

async function rendre(options: {
  done: boolean
  askReponse?: string
  onAnswerAsk?: (p: string) => void
}) {
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  const message = {
    role: 'assistant',
    content: '',
    parts: [{ kind: 'text', text: TEXTE }],
    done: options.done,
    messageId: 'm1',
    turnId: 't1'
  } as unknown as Msg
  await act(async () => {
    racine.render(
      createElement(ChatMessageRow, {
        message,
        conversationId: 'A',
        askReponse: options.askReponse,
        onAnswerAsk: options.onAnswerAsk
      } as never)
    )
  })
  const bouton = hote.querySelector<HTMLAnchorElement>(
    '[data-testid="chat-inline-html"] a[href="#autowin-prompt"]'
  )
  expect(bouton, 'le bouton doit passer le filtre du fil').not.toBeNull()
  return bouton as HTMLAnchorElement
}

function cliquer(element: Element): MouseEvent {
  const clic = new MouseEvent('click', { bubbles: true, cancelable: true })
  element.dispatchEvent(clic)
  return clic
}

afterEach(async () => {
  await act(async () => racine.unmount())
  hote.remove()
})

describe('bouton « prompter » d’un bloc html-render', () => {
  it('envoie son libellé visible, une seule fois, sans toucher à l’adresse de l’app', async () => {
    const envoi = vi.fn()
    const bouton = await rendre({ done: true, onAnswerAsk: envoi })
    expect(bouton.closest('.msg-body')?.getAttribute('data-prompts')).toBe('ouverts')
    let clic!: MouseEvent
    await act(async () => {
      clic = cliquer(bouton)
      cliquer(bouton)
    })
    expect(envoi).toHaveBeenCalledTimes(1)
    expect(envoi).toHaveBeenCalledWith('Affiner la 3 · Éditorial')
    expect(clic.defaultPrevented).toBe(true)
    expect(bouton.closest('.msg-body')?.getAttribute('data-prompts')).toBe('fermes')
  })

  it('n’envoie rien pendant le tour', async () => {
    const envoi = vi.fn()
    const bouton = await rendre({ done: false, onAnswerAsk: envoi })
    expect(bouton.closest('.msg-body')?.getAttribute('data-prompts')).toBe('fermes')
    let clic!: MouseEvent
    await act(async () => {
      clic = cliquer(bouton)
    })
    expect(envoi).not.toHaveBeenCalled()
    expect(clic.defaultPrevented).toBe(true)
  })

  it('reste fermé quand le fil contient déjà la réponse', async () => {
    const envoi = vi.fn()
    const bouton = await rendre({
      done: true,
      askReponse: 'Affiner la 3 · Éditorial',
      onAnswerAsk: envoi
    })
    await act(async () => {
      cliquer(bouton)
    })
    expect(envoi).not.toHaveBeenCalled()
  })

  it('laisse passer les autres liens du bloc', async () => {
    const envoi = vi.fn()
    await rendre({ done: true, onAnswerAsk: envoi })
    const lien = hote.querySelector('a[href="#ailleurs"]') as Element
    const clic = cliquer(lien)
    expect(envoi).not.toHaveBeenCalled()
    expect(clic.defaultPrevented).toBe(false)
  })
})
