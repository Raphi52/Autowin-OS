// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Markdown } from './Markdown'
import { oublierRepriseMarkdown } from './markdown-blocs'

/**
 * LES BLOCS DE DONNEES SONT DESSINES PAR L'APP DANS LE FIL (2026-10-22).
 *
 * Le modele envoie un JSON ; le fil montre un tableau, des options cote a cote, des etapes — pas le
 * JSON. Entree qui ferait echouer une mauvaise correction : un bloc `donnees` tombe dans la branche
 * « texte » de Markdown.tsx, qui afficherait la source `{"colonnes":…` telle quelle.
 */
;(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  oublierRepriseMarkdown()
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})
const rendre = (texte: string): HTMLDivElement => {
  act(() => root.render(<Markdown text={texte} />))
  return container
}
const fence = (langue: string, donnees: unknown): string =>
  `Avant.\n\n\`\`\`${langue}\n${JSON.stringify(donnees)}\n\`\`\`\n\nAprès.`

describe('Markdown — blocs de données', () => {
  it('aw-tableau : un vrai tableau, en-têtes et cellules, avec le ton de chaque cellule', () => {
    const fil = rendre(
      fence('aw-tableau', {
        titre: 'Tests du lot',
        colonnes: ['Suite', 'Résultat'],
        lignes: [
          ['unité', { texte: 'vert', ton: 'ok' }],
          ['interface', { texte: 'rouge', ton: 'ko' }]
        ],
        note: 'Mesuré le 22/10.'
      })
    )
    const bloc = fil.querySelector('[data-testid="chat-bloc-donnees"]')
    expect(bloc?.getAttribute('data-forme')).toBe('aw-tableau')
    expect([...fil.querySelectorAll('th')].map((th) => th.textContent)).toEqual([
      'Suite',
      'Résultat'
    ])
    expect(fil.querySelector('td.md-donnees__ton--ko')?.textContent).toBe('rouge')
    expect(fil.textContent).toContain('Tests du lot')
    expect(fil.textContent).toContain('Mesuré le 22/10.')
    expect(fil.textContent).not.toContain('"colonnes"')
    expect(fil.textContent).toContain('Avant.')
    expect(fil.textContent).toContain('Après.')
  })

  /*
   * VÉCU LE 2026-11-05 (capture de l'utilisateur) : la cellule « **English mode is
   * fragile** » et le chemin `D:\AutoWinOS\…` s'affichaient avec leurs astérisques et leurs
   * accents graves. La consigne du chat exige le gras porteur dans chaque ligne ; le modèle l'écrit
   * donc aussi dans les blocs de données, qui le montraient brut.
   */
  it('gras et code dans les textes d’un bloc : rendus, jamais leurs symboles bruts', () => {
    const fil = rendre(
      fence('aw-tableau', {
        colonnes: ['Défaut', 'Constat'],
        lignes: [
          ['**English mode is fragile**', 'Voir `D:\\AutoWinOS\\x.ts` puis **36** tests'],
          [{ texte: '**rouge**', ton: 'ko' }, 'deux * étoiles * seules restent']
        ],
        note: 'Note **importante**.'
      })
    )
    const cellules = [...fil.querySelectorAll('td')]
    expect(cellules[0].querySelector('b')?.textContent).toBe('English mode is fragile')
    expect(cellules[1].querySelector('code')?.textContent).toBe('D:\\AutoWinOS\\x.ts')
    expect([...cellules[1].querySelectorAll('b')].map((b) => b.textContent)).toEqual(['36'])
    expect(cellules[2].querySelector('b')?.textContent).toBe('rouge')
    expect(cellules[2].className).toContain('md-donnees__ton--ko')
    expect(cellules[3].textContent).toBe('deux * étoiles * seules restent')
    expect(fil.querySelector('.md-donnees__note b')?.textContent).toBe('importante')
    const bloc = fil.querySelector('[data-testid="chat-bloc-donnees"]')
    expect(bloc?.textContent).not.toContain('**')
    expect(bloc?.textContent).not.toContain('`')

    const options = rendre(
      fence('aw-comparaison', {
        options: [
          { nom: '**A**', points: ['coût **bas**'], verdict: '`ok`' },
          { nom: 'B', points: [] }
        ]
      })
    )
    expect(options.querySelector('.md-donnees__nom b')?.textContent).toBe('A')
    expect(options.querySelector('.md-donnees__points b')?.textContent).toBe('bas')
    expect(options.querySelector('.md-donnees__verdict code')?.textContent).toBe('ok')

    const etapes = rendre(
      fence('aw-etapes', { etapes: [{ titre: 'Lire **x**', detail: 'dans `y.ts`' }] })
    )
    expect(etapes.querySelector('.md-donnees__etape-titre b')?.textContent).toBe('x')
    expect(etapes.querySelector('.md-donnees__detail code')?.textContent).toBe('y.ts')
  })

  it('aw-comparaison : une carte par option, la recommandée marquée et annoncée', () => {
    const fil = rendre(
      fence('aw-comparaison', {
        options: [
          {
            nom: 'Filtre',
            points: ['peu cher'],
            verdict: { texte: 'retenu', ton: 'ok' },
            recommande: true
          },
          { nom: 'Session neuve', points: ['un tour sans cache'] }
        ]
      })
    )
    const options = [...fil.querySelectorAll('[data-testid="donnees-option"]')]
    expect(options.map((o) => o.querySelector('.md-donnees__nom')?.textContent)).toEqual([
      'Filtre',
      'Session neuve'
    ])
    expect(options[0]?.getAttribute('data-recommande')).toBe('oui')
    expect(options[0]?.textContent).toContain('Recommandé')
    expect(options[1]?.getAttribute('data-recommande')).toBeNull()
  })

  it('aw-etapes : une liste ordonnée, chaque statut dit en toutes lettres', () => {
    const fil = rendre(
      fence('aw-etapes', {
        etapes: [
          { titre: 'Tests rouges', statut: 'fait' },
          { titre: 'Code', detail: '4 fichiers', statut: 'en-cours' },
          { titre: 'Commit' }
        ]
      })
    )
    const etapes = [...fil.querySelectorAll('ol.md-donnees__etapes > li')]
    expect(etapes).toHaveLength(3)
    expect(etapes[0]?.getAttribute('data-statut')).toBe('fait')
    expect(etapes[0]?.querySelector('.md-donnees__statut')?.getAttribute('aria-label')).toBe('fait')
    expect(etapes[1]?.textContent).toContain('4 fichiers')
    expect(etapes[2]?.getAttribute('data-statut')).toBe('a-faire')
  })

  it('jumeau : un JSON illisible reste un bloc de code, source visible', () => {
    const fil = rendre('```aw-tableau\n{colonnes: [A]}\n```')
    expect(fil.querySelector('[data-testid="chat-bloc-donnees"]')).toBeNull()
    expect(fil.querySelector('pre.md-code')?.textContent).toContain('{colonnes: [A]}')
  })
})
