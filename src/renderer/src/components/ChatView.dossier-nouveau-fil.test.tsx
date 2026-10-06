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

  /**
   * DEFAUT VECU (kaizen conv-113, 2026-10-06) : « la conversation a dévié vers le CWD sans
   * raison ». `conv-113` est ne avec un lien GitHub vers PaperTrading et a recu, a la creation,
   * `D:\Chirurgien\AssistantChirurgien` — le dossier arme des semaines plus tot pour un AUTRE fil
   * (conv-111/112). Le dossier du « prochain fil » n'etait jamais vide apres usage : il restait
   * dans `autowin.chat.dossierNouveauFil` et se posait sur CHAQUE fil neuf, session apres session.
   * Il doit servir au fil qu'il vise, un seul, comme ∞ arme sur un fil neuf.
   */
  it("ne sert qu'au fil qui nait : le fil suivant n'herite pas du dossier", async () => {
    const conversationsSetProject = vi.fn().mockResolvedValue('D:/Projets/Cible')
    const conversationsCreate = vi
      .fn()
      .mockResolvedValueOnce(conversation('premier'))
      .mockResolvedValueOnce(conversation('second'))
    harness = await mountChat(
      chatApi({
        conversations: vi.fn().mockResolvedValue([]),
        conversation: vi.fn().mockResolvedValue({ id: 'premier', messages: [] }),
        pickGitRepo: vi.fn().mockResolvedValue('D:/Projets/Cible'),
        conversationsSetProject,
        conversationsCreate
      })
    )

    await harness.click('[data-testid="chat-project-dot"]')
    await act(async () => {
      document.querySelector<HTMLElement>('[data-testid="conv-project-pick"]')!.click()
    })
    await harness.type('premier tour')
    await harness.click('.composer-send')
    expect(conversationsSetProject).toHaveBeenCalledWith('premier', 'D:/Projets/Cible')

    // Le dossier arme a servi : rien ne doit en rester pour la session suivante.
    expect(window.localStorage.getItem('autowin.chat.dossierNouveauFil')).toBeNull()

    await harness.click('.conv-new-row')
    // Sur un fil neuf, la pastille ne doit plus annoncer le dossier du fil precedent.
    expect(
      harness.container
        .querySelector('[data-testid="chat-project-dot"]')
        ?.getAttribute('aria-label')
    ).not.toContain('Cible')

    await harness.type('second tour')
    await harness.click('.composer-send')
    expect(conversationsCreate).toHaveBeenCalledTimes(2)
    expect(conversationsSetProject).not.toHaveBeenCalledWith('second', expect.anything())
  })
})
