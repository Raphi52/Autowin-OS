import { describe, expect, it } from 'vitest'
import { parseDesktopActions } from './desktop-control'

/**
 * `double_click` ÉTAIT REFUSÉ ALORS QUE LE GESTE EXISTAIT.
 *
 * MESURÉ le 2026-08-15 sur les 40 dernières conversations de l'utilisateur : `desktop_act` est la
 * commande qui échoue le PLUS (4 échecs), et son motif est littéral — « Type d'action desktop
 * inconnu: double_click ». Or le double-clic était déjà réalisable via `click` avec `clicks: 2` :
 * seul le NOM manquait.
 *
 * Conséquence observée dans `conv-1244` : l'action refusée, l'agent est parti cliquer à l'aveugle
 * ailleurs sur le bureau, a ouvert les réglages rapides de Windows par erreur, et le tour a échoué.
 * Refuser un synonyme évident ne protège rien — cela transforme une action réalisable en échec.
 */
describe('double_click, alias du clic double', () => {
  it('est ACCEPTÉ au lieu d’être refusé', () => {
    expect(() => parseDesktopActions([{ type: 'double_click', x: 500, y: 500 }])).not.toThrow()
  })

  it('vaut exactement un `click` à deux clics', () => {
    const [action] = parseDesktopActions([{ type: 'double_click', x: 500, y: 500 }])
    expect(action).toMatchObject({ type: 'click', clicks: 2 })
  })

  it('est NORMALISÉ en `click` : rien en aval ne connaît l’alias', () => {
    // Laisser fuiter `double_click` deplacerait simplement l'echec d'un cran.
    const [action] = parseDesktopActions([{ type: 'double_click', x: 200, y: 800 }])
    expect(action.type).toBe('click')
  })

  it('ne change RIEN au clic simple', () => {
    const [action] = parseDesktopActions([{ type: 'click', x: 500, y: 500 }])
    expect(action).toMatchObject({ type: 'click', clicks: 1 })
  })

  it('refuse toujours un type réellement inconnu', () => {
    // L'alias ne doit pas ouvrir la porte a n'importe quoi.
    expect(() => parseDesktopActions([{ type: 'triple_click', x: 500, y: 500 }])).toThrow()
  })
})
