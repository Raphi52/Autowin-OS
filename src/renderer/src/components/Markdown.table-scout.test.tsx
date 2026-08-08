// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'

/**
 * Le tableau que les skills produisent réellement — `# · Score · Type · What · Why · How`.
 *
 * Fichier SÉPARÉ de `Markdown.test.tsx` à dessein : ce dernier est édité en parallèle par une autre
 * session, et une première version de ces tests y a été écrasée avant même d'avoir pu tourner.
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

function render(text: string): void {
  act(() => root.render(createElement(Markdown, { text, highlightFinalSummary: false })))
}

const LIGNES = [
  '| # | Score | Type | What | Why | How |',
  '|---|-------|------|------|-----|-----|',
  '| 1 | 🟢 | 🔧 FIX | Corriger la réservation dans `execution-supervisor.ts` (line 288) | Avec 3 appels autorisés, le troisième est refusé. | Calculer depuis le budget. Test : 3 passent, le 4e refusé. |',
  '| 2 | 🟢 | 🔧 FIX | Remapper les parents du fork dans `conversations.ts` (line 455) | Les messages gardent un `parentMessageId` de la source. | Table ancien ID vers nouvel ID. |',
  '| 3 | 🟢 | 🔧 FIX | Conserver l’ancre des tâches mensuelles dans `schedule.ts` | Une récurrence du 31 janvier devient 28 février. | Recalculer depuis le jour d’ancrage. |'
]

describe('tableau de scout — la forme réellement produite par les skills', () => {
  it('rend les SIX colonnes, en-tête comprise', () => {
    render(LIGNES.join('\n'))
    const entetes = [...container.querySelectorAll('table thead th')].map((c) =>
      c.textContent?.trim()
    )
    expect(entetes).toEqual(['#', 'Score', 'Type', 'What', 'Why', 'How'])
  })

  it('rend les TROIS lignes, avec six cellules chacune', () => {
    render(LIGNES.join('\n'))
    const lignes = container.querySelectorAll('table tbody tr')
    expect(lignes.length).toBe(3)
    for (const ligne of lignes) expect(ligne.querySelectorAll('td').length).toBe(6)
  })

  it('ne perd pas la DERNIÈRE colonne, celle qui porte le comment-faire', () => {
    render(LIGNES.join('\n'))
    const dernieres = [...container.querySelectorAll('table tbody tr')].map(
      (r) => r.querySelectorAll('td')[5]?.textContent ?? ''
    )
    expect(dernieres[0]).toContain('Calculer depuis le budget')
    expect(dernieres[2]).toContain('Recalculer depuis le jour')
  })

  it('garde le code inline des cellules au lieu de l’aplatir', () => {
    render(LIGNES.join('\n'))
    const codes = [...container.querySelectorAll('table tbody code')].map((c) => c.textContent)
    expect(codes).toContain('execution-supervisor.ts')
    expect(codes).toContain('parentMessageId')
  })

  it('SANS pipes en début et fin de ligne — la forme GFM la plus courante', () => {
    // GFM autorise `a | b | c` sans pipes encadrants. Si la vue l'exige, un tableau parfaitement
    // valide ne s'affiche pas du tout : il tombe en texte brut, et l'utilisateur voit « pas tout ».
    const sansBords = [
      '# | Score | What',
      '--- | --- | ---',
      '1 | 🟢 | Corriger la réservation',
      '2 | 🟢 | Remapper les parents'
    ].join('\n')
    render(sansBords)
    const table = container.querySelector('table')
    expect(table).not.toBeNull()
    expect(container.querySelectorAll('table thead th').length).toBe(3)
    expect(container.querySelectorAll('table tbody tr').length).toBe(2)
  })

  it('un pipe DANS du code inline ne coupe pas la cellule en deux', () => {
    // `a|b` entre backticks est un seul contenu. Découper dessus décale toutes les colonnes
    // suivantes d'un cran, ce qui se voit comme des colonnes « en trop » ou décalées.
    const avecPipe = ['| Quoi | Commande |', '|---|---|', '| Filtrer | `git log | head -3` |'].join(
      '\n'
    )
    render(avecPipe)
    const cellules = container.querySelectorAll('table tbody td')
    expect(cellules.length).toBe(2)
    expect(cellules[1]?.textContent).toContain('git log | head -3')
  })

  it('N’AVALE PAS le paragraphe qui suit, même s’il contient un pipe', () => {
    // Le risque introduit en assouplissant la detection : sans pipes encadrants exiges, une ligne de
    // prose contenant un pipe ressemble a une ligne de tableau. Elle ne doit pas etre absorbee.
    const suite = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      '',
      'Ensuite on filtre avec un pipe | comme ceci, en pleine phrase.'
    ].join('\n')
    render(suite)
    expect(container.querySelectorAll('table tbody tr').length).toBe(1)
    expect(container.textContent).toContain('en pleine phrase')
  })

  it('absorbe une ligne COLLÉE au tableau — c’est le comportement GFM, pas un défaut', () => {
    // J'avais d'abord écrit l'inverse, en croyant protéger une régression de mon propre
    // assouplissement. La spec GFM dit qu'un tableau se termine à la première ligne VIDE ou au début
    // d'un autre bloc : une ligne non vide qui suit immédiatement EST une ligne du tableau, et
    // GitHub la rend ainsi. Le test encodait mon attente, pas la référence — c'est lui qui avait
    // tort, pas le code. La ligne vide, elle, coupe bien : c'est le test précédent qui le vérifie.
    const colle = [
      '| A | B |',
      '|---|---|',
      '| 1 | 2 |',
      'Le total est de 3 | ce qui suffit.'
    ].join('\n')
    render(colle)
    expect(container.querySelectorAll('table tbody tr').length).toBe(2)
  })
})
