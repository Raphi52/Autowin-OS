// @vitest-environment happy-dom
/**
 * CORPS DÉPLIÉ DU BLOC RAISONNEMENT — « Liseuse + Fil de pensée » (conv-335, 2026-10-18, /draft
 * « un meilleur bloc raisonnement pour mieux voir le texte quand il est déplié », puis « Implémenter
 * 1 + 3 »). Avant : un <pre> gris de 13 px dans une fenêtre de 240 px à ascenseur, première ligne
 * coupée en haut. Ce que le mélange garde :
 *   - de la 1 (Liseuse) : texte clair en 14 px, plus d'ascenseur ; au-delà d'une demi-fenêtre, un
 *     fondu et un bouton « Tout lire · N paragraphes » qui déplie TOUT le texte ;
 *   - de la 3 (Fil de pensée) : un paragraphe par étape d'un rail, avec son point numéroté, le
 *     dernier allumé (il bat pendant le tour, en CSS) ;
 *   - règle commune : le `code` devient une puce ; bloc ouvert, l'en-tête ne répète plus la
 *     dernière ligne (CSS).
 * Le numéro du point est un ATTRIBUT (`data-n`, dessiné par `content: attr(data-n)`) : le texte du
 * corps reste la pensée, et rien d'autre.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { ThinkingBlock } from './ThinkingBlock'
import { paragraphesDeLaPensee } from './thinking-block-corps'

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let root: Root | null = null
let host: HTMLDivElement | null = null
const restaurer: Array<() => void> = []

function render(props: { text: string; done: boolean }): HTMLDivElement {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root!.render(createElement(ThinkingBlock, props)))
  return host
}

/** happy-dom ne met rien en page : on lui fait dire que le corps DÉBORDE sa demi-fenêtre. */
function corpsQuiDeborde(): void {
  for (const [prop, valeur] of [
    ['scrollHeight', 900],
    ['clientHeight', 400]
  ] as const) {
    const avant = Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop)
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('thinking-body--fil') ? valeur : 0
      }
    })
    restaurer.push(() => {
      if (avant) Object.defineProperty(HTMLElement.prototype, prop, avant)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>)[prop]
    })
  }
}

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
  root = null
  host = null
  while (restaurer.length) restaurer.pop()!()
})

/** Le geste de l'utilisateur : ouvrir le `<details>` du bloc, qui émet `toggle`. */
function deplier(el: HTMLElement): void {
  const details = el.querySelector('details')!
  act(() => {
    details.open = true
    details.dispatchEvent(new Event('toggle'))
  })
}

const PENSEE =
  'Of the 38 untracked notes, 7 are superseded.\n\nThe counts check out, nothing outside `knowledge/`.\n\n\n\nThe lock is released.'

describe('paragraphesDeLaPensee', () => {
  it('coupe aux lignes vides, sans paragraphe vide, et isole le `code`', () => {
    const p = paragraphesDeLaPensee(PENSEE)
    expect(p).toHaveLength(3)
    expect(p[1]).toEqual([
      { code: false, texte: 'The counts check out, nothing outside ' },
      { code: true, texte: 'knowledge/' },
      { code: false, texte: '.' }
    ])
  })

  it('garde un retour à la ligne simple DANS son paragraphe', () => {
    expect(paragraphesDeLaPensee('ligne a\nligne b')).toEqual([
      [{ code: false, texte: 'ligne a\nligne b' }]
    ])
  })

  it('ne fabrique rien pour une pensée vide (modèle à pensée chiffrée)', () => {
    expect(paragraphesDeLaPensee('  \n\n ')).toEqual([])
  })
})

describe('corps déplié du bloc Raisonnement', () => {
  it('pose un point NUMÉROTÉ par paragraphe sur le rail, le dernier marqué', () => {
    const el = render({ text: PENSEE, done: true })
    const corps = el.querySelector('[data-testid="thinking-block-body"]')!
    expect(corps.classList.contains('thinking-body--fil')).toBe(true)
    const paras = [...corps.querySelectorAll('.thinking-fil-para')]
    expect(paras.map((p) => p.getAttribute('data-n'))).toEqual(['1', '2', '3'])
    expect(paras.map((p) => p.classList.contains('is-derniere'))).toEqual([false, false, true])
    expect(corps.querySelector('code.thinking-fil-code')?.textContent).toBe('knowledge/')
  })

  it('son texte reste la pensée seule : aucun numéro, aucun bouton dedans', () => {
    const el = render({ text: 'je pèse les options', done: false })
    expect(el.querySelector('[data-testid="thinking-block-body"]')!.textContent).toBe(
      'je pèse les options'
    )
  })

  it('sans débordement, aucun bouton « Tout lire »', () => {
    const el = render({ text: PENSEE, done: true })
    expect(el.querySelector('[data-testid="thinking-block-tout-lire"]')).toBeNull()
  })

  it('au-delà de la demi-fenêtre : fondu + « Tout lire · N paragraphes », qui déplie TOUT', () => {
    corpsQuiDeborde()
    const el = render({ text: PENSEE, done: true })
    // Le bloc fini est PLIÉ : la mesure se fait quand l'utilisateur le déplie (conv-1055).
    deplier(el)
    const corps = el.querySelector<HTMLElement>('[data-testid="thinking-block-body"]')!
    const bouton = el.querySelector<HTMLButtonElement>('[data-testid="thinking-block-tout-lire"]')
    expect(bouton?.textContent).toBe('Tout lire · 3 paragraphes')
    expect(corps.classList.contains('is-coupe')).toBe(true)
    act(() => bouton!.click())
    expect(corps.classList.contains('is-entier')).toBe(true)
    expect(corps.classList.contains('is-coupe')).toBe(false)
    expect(bouton!.textContent).toBe('Réduire')
    act(() => bouton!.click())
    expect(corps.classList.contains('is-coupe')).toBe(true)
  })
})

/*
 * UN BLOC PLIÉ NE LIT PLUS `scrollHeight` (conv-1055, 2026-10-22). Profil CPU de l'ouverture de
 * conv-826 dans une instance cachée : 745 à 1 154 ms de temps propre dans `mesurer`, le premier
 * poste. C'est le coût d'UNE mise en page du fil, payée par le premier lecteur : retirer cette
 * lecture la fait passer à `ajusterALaLargeur`, sans gain net sur l'arbre actuel. Ce que ce test
 * garde, c'est la CASCADE : quand un autre code salit la mise en page entre deux blocs, chaque bloc
 * plié qui mesurait en relançait une (4,6 à 5,3 s mesurés dans ce cas, 0 après).
 */
describe('bloc plié : aucune mesure de mise en page', () => {
  it('ne lit jamais scrollHeight tant que le bloc est plié, puis mesure au dépliage', () => {
    let lectures = 0
    const avant = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'scrollHeight')
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', {
      configurable: true,
      get(this: HTMLElement) {
        if (this.classList.contains('thinking-body--fil')) lectures += 1
        return 0
      }
    })
    restaurer.push(() => {
      if (avant) Object.defineProperty(HTMLElement.prototype, 'scrollHeight', avant)
      else delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight
    })

    const el = render({ text: PENSEE, done: true })
    expect(el.querySelector('details')!.open).toBe(false)
    expect(lectures).toBe(0)

    deplier(el)
    expect(lectures).toBeGreaterThan(0)
  })
})

describe('feuille du corps déplié (ChatView.css)', () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'ChatView.css'), 'utf8')
  const regle = (selecteur: string): string => {
    const i = css.indexOf(selecteur + ' {')
    expect(i, 'règle absente : ' + selecteur).toBeGreaterThan(-1)
    return css.slice(i, css.indexOf('}', i))
  }

  it('texte clair en 14 px, sans ascenseur ni filet gauche', () => {
    const corps = regle('.thinking-block > .thinking-body--fil')
    expect(corps).toMatch(/overflow:\s*hidden/)
    expect(corps).toMatch(/border-left:\s*0/)
    expect(corps).toMatch(/max-height:\s*none/)
    const texte = regle('.thinking-body--fil .thinking-fil-texte')
    expect(texte).toMatch(/font-size:\s*14px/)
    expect(texte).toMatch(/color:\s*var\(--text\)/)
  })

  it('coupé à une demi-fenêtre, déplié en entier', () => {
    expect(regle('.thinking-block > .thinking-body--fil.is-coupe')).toMatch(/max-height:\s*50vh/)
  })

  it('le numéro du point vient de data-n, et le dernier point bat pendant le tour', () => {
    expect(regle('.thinking-body--fil .thinking-fil-para::before')).toMatch(
      /content:\s*attr\(data-n\)/
    )
    expect(regle('.thinking-block.is-live .thinking-fil-para.is-derniere::before')).toMatch(
      /animation:/
    )
  })

  it('bloc ouvert, l en-tête ne répète plus la dernière ligne', () => {
    expect(regle('.thinking-block--raisonnement[open] > summary .anneau-l2')).toMatch(
      /display:\s*none/
    )
  })
})
