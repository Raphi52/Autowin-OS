// @vitest-environment happy-dom
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
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
    render([action({ name: 'orchestrate', ok: true, args: {} })])
    expect(etages()[0]?.textContent).toContain('Orchestration')
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

describe('les degrades du design converge sont bien ecrits dans les DEUX feuilles', () => {
  const lire = (...chemin: string[]): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), ...chemin), 'utf8')
  const corpsDe = (css: string, selecteur: string): string | null => {
    const i = css.indexOf(selecteur + ' {')
    if (i < 0) return null
    return css.slice(i + selecteur.length + 2, css.indexOf('}', i))
  }

  it('ChatView.css teinte chaque statut par un DEGRADE, pas un aplat', () => {
    const css = lire('ChatView.css')
    for (const etat of ['failed', 'running', 'interrupted']) {
      const regle = corpsDe(css, ".activity-group[data-state='" + etat + "']")
      expect(regle, 'regle manquante pour ' + etat).not.toBeNull()
      expect(regle!, 'aplat au lieu du degrade pour ' + etat).toMatch(/linear-gradient\(/)
    }
  })

  /**
   * ENTREE QUI FAIT ECHOUER SI LA CORRECTION EST FAUSSE : le theme. `.cosmic-outline
   * .activity-group[data-state]` (0,2,1) bat la regle de ChatView.css — un degrade ecrit dans la
   * seule feuille de base serait present dans le fichier et INVISIBLE a l'ecran. C'est le defaut
   * exact que l'utilisateur constate (« l'actuel n'a pas les degrades »).
   */
  it('le theme cosmic-outline porte lui aussi le degrade, sinon il ecrase la carte', () => {
    const theme = lire('..', 'assets', 'cosmic-outline.css')
    for (const etat of ['failed', 'running', 'interrupted', 'done']) {
      const regle = corpsDe(theme, ".cosmic-outline .activity-group[data-state='" + etat + "']")
      expect(regle, 'teinte de theme manquante pour ' + etat).not.toBeNull()
      expect(regle!, 'aplat au lieu du degrade pour ' + etat).toMatch(/linear-gradient\(/)
    }
  })
})
