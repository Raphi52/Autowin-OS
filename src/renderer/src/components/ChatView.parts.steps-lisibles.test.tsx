// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AssistantActivityGroup } from './ChatView.parts'

/**
 * GRIEF UTILISATEUR (conv-1536) : « on sait pas ce que le model est en train de faire au premier
 * coup d'oeil » + « je veux un bouton pour extend et voir le detail de chaque step » + « l'actuel
 * n'a pas les degrades ».
 *
 * Trois defauts distincts, trois oracles :
 *  1. l'etage n'existait QUE si le groupe portait plus d'une action -> une action seule ne montrait
 *     RIEN de ce qu'elle fait ;
 *  2. l'etage n'affichait que le NOM de l'outil, jamais SUR QUOI il travaille ;
 *  3. le detail n'etait depliable qu'au niveau du GROUPE, jamais par etape.
 */
let container: HTMLDivElement
let root: Root

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]

function render(actions: Action[]): void {
  act(() => root.render(createElement(AssistantActivityGroup, { actions })))
  // Un groupe TERMINE arrive PLIE depuis le 2026-09-01 : ces oracles portent sur le CONTENU des
  // etages, on les deplie donc comme le ferait l'utilisateur avant de les observer.
  const entete = container.querySelector<HTMLButtonElement>('[data-testid="activity-group"]')
  if (entete && entete.getAttribute('aria-expanded') === 'false') act(() => entete.click())
}
const etages = (): HTMLElement[] => [...container.querySelectorAll<HTMLElement>('.activity-step')]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'edit_file', ...over }) as Action

describe('les etages disent ce que le modele fait, un par un', () => {
  /**
   * ENTREE QUI FAIT ECHOUER SI LA CORRECTION EST FAUSSE : un groupe d'UNE SEULE action. C'est le
   * cas majoritaire du fil, et celui que le garde `actions.length > 1` effacait entierement.
   */
  it('une action seule a quand meme son etage', () => {
    render([action({ ok: true, args: { path: 'src/a.ts' } })])
    expect(etages()).toHaveLength(1)
  })

  /**
   * ENTREE QUI FAIT ECHOUER SI LA CORRECTION EST FAUSSE : deux actions du MEME outil sur des
   * cibles differentes. Un rendu qui n'affiche que le nom de l'outil rend deux lignes IDENTIQUES —
   * illisible, et c'est exactement le grief « on sait pas ce qu'il fait ».
   */
  it("l'etage nomme la CIBLE, pas seulement l'outil", () => {
    render([
      action({ ok: true, args: { path: 'src/a.ts' } }),
      action({ ok: true, args: { path: 'src/b.ts' } })
    ])
    const textes = etages().map((li) => li.textContent ?? '')
    expect(textes[0]).toContain('src/a.ts')
    expect(textes[1]).toContain('src/b.ts')
    expect(textes[0]).not.toBe(textes[1])
  })

  it('un outil sans cible lisible reste affiche par son libelle, sans mentir', () => {
    // Une orchestration seule est une capsule depuis conv-194 : l'etage se teste sur un autre outil.
    render([action({ name: 'get_state', ok: true, args: {} })])
    expect(etages()[0]?.textContent).toContain('Lecture d’état')
  })
})

describe("chaque etage a son bouton d'extension", () => {
  it("le bouton est replie par defaut et n'expose aucun detail", () => {
    render([action({ ok: true, args: { path: 'a.ts' }, data: { diff: '+ une ligne' } })])
    const bouton = container.querySelector<HTMLButtonElement>('.activity-step-toggle')
    expect(bouton, "aucun bouton d'extension sur l'etage").not.toBeNull()
    expect(bouton!.getAttribute('aria-expanded')).toBe('false')
    expect(container.querySelector('.activity-step-detail')).toBeNull()
  })

  /**
   * ENTREE QUI FAIT ECHOUER SI LA CORRECTION EST FAUSSE : deux etapes aux details DIFFERENTS. Un
   * depliage qui reutiliserait le detail du groupe (ou le premier de la liste) passerait un test a
   * une seule etape et echouerait ici — c'est le faux vert que ce cas interdit.
   */
  it('deplier la 2e etape montre le detail de la 2e, pas celui de la 1re', () => {
    render([
      action({ ok: true, args: { path: 'a.ts' }, data: { diff: 'DETAIL-UN' } }),
      action({ ok: true, args: { path: 'b.ts' }, data: { diff: 'DETAIL-DEUX' } })
    ])
    const boutons = container.querySelectorAll<HTMLButtonElement>('.activity-step-toggle')
    expect(boutons).toHaveLength(2)
    act(() => boutons[1].click())
    const ouverts = [...container.querySelectorAll('.activity-step-detail')]
    expect(ouverts).toHaveLength(1)
    expect(ouverts[0].textContent).toContain('DETAIL-DEUX')
    expect(ouverts[0].textContent).not.toContain('DETAIL-UN')
  })

  /** Une etape sans rien a montrer ne promet pas un depliage vide. */
  it("pas de bouton quand l'etape n'a aucun detail", () => {
    render([action({ name: 'navigate', ok: true, args: { view: 'chat' } })])
    expect(container.querySelector('.activity-step-toggle')).toBeNull()
  })
})

/*
 * Les DEGRADES de la carte teintee (« l'actuel n'a pas les degrades ») ne sont plus verifies ici :
 * la barre a quitte la carte teintee pour le cadre « grand, deux lignes » (conv-904, 2026-10-12),
 * dont le dessin est verrouille par anneau-activite.test.tsx.
 */
