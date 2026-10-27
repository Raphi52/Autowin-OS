// @vitest-environment happy-dom
/**
 * LA CARTE « LANCER EN N FILS » DANS UNE VRAIE LIGNE DE RÉPONSE (conv-1147, défaut D5).
 *
 * ChatMessageRow pose la réponse qui porte la carte (`message-du-fil.ts`) : son souvenir « déjà
 * lancée » lui est propre. Entrées qui feraient échouer un câblage faux : une ligne qui ne pose pas
 * la réponse (la clé retomberait sur la source, partagée), ou qui la pose pendant l'écriture (un
 * clic se souviendrait sous une clé provisoire).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'
import { cleDuLancement } from '../../../shared/lancer-en-fils'
import { EVT_LANCER_EN_FILS, type DemandeDeLancement } from './proposition-fils-evenements'

const SOURCE = JSON.stringify({
  taches: [
    { titre: 'A', demande: 'fais A', fichiers: ['src/a.ts'] },
    { titre: 'B', demande: 'fais B', fichiers: ['src/b.ts'] }
  ]
})
const TEXTE = `Deux tâches.\n\n\`\`\`aw-fils\n${SOURCE}\n\`\`\`\n`

let hote: HTMLDivElement
let racine: Root
let recues: DemandeDeLancement[] = []
const ecouter = (event: Event): void => {
  recues.push((event as CustomEvent<DemandeDeLancement>).detail)
}

const message = (done: boolean, messageId?: string): Msg =>
  ({
    role: 'assistant',
    content: '',
    parts: [{ kind: 'text', text: TEXTE }],
    done,
    ...(messageId ? { messageId } : {}),
    turnId: 't1'
  }) as unknown as Msg

const dessiner = async (m: Msg): Promise<void> => {
  await act(async () => {
    racine.render(createElement(ChatMessageRow, { message: m, conversationId: 'A' } as never))
  })
}

function boutonLancer(): HTMLButtonElement | undefined {
  return [...hote.querySelectorAll('button')].find((b) =>
    /Lancer en 2 fils/u.test(b.textContent ?? '')
  )
}

async function rendre(
  done: boolean,
  messageId: string | undefined = 'm-carte'
): Promise<HTMLButtonElement> {
  localStorage.clear()
  recues = []
  window.addEventListener(EVT_LANCER_EN_FILS, ecouter)
  hote = document.createElement('div')
  document.body.appendChild(hote)
  racine = createRoot(hote)
  await dessiner(message(done, messageId))
  const bouton = [...hote.querySelectorAll('button')].find((b) =>
    /Lancer en 2 fils/u.test(b.textContent ?? '')
  )
  expect(bouton, 'la carte doit être dessinée dans la ligne').toBeDefined()
  return bouton as HTMLButtonElement
}

afterEach(async () => {
  window.removeEventListener(EVT_LANCER_EN_FILS, ecouter)
  await act(async () => racine.unmount())
  hote.remove()
})

describe('ChatMessageRow — carte « Lancer en N fils »', () => {
  /*
   * La clé de la carte = (fil qui l'affiche, tour de la réponse). Un identifiant de MESSAGE ne
   * convient pas : une réponse peinte en direct n'en a pas tant que son fil n'est pas relu du disque,
   * et seul le fil affiché en plein l'est (`chat-event-routing.ts`). Relecture externe du 2026-10-25
   * (conv-1147, score 74) : dans une fenêtre de mosaïque, la carte restait grisée pour de bon.
   */
  it('réponse terminée : le clic porte la réponse, son tour et une clé (fil, tour)', async () => {
    const bouton = await rendre(true)
    await act(async () => bouton.click())
    expect(recues).toHaveLength(1)
    expect(recues[0]).toMatchObject({ messageId: 'm-carte', turnId: 't1' })
    expect(recues[0]!.cle).toBe(cleDuLancement(SOURCE, 'A:t1'))
  })

  it('réponse terminée SANS identifiant de message (fenêtre non relue) : cliquable quand même', async () => {
    const bouton = await rendre(true, undefined)
    expect(bouton.disabled).toBe(false)
    await act(async () => bouton.click())
    expect(recues).toHaveLength(1)
    expect(recues[0]!.turnId).toBe('t1')
    expect(recues[0]!.cle).toBe(cleDuLancement(SOURCE, 'A:t1'))
  })

  it('de « en cours » à « terminée » : les boutons s’activent, et un seul clic part', async () => {
    const bouton = await rendre(false, undefined)
    expect(bouton.disabled).toBe(true)
    await dessiner(message(true, undefined))
    expect(boutonLancer()?.disabled).toBe(false)
    await act(async () => boutonLancer()!.click())
    expect(recues).toHaveLength(1)
    // Le fil se relit du disque : l'identifiant arrive, la clé ne change pas, rien ne revient.
    await dessiner(message(true, 'm-carte'))
    expect(boutonLancer()).toBeUndefined()
  })

  it('réponse en cours d’écriture : boutons inactifs', async () => {
    const bouton = await rendre(false)
    expect(bouton.disabled).toBe(true)
    await act(async () => bouton.click())
    expect(recues).toHaveLength(0)
  })
})
