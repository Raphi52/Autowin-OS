// @vitest-environment happy-dom
/**
 * Les pièces jointes REÇUES, telles que la bulle du fil les montre.
 *
 * Ce que ce fichier protège : le défaut constaté le 2026-09-10 était qu'un correspondant envoie un
 * PDF et que le fil ne le montre NULLE PART. La chaîne était muette sur ses trois étages, et
 * l'utilisateur n'avait aucun moyen de savoir qu'une pièce existait sans rouvrir Outlook. L'envoi,
 * lui, marchait déjà — c'est bien le sens RETOUR qui manquait.
 *
 * Rendu avec `react-dom` et `act`, comme le reste des tests de cette vue : le dépôt n'embarque pas
 * `@testing-library/react`, et l'ajouter pour un seul fichier ferait payer une dépendance à tous.
 */
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { InterlocuteursWidget } from './InterlocuteursWidget'
import type { Interlocuteur, MessageInterlocuteur } from './outlook-model'

;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

const NOW = new Date(2026, 8, 10, 12, 0, 0).getTime()
const monte: Array<{ root: ReturnType<typeof createRoot>; container: HTMLDivElement }> = []

afterEach(() => {
  for (const { root, container } of monte.splice(0)) {
    act(() => root.unmount())
    container.remove()
  }
})

function message(part: Partial<MessageInterlocuteur> & { id: string }): MessageInterlocuteur {
  return {
    sujet: 'PROMEOM : Convocation',
    corps: 'Bonjour, veuillez trouver la convocation.',
    recuLe: NOW - 3_600_000,
    nonLu: false,
    deMoi: false,
    auteur: 'Zoé Martin',
    fil: 'convocation',
    pieces: [],
    ...part
  }
}

function contactAvec(messages: MessageInterlocuteur[]): Interlocuteur {
  return {
    echange: true,
    cle: 'zoe@ex.fr',
    nom: 'Zoé Martin',
    adresse: 'zoe@ex.fr',
    dernierNomRecu: NOW,
    nonLus: 0,
    dernierEchange: NOW,
    messages
  }
}

/** Monte la tuile puis descend jusqu'aux messages : noms → fils → conversation. */
async function ouvrirLaConversation(contact: Interlocuteur): Promise<HTMLDivElement> {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  act(() => {
    root.render(
      createElement(InterlocuteursWidget, {
        fils: [contact],
        now: NOW,
        onOuvrir: vi.fn().mockResolvedValue(undefined),
        ouvertureEnCours: null,
        onRepondre: vi.fn().mockResolvedValue({ ok: true }),
        onNouvelleConversation: vi.fn().mockResolvedValue({ ok: true }),
        onMarquerLu: vi.fn().mockResolvedValue({ ok: true })
      })
    )
  })
  monte.push({ root, container })

  const cliquer = async (id: string): Promise<void> => {
    const cible = container.querySelector<HTMLElement>(`[data-testid="${id}"]`)
    expect(cible, `bouton absent : ${id}`).toBeTruthy()
    await act(async () => {
      cible!.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    })
  }
  await cliquer('home-contact-zoe@ex.fr')
  await cliquer('home-fil-convocation')
  expect(container.querySelector('[data-testid="home-inter-conversation"]')).toBeTruthy()
  return container
}

describe('les pieces jointes recues dans la bulle du fil', () => {
  it('affiche le nom et la taille de chaque piece recue', async () => {
    const container = await ouvrirLaConversation(
      contactAvec([
        message({
          id: 'm-promeom',
          pieces: [
            { nom: 'convocation individuelle - promeom v3.pdf', taille: 859_335 },
            { nom: 'appointment_813649365.ics', taille: 685 }
          ]
        })
      ])
    )
    const liste = container.querySelector('[data-testid="home-chat-pieces-m-promeom"]')
    expect(liste).not.toBeNull()
    const texte = liste?.textContent ?? ''
    // Le NOM, parce que c'est ce que l'utilisateur reconnaît, et la TAILLE, parce que c'est elle qui
    // lui dit s'il a reçu le document entier et non une vignette. Les deux valeurs sont celles de la
    // vraie boîte, relevées le 2026-09-10 sur le message « TR: PROMEOM ».
    expect(texte).toContain('convocation individuelle - promeom v3.pdf')
    // Même formateur que les pièces ENVOYÉES (`formatFileSize`) : une pièce ne doit pas changer
    // d'unité selon le sens dans lequel elle a voyagé.
    expect(texte).toContain('839 Ko')
    expect(texte).toContain('appointment_813649365.ics')
    expect(texte).toContain('685 o')
  })

  it('n affiche AUCUNE liste quand le message n a pas de piece', async () => {
    // Sinon la bulle porterait un cadre vide sur la quasi-totalité des messages : relevé du
    // 2026-09-10, 150 des 153 messages reçus de la vraie boîte n'ont aucune pièce.
    const container = await ouvrirLaConversation(contactAvec([message({ id: 'm-nu', pieces: [] })]))
    expect(container.querySelector('[data-testid="home-chat-pieces-m-nu"]')).toBeNull()
  })

  it('montre les pieces MEME quand le corps du message n a pas ete lu', async () => {
    // Un instantané ancien peut n'avoir aucun corps : la bulle montre alors l'objet. La pièce ne
    // doit pas disparaître avec le texte — c'est justement le cas où l'utilisateur en a besoin.
    const container = await ouvrirLaConversation(
      contactAvec([
        message({ id: 'm-sans-corps', corps: '', pieces: [{ nom: 'devis.pdf', taille: 4_096 }] })
      ])
    )
    const liste = container.querySelector('[data-testid="home-chat-pieces-m-sans-corps"]')
    expect(liste?.textContent ?? '').toContain('devis.pdf')
  })
})
