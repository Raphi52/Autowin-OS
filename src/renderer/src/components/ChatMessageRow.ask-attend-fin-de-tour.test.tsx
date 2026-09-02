// @vitest-environment happy-dom
/**
 * LE DEFAUT, vecu le 2026-09-02 : « le bloc ask apparait avant que le tour finisse et quand je
 * click trop tot ca marche pas ».
 *
 * Les reponses cliquables s'affichaient DES l'execution de l'action `ask`, alors que le tour
 * continue encore quelques secondes. Un clic dans cette fenetre passait par l'injection dans le
 * tour en cours, qui ne relit plus rien apres l'execution des commandes : la reponse etait effacee
 * a la fermeture du tour. Le bloc se verrouillait quand meme sur « Repondu ».
 *
 * REGLE : le bloc n'existe a l'ecran qu'une fois le tour TERMINE (`done`). Avant, rien de
 * cliquable — donc aucune reponse perdue.
 *
 * Entree qui ferait echouer une correction fausse : le MEME message une fois `done` doit rendre
 * les boutons (masquer toujours serait aussi « aucun clic perdu », et casserait la fonction).
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

const messageAvecAsk = (done: boolean): Msg =>
  ({
    role: 'assistant',
    content: '',
    done,
    parts: [
      {
        kind: 'action',
        name: 'ask',
        ok: true,
        actionId: 'act-1',
        data: {
          question: 'On corrige la cause ou on bloque le clic ?',
          options: [{ libelle: 'Corriger la cause', recommande: true }, { libelle: 'Bloquer' }]
        }
      }
    ]
  }) as unknown as Msg

const rendre = async (message: Msg): Promise<{ host: HTMLDivElement; demonter: () => Promise<void> }> => {
  const host = document.createElement('div')
  document.body.appendChild(host)
  const root = createRoot(host)
  await act(async () => {
    root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
  })
  return {
    host,
    demonter: async () => {
      await act(async () => root.unmount())
      host.remove()
    }
  }
}

describe('le bloc ask attend la fin du tour', () => {
  beforeEach(() => {
    globalThis.IS_REACT_ACT_ENVIRONMENT = true
  })

  it('ne montre AUCUNE reponse cliquable tant que le tour n’est pas termine', async () => {
    const { host, demonter } = await rendre(messageAvecAsk(false))
    expect(
      host.querySelectorAll('button.askd-choix').length,
      'un clic ici serait efface a la fermeture du tour'
    ).toBe(0)
    await demonter()
  })

  it('montre les reponses des que le tour est termine', async () => {
    const { host, demonter } = await rendre(messageAvecAsk(true))
    expect(host.querySelectorAll('button.askd-choix').length).toBe(2)
    await demonter()
  })
})
