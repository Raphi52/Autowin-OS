// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'
import { MessageDuFil } from './message-du-fil'
import { oublierRepriseMarkdown } from './markdown-blocs'
import { cleDuLancement } from '../../../shared/lancer-en-fils'
import {
  EVT_FILS_LANCES,
  EVT_LANCER_EN_FILS,
  type DemandeDeLancement
} from './proposition-fils-evenements'

/**
 * LA CARTE « LANCER EN N FILS » (conv-1147, 2026-10-25). L'agent rend un bloc ```aw-fils. Le fil
 * montre les tâches regroupées, ce que ça coûte, et deux boutons. RIEN ne part sans clic. Un clic
 * émet UNE demande à ChatView et ne relance jamais après coup.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
let recues: DemandeDeLancement[]
const ecouter = (event: Event): void => {
  recues.push((event as CustomEvent<DemandeDeLancement>).detail)
}
beforeEach(() => {
  oublierRepriseMarkdown()
  localStorage.clear()
  recues = []
  window.addEventListener(EVT_LANCER_EN_FILS, ecouter)
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  window.removeEventListener(EVT_LANCER_EN_FILS, ecouter)
  act(() => root.unmount())
  container.remove()
})

const DEUX_DISJOINTES = {
  taches: [
    {
      titre: 'Titre Tickets',
      demande: 'corrige le titre de la vue Tickets',
      fichiers: ['src/a.tsx']
    },
    { titre: 'Tri Observatoire', demande: 'ajoute un tri par date', fichiers: ['src/b.tsx'] }
  ]
}
const source = (donnees: unknown): string => JSON.stringify(donnees)
const fence = (donnees: unknown): string =>
  `Avant.\n\n\`\`\`aw-fils\n${source(donnees)}\n\`\`\`\n\nAprès.`

/**
 * Le texte rendu DANS une réponse de l'agent : la fenêtre de mosaïque pose le fil AFFICHÉ
 * (`data-conv-id`, ChatMosaic), ChatMessageRow pose la réponse (`data-message-id`).
 */
const rendre = (texte: string): HTMLDivElement => {
  act(() =>
    root.render(
      <div data-conv-id="conv-7">
        <div data-message-id="msg-42">
          <Markdown text={texte} />
        </div>
      </div>
    )
  )
  return container
}
const bouton = (fil: HTMLElement, libelle: RegExp): HTMLButtonElement | undefined =>
  [...fil.querySelectorAll('button')].find((b) => libelle.test(b.textContent ?? ''))

describe('Markdown — carte « Lancer en N fils »', () => {
  it('montre les tâches, le coût et les deux boutons, sans rien lancer', () => {
    const fil = rendre(fence(DEUX_DISJOINTES))
    const carte = fil.querySelector('[data-testid="proposition-fils"]')
    expect(carte).not.toBeNull()
    expect(carte!.textContent).toContain('Titre Tickets')
    expect(carte!.textContent).toContain('Tri Observatoire')
    expect(carte!.textContent).toMatch(/2 tours/u)
    expect(bouton(fil, /Lancer en 2 fils/u)).toBeDefined()
    expect(bouton(fil, /Tout ici/u)).toBeDefined()
    // Ni la source JSON ni une demande émise : la carte attend le clic.
    expect(fil.textContent).not.toContain('"taches"')
    expect(recues).toHaveLength(0)
  })

  it('« Lancer en 2 fils » émet UNE demande : le plan, le fil et le message d’origine', () => {
    const fil = rendre(fence(DEUX_DISJOINTES))
    act(() => bouton(fil, /Lancer en 2 fils/u)!.click())
    expect(recues).toHaveLength(1)
    expect(recues[0]).toMatchObject({
      mode: 'fils',
      conversationId: 'conv-7',
      messageId: 'msg-42',
      cle: cleDuLancement(source(DEUX_DISJOINTES))
    })
    expect(recues[0]!.plan.map((f) => f.taches.map((t) => t.titre))).toEqual([
      ['Titre Tickets'],
      ['Tri Observatoire']
    ])
    // Un second clic ne relance rien : les boutons sont tombés.
    expect(bouton(fil, /Lancer en/u)).toBeUndefined()
  })

  /*
   * DÉFAUT 2 DU JUGE (conv-1147) : une réponse COPIÉE dans une branche porte
   * `turnConversationId` = le fil d'ORIGINE (`store/conversations.ts`, `fork`), que ChatMessageRow
   * pose en `data-fil-du-tour`. La carte le lisait en premier : un clic dans la branche lançait
   * depuis l'origine, en partant d'un autre message. La carte vise le fil qui l'AFFICHE.
   */
  it('une carte copiée dans une branche vise la branche, pas le fil d’origine', () => {
    act(() =>
      root.render(
        <div data-conv-id="conv-branche">
          <div data-message-id="msg-copie" data-fil-du-tour="conv-origine">
            <Markdown text={fence(DEUX_DISJOINTES)} />
          </div>
        </div>
      )
    )
    act(() => bouton(container, /Lancer en 2 fils/u)!.click())
    expect(recues[0]).toMatchObject({ conversationId: 'conv-branche', messageId: 'msg-copie' })
  })

  it('au chat plein (aucune fenêtre), la carte copiée laisse ChatView prendre le fil affiché', () => {
    act(() =>
      root.render(
        <div data-message-id="msg-copie" data-fil-du-tour="conv-origine">
          <Markdown text={fence(DEUX_DISJOINTES)} />
        </div>
      )
    )
    act(() => bouton(container, /Tout ici/u)!.click())
    expect(recues[0]!.conversationId).toBeUndefined()
    expect(recues[0]!.messageId).toBe('msg-copie')
  })

  it('« Tout ici » émet le mode ici', () => {
    const fil = rendre(fence(DEUX_DISJOINTES))
    act(() => bouton(fil, /Tout ici/u)!.click())
    expect(recues.map((r) => r.mode)).toEqual(['ici'])
  })

  it('deux tâches sur le même fichier : un seul fil, donc seulement « Tout ici »', () => {
    const fil = rendre(
      fence({
        taches: [
          { titre: 'A', demande: 'fais A', fichiers: ['src/a.tsx'] },
          { titre: 'B', demande: 'fais B', fichiers: ['src/a.tsx'] }
        ]
      })
    )
    expect(bouton(fil, /Lancer en/u)).toBeUndefined()
    expect(bouton(fil, /Tout ici/u)).toBeDefined()
    expect(fil.textContent).toMatch(/mêmes fichiers/u)
  })

  it('déjà lancée (souvenir de la carte) : plus aucun bouton, les fils sont nommés', () => {
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES)),
      JSON.stringify({ mode: 'fils', fils: [{ id: 'conv-8', titre: 'Titre Tickets' }] })
    )
    const fil = rendre(fence(DEUX_DISJOINTES))
    expect(bouton(fil, /Lancer en/u)).toBeUndefined()
    expect(bouton(fil, /Tout ici/u)).toBeUndefined()
    expect(fil.textContent).toContain('conv-8')
  })

  it('ChatView confirme le lancement : la carte nomme les fils ouverts', () => {
    const fil = rendre(fence(DEUX_DISJOINTES))
    act(() => bouton(fil, /Lancer en 2 fils/u)!.click())
    act(() => {
      window.dispatchEvent(
        new CustomEvent(EVT_FILS_LANCES, {
          detail: {
            cle: cleDuLancement(source(DEUX_DISJOINTES)),
            mode: 'fils',
            fils: [
              { id: 'conv-8', titre: 'Titre Tickets' },
              { id: 'conv-9', titre: 'Tri Observatoire' }
            ]
          }
        })
      )
    })
    expect(fil.textContent).toContain('conv-8')
    expect(fil.textContent).toContain('conv-9')
  })

  it('une source illisible reste du code : aucun bouton', () => {
    const fil = rendre('```aw-fils\n{"taches": [{"titre": "x"}]}\n```')
    expect(fil.querySelector('[data-testid="proposition-fils"]')).toBeNull()
    expect(fil.querySelector('pre')).not.toBeNull()
  })
})

/*
 * DÉFAUT D5 DU JUGE (conv-1147, 2e passe) — le souvenir « déjà lancée » était tiré de la seule
 * SOURCE de la carte. Entrées qui font échouer l'ancienne version :
 * - deux réponses au même bloc (l'agent repropose le même découpage) : lancer l'une marquait
 *   l'autre « lancée » ;
 * - une réponse recopiée dans une branche (nouvel identifiant de message) héritait du souvenir
 *   de l'origine, et ses boutons disparaissaient.
 */
describe('Markdown — carte « Lancer en N fils » : un souvenir par réponse', () => {
  const dansLaReponse = (messageId: string, texte: string): React.JSX.Element => (
    <MessageDuFil.Provider value={messageId}>
      <div data-message-id={messageId}>
        <Markdown text={texte} />
      </div>
    </MessageDuFil.Provider>
  )
  const cartes = (): HTMLElement[] => [
    ...container.querySelectorAll<HTMLElement>('[data-testid="proposition-fils"]')
  ]

  it('deux réponses au même bloc : lancer l’une laisse les boutons de l’autre', () => {
    const rendreLesDeux = (): void =>
      act(() =>
        root.render(
          <div data-conv-id="conv-7">
            {dansLaReponse('msg-1', fence(DEUX_DISJOINTES))}
            {dansLaReponse('msg-2', fence(DEUX_DISJOINTES))}
          </div>
        )
      )
    rendreLesDeux()
    act(() => bouton(cartes()[0]!, /Lancer en 2 fils/u)!.click())
    expect(recues).toHaveLength(1)
    expect(recues[0]!.messageId).toBe('msg-1')
    expect(recues[0]!.cle).toBe(cleDuLancement(source(DEUX_DISJOINTES), 'msg-1'))
    act(() => {
      window.dispatchEvent(
        new CustomEvent(EVT_FILS_LANCES, {
          detail: { cle: recues[0]!.cle, mode: 'fils', fils: [{ id: 'conv-8', titre: 'A' }] }
        })
      )
    })
    expect(cartes()[0]!.textContent).toContain('conv-8')
    expect(bouton(cartes()[1]!, /Lancer en 2 fils/u)).toBeDefined()
    // Et après un nouveau rendu complet (souvenir relu du stockage local).
    act(() => root.unmount())
    root = createRoot(container)
    rendreLesDeux()
    expect(bouton(cartes()[0]!, /Lancer en/u)).toBeUndefined()
    expect(bouton(cartes()[1]!, /Lancer en 2 fils/u)).toBeDefined()
  })

  it('une réponse recopiée dans une branche n’hérite pas du souvenir de l’origine', () => {
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES), 'msg-origine'),
      JSON.stringify({ mode: 'fils', fils: [{ id: 'conv-8', titre: 'A' }] })
    )
    act(() =>
      root.render(
        <div data-conv-id="conv-branche">{dansLaReponse('msg-copie', fence(DEUX_DISJOINTES))}</div>
      )
    )
    expect(bouton(container, /Lancer en 2 fils/u)).toBeDefined()
    expect(container.textContent).not.toContain('conv-8')
  })

  it('réponse encore en cours d’écriture : boutons inactifs, aucun lancement', () => {
    act(() =>
      root.render(<div data-conv-id="conv-7">{dansLaReponse('', fence(DEUX_DISJOINTES))}</div>)
    )
    const lancer = bouton(container, /Lancer en 2 fils/u)!
    expect(lancer.disabled).toBe(true)
    act(() => lancer.click())
    expect(recues).toHaveLength(0)
    expect(container.textContent).toMatch(/fin de la réponse/u)
  })
})

/*
 * ANCIEN SOUVENIR (2e relecture externe, conv-1147, point bas) : une carte cliquée AVANT la
 * correction D5 a son souvenir sous l'ancienne clé, tirée de la seule source. Sans relecture de
 * cette clé, ses boutons revenaient, et un second clic relançait N tours.
 */
describe('Markdown — carte « Lancer en N fils » : souvenir d’avant la correction', () => {
  const dansLaReponse = (identite: string, texte: string): React.JSX.Element => (
    <MessageDuFil.Provider value={identite}>
      <div data-turn-id="t1">
        <Markdown text={texte} />
      </div>
    </MessageDuFil.Provider>
  )

  it('une carte sans souvenir sous sa clé relit l’ancienne clé : déjà lancée, aucun bouton', () => {
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES)),
      JSON.stringify({ mode: 'fils', fils: [{ id: 'conv-8', titre: 'Titre Tickets' }] })
    )
    act(() =>
      root.render(
        <div data-conv-id="conv-7">{dansLaReponse('conv-7:t1', fence(DEUX_DISJOINTES))}</div>
      )
    )
    expect(bouton(container, /Lancer en/u)).toBeUndefined()
    expect(bouton(container, /Tout ici/u)).toBeUndefined()
    expect(container.textContent).toContain('conv-8')
  })

  it('le souvenir sous la clé de la réponse passe devant l’ancien', () => {
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES)),
      JSON.stringify({ mode: 'fils', fils: [{ id: 'conv-ancien', titre: 'A' }] })
    )
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES), 'conv-7:t1'),
      JSON.stringify({ mode: 'ici', fils: [] })
    )
    act(() =>
      root.render(
        <div data-conv-id="conv-7">{dansLaReponse('conv-7:t1', fence(DEUX_DISJOINTES))}</div>
      )
    )
    expect(container.textContent).toMatch(/Lancé ici/u)
    expect(container.textContent).not.toContain('conv-ancien')
  })

  it('un clic n’écrit jamais l’ancienne clé : une autre carte au même contenu garde ses boutons', () => {
    act(() =>
      root.render(
        <div data-conv-id="conv-7">
          {dansLaReponse('conv-7:t1', fence(DEUX_DISJOINTES))}
          {dansLaReponse('conv-7:t2', fence(DEUX_DISJOINTES))}
        </div>
      )
    )
    const [premiere] = [
      ...container.querySelectorAll<HTMLElement>('[data-testid="proposition-fils"]')
    ]
    act(() => bouton(premiere!, /Lancer en 2 fils/u)!.click())
    expect(localStorage.getItem(cleDuLancement(source(DEUX_DISJOINTES)))).toBeNull()
    act(() => root.unmount())
    root = createRoot(container)
    act(() =>
      root.render(
        <div data-conv-id="conv-7">{dansLaReponse('conv-7:t2', fence(DEUX_DISJOINTES))}</div>
      )
    )
    expect(bouton(container, /Lancer en 2 fils/u)).toBeDefined()
  })
})

/*
 * RIEN N'EST PARTI (3e relecture externe, conv-1147) : quand ChatView refuse AVANT toute dépense
 * (réponse introuvable sur disque, fil illisible, aucune branche créée), la carte ne dit pas
 * « Lancé : ». Elle donne la raison et rend ses boutons : un nouvel essai ne coûte rien de plus.
 */
describe('Markdown — carte « Lancer en N fils » : rien n’est parti', () => {
  it('donne la raison, sans « Lancé », et rend ses boutons', () => {
    localStorage.setItem(
      cleDuLancement(source(DEUX_DISJOINTES)),
      JSON.stringify({
        mode: 'fils',
        fils: [],
        refus: ['réponse de la carte introuvable dans le fil enregistré'],
        rienNestParti: true
      })
    )
    const fil = rendre(fence(DEUX_DISJOINTES))
    expect(fil.textContent).toMatch(/Rien n’est parti.*introuvable/u)
    expect(fil.textContent).not.toMatch(/Lancé/u)
    act(() => bouton(fil, /Lancer en 2 fils/u)!.click())
    expect(recues).toHaveLength(1)
    expect(recues[0]!.mode).toBe('fils')
    // Le nouvel essai est en route : les boutons tombent jusqu'à la réponse de ChatView.
    expect(bouton(fil, /Lancer en/u)).toBeUndefined()
  })
})
