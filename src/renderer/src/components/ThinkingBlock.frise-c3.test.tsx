// @vitest-environment happy-dom
/**
 * Bloc Actions en variante C3 « frise » (choix de l'utilisateur, conv-831, 2026-09-24) :
 * bilan dans l'en-tete, barre de temps (un segment par action), frise avec l'etat de chaque action.
 * L'etat vient des lignes de FIN emises par `claude.ts` au resultat d'outil (`Bash échoué - 31 s`).
 */
import { describe, expect, it } from 'vitest'
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { ThinkingBlock } from './ThinkingBlock'
import { actionsDuTour, bilanDesActions } from './thinking-block-corps'

const JOURNAL = [
  'Read · src/a.ts',
  'Read terminé - 2 s',
  'Bash · npm test',
  'Bash en cours - 30 s',
  'Bash échoué - 31 s',
  'Edit · src/a.ts',
  'Edit terminé - 1 s',
  'Bash · npm test',
  'Bash en cours - 7 s'
]

describe('bloc Actions — frise C3', () => {
  it('replie fins et battements sur la ligne de leur action, avec état et durée', () => {
    const actions = actionsDuTour(JOURNAL, 'Bash en cours - 7 s')
    expect(actions.map((a) => [a.texte, a.etat, a.secondes, a.famille])).toEqual([
      ['Read · src/a.ts — 2 s', 'ok', 2, 'lire'],
      ['Bash · npm test — 31 s', 'ko', 31, 'commande'],
      ['Edit · src/a.ts — 1 s', 'ok', 1, 'modifier'],
      ['Bash · npm test — 7 s', 'encours', 7, 'commande']
    ])
    expect(bilanDesActions(actions)).toBe('4 · 1 échec · 41 s')
  })

  // R5 (conv-162, 2026-10-10) : la capsule ECRIT le nombre et la duree ; le bilan complet (echecs
  // compris) reste son infobulle ; la barre court SOUS la ligne d'en-tete, donc visible bloc plie.
  it('dessine la capsule, la barre sous la ligne et une ligne de frise par action', async () => {
    const host = document.createElement('div')
    document.body.appendChild(host)
    const root = createRoot(host)
    await act(async () => {
      root.render(
        createElement(ThinkingBlock, {
          text: '',
          done: false,
          status: 'Bash en cours - 7 s',
          statusLog: JOURNAL
        })
      )
    })
    expect(host.querySelector('[data-testid="action-block-nombre"]')?.textContent).toBe('4')
    expect(host.querySelector('[data-testid="action-block-duree"]')?.textContent).toBe('41 s')
    expect(host.querySelector('[data-testid="action-block-capsule"]')?.getAttribute('title')).toBe(
      '4 · 1 échec · 41 s'
    )
    expect(host.querySelectorAll('.thinking-frise-barre > span')).toHaveLength(4)
    expect(
      [...host.querySelectorAll('.thinking-frise-barre > span')].map((s) =>
        s.getAttribute('data-etat')
      )
    ).toEqual(['ok', 'ko', 'ok', 'encours'])
    // Une seule barre, DANS l'en-tete : elle se voit bloc plie et n'est pas redessinee deplie.
    expect(host.querySelectorAll('.thinking-frise-barre')).toHaveLength(1)
    expect(
      host.querySelector('[data-testid="action-block"] > summary .thinking-frise-barre')
    ).not.toBeNull()
    // SOUS la ligne, HORS de la capsule (conv-173 : « sors-la de la capsule Actions, mets-la comme
    // avant en dessous et qui dépasse sur le texte de la ligne ») : enfant direct de l'en-tête.
    expect(host.querySelector('[data-testid="action-block"] > summary > .thinking-frise-barre')).not.toBeNull()
    expect(host.querySelector('[data-testid="action-block-capsule"] .thinking-frise-barre')).toBeNull()
    const lignes = [...host.querySelectorAll('[data-testid="action-frise-ligne"]')]
    expect(lignes.map((l) => l.getAttribute('data-etat'))).toEqual(['ok', 'ko', 'ok', 'encours'])
    // Le texte du corps reste les lignes d'action, une par ligne (contrat des tests existants).
    expect(host.querySelector('[data-testid="action-block-body"]')?.textContent).toBe(
      'Read · src/a.ts — 2 s\nBash · npm test — 31 s\nEdit · src/a.ts — 1 s\nBash · npm test — 7 s'
    )
    await act(async () => root.unmount())
    host.remove()
  })

  it('tour terminé sans lignes de fin (ancien historique) : aucune action n’est laissée en cours', () => {
    expect(actionsDuTour(['Read · a', 'Grep · b'], undefined, true).map((a) => a.etat)).toEqual([
      'ok',
      'ok'
    ])
  })
})
