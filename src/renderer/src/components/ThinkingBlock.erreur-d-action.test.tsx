// @vitest-environment happy-dom
/**
 * LE MESSAGE D'ERREUR D'UNE ACTION ROUGE, sous sa ligne — conv-341 (2026-10-19) : « quand y a une
 * action rouge, c'est possible d'avoir le message d'erreur que l'action a rencontré ? […] un truc
 * qui coûte pas de token ». L'adaptateur fait suivre `Glob échoué - 25 s` de
 * `Glob erreur - <texte rendu par l'outil>` ; le bloc le range sous la ligne rouge.
 *
 * Journal REPRIS du tour réel de conv-335 (session d91f9884…, 22:48:28) : le Glob coupé à 20 s.
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingBlock } from './ThinkingBlock'
import { actionsDuTour, bilanDesActions, dernierStatutDAction } from './thinking-block-corps'

const DELAI =
  'Ripgrep search timed out after 20 seconds. The search may have matched files but did not complete in time. Try searching a more specific path or pattern.'

const JOURNAL_CONV_335 = [
  'Glob · src/renderer/src/components/{ChatView.jetons-theme,chatview-voile}.test.ts',
  "Grep · recycle|retire l'étape|tâche programmée|laissée ouverte|0/1",
  'Grep terminé - 0 s',
  'Glob échoué - 25 s',
  `Glob erreur - ${DELAI}`,
  'Bash · ls src/renderer/src/components/ChatView.jetons-theme.test.ts',
  'Bash terminé - 3 s'
]

describe('bloc Actions — le message d’erreur d’une action rouge', () => {
  it('se range sous l’action en échec, sans créer de ligne', () => {
    const actions = actionsDuTour(JOURNAL_CONV_335, undefined, true)
    expect(actions.map((a) => [a.outil, a.etat, a.erreur])).toEqual([
      ['Glob', 'ko', DELAI],
      ['Grep', 'ok', undefined],
      ['Bash', 'ok', undefined]
    ])
    // Le bilan ne compte toujours que les actions : 3, dont 1 échec.
    expect(bilanDesActions(actions)).toBe('3 · 1 échec · 28 s')
  })

  it('deux commandes en échec lancées ensemble gardent chacune leur message', () => {
    const actions = actionsDuTour(
      [
        'Bash · npm test',
        'Bash · npm run lint',
        'Bash échoué - 4 s',
        'Bash erreur - Exit code 1 · 2 tests rouges',
        'Bash échoué - 6 s',
        'Bash erreur - Exit code 2 · 3 erreurs de lint'
      ],
      undefined,
      true
    )
    expect(actions.map((a) => [a.texte, a.erreur])).toEqual([
      ['Bash · npm test — 4 s', 'Exit code 1 · 2 tests rouges'],
      ['Bash · npm run lint — 6 s', 'Exit code 2 · 3 erreurs de lint']
    ])
  })

  it('un message sans action rouge de son outil est ignoré, jamais transformé en ligne', () => {
    const actions = actionsDuTour(
      ['Read · a', 'Read terminé - 1 s', 'Glob erreur - x'],
      undefined,
      true
    )
    expect(actions.map((a) => [a.outil, a.erreur])).toEqual([['Read', undefined]])
  })

  it('sous la capsule pliée, la ligne de vie reste « Glob échoué », pas le message', () => {
    expect(dernierStatutDAction(JOURNAL_CONV_335.slice(0, 5), `Glob erreur - ${DELAI}`)).toBe(
      'Glob échoué - 25 s'
    )
  })

  it('dessine le message sous la ligne rouge, et seulement sous elle', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: true,
          statusLog: JOURNAL_CONV_335
        })
      )
    })
    const lignes = [...host.querySelectorAll('[data-testid="action-frise-ligne"]')]
    expect(lignes.map((l) => l.getAttribute('data-etat'))).toEqual(['ko', 'ok', 'ok'])
    const erreurs = [...host.querySelectorAll('[data-testid="action-frise-erreur"]')]
    expect(erreurs).toHaveLength(1)
    expect(erreurs[0]!.textContent).toBe(DELAI)
    expect(lignes[0]!.contains(erreurs[0]!)).toBe(true)
    await act(async () => root.unmount())
    host.remove()
  })

  it('une commande nommée en échec montre aussi son message, sur sa ligne pliée', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: true,
          statusLog: [
            'Bash · npm test && npm run lint',
            'tache de fond en cours - Run the tests',
            'Bash échoué - 31 s',
            'Bash erreur - Exit code 1 · 2 tests rouges',
            'tache de fond terminee - Run the tests'
          ]
        })
      )
    })
    const resume = host.querySelector('.thinking-frise-tache > summary')
    expect(resume?.querySelector('[data-testid="action-frise-erreur"]')?.textContent).toBe(
      'Exit code 1 · 2 tests rouges'
    )
    await act(async () => root.unmount())
    host.remove()
  })
})
