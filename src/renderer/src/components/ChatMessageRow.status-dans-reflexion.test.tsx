// @vitest-environment happy-dom
/**
 * OU VIT LE SIGNE DE VIE DU FOURNISSEUR (« outil en cours », « tache de fond », retry API).
 *
 * Constat utilisateur du 2026-09-01 : « ca ecrit tout mais a cote du texte agent au lieu de dans
 * son bloc ». Il s'affichait dans la ligne d'en-tete du message (`.msg-provider-status`), donc
 * colle au libelle « Agent » et a la reponse. Sa place est le bloc « Reflexion » : meme moment
 * d'attente, et sur un modele dont la pensee arrive chiffree (opus-5), c'est le SEUL contenu que
 * ce bloc peut porter.
 *
 * Entree qui ferait echouer une correction fausse : un tour EN COURS qui a deja produit des
 * `parts` (une action) et n'a AUCUN raisonnement — le bloc doit quand meme exister et porter le
 * statut, sinon le signe de vie disparait des la premiere action.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ChatMessageRow } from './ChatMessageRow'
import type { Msg } from './chat-view-types'

describe('ChatMessageRow — signe de vie du fournisseur', () => {
  it('porte le statut DANS le bloc Réflexion, et non à côté du texte de l’agent', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    const message = {
      role: 'assistant',
      content: '',
      parts: [{ kind: 'action', name: 'run', args: {} }],
      done: false,
      providerStatus: 'Bash en cours - 12 s'
    } as unknown as Msg
    await act(async () => {
      root.render(createElement(ChatMessageRow, { message, index: 0 } as never))
    })
    expect(
      host.querySelector('.msg-meta .msg-provider-status'),
      'le statut ne doit plus vivre dans l’en-tête du message'
    ).toBeNull()
    const bloc = host.querySelector('[data-testid="thinking-block"]')
    expect(bloc, 'le bloc Réflexion doit exister même sans pensée, pour porter le statut').not.toBeNull()
    expect(bloc!.querySelector('[data-testid="thinking-status"]')?.textContent).toBe(
      'Bash en cours - 12 s'
    )
    expect(host.querySelector('[data-testid="thinking-body"]')?.textContent).toContain(
      'Bash en cours - 12 s'
    )
    await act(async () => root.unmount())
    host.remove()
  })
})
