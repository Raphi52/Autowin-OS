// @vitest-environment happy-dom
import { act } from 'react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import {
  chatApi,
  conversation,
  installRafShim,
  mountChat,
  type ChatHarness
} from './ChatView.harness'

/**
 * LA DEMANDE : « je dois pouvoir choisir mon CWD dans un nouveau fil » — avec la pastille de
 * dossier DEJA presente dans la barre du haut, pas un bouton de plus.
 *
 * Le dossier de travail d'un tour vient du RANGEMENT de la conversation
 * (`dossierDeTravailDuTour`), et la pastille etait `disabled` tant qu'aucune conversation n'etait
 * ouverte. Le premier tour d'un fil neuf partait donc toujours dans le depot de repli. Le test
 * regarde le geste : ouvrir la pastille sans fil ouvert, choisir un dossier, envoyer — la
 * conversation qui NAIT doit y etre rangee avant que le tour ne parte.
 */
describe('ChatView — dossier de travail du prochain fil', () => {
  let harness: ChatHarness | undefined

  beforeAll(installRafShim)
  afterEach(async () => {
    await harness?.unmount()
    harness = undefined
    window.localStorage.clear()
  })

  it('range le fil neuf dans le dossier choisi sur la pastille de la barre du haut', async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue('D:/Projets/Cible')
    const conversationsCreate = vi.fn().mockResolvedValue(conversation('neuf'))
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([]),
        conversation: vi.fn().mockResolvedValue({ id: 'neuf', messages: [] }),
        pickGitRepo: vi.fn().mockResolvedValue('D:/Projets/Cible'),
        conversationsSetProject,
        conversationsCreate
      })
    )

    const pastille = harness.container.querySelector<HTMLButtonElement>(
      '[data-testid="chat-project-dot"]'
    )
    expect(pastille).not.toBeNull()
    // Sans fil ouvert, la pastille reste ACTIONNABLE : c'est tout l'objet de la demande.
    expect(pastille!.disabled).toBe(false)
    await act(async () => {
      pastille!.click()
    })

    const choisir = document.querySelector<HTMLElement>('[data-testid="conv-project-pick"]')
    expect(choisir).not.toBeNull()
    await act(async () => {
      choisir!.click()
    })
    // Le dossier arme se LIT sur la pastille, sinon rien ne dit ou le fil va naitre.
    expect(
      harness.container.querySelector('[data-testid="chat-project-dot"]')?.textContent
    ).toContain('Cible')

    await harness.type('premier tour')
    await harness.click('.composer-send')

    expect(conversationsCreate).toHaveBeenCalled()
    expect(conversationsSetProject).toHaveBeenCalledWith('neuf', 'D:/Projets/Cible')
  })
})
