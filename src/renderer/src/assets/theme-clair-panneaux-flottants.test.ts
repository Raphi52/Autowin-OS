import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(__dirname, 'theme-modes.css'), 'utf8')

/**
 * PANNEAUX FLOTTANTS EN MODE CLAIR (signalé avec capture le 2026-09-18).
 * Deux panneaux restaient peints en couleurs de nuit EN DUR :
 *  - « Quotas fournisseurs » : `background: rgba(0, 0, 0, 0.98)` (ModelQuotaIndicator.css l.147) ;
 *  - le menu « Orchestrateur » : `rgba(8, 8, 10, 0.985)` (ChatView.css l.3517), dont les libellés
 *    prennent les jetons de texte du mode clair — donc du sombre sur du sombre, illisible.
 * La surcharge se pose ICI, jamais au point d'usage.
 */
const regle = (selecteur: string): string => {
  const debut = css.indexOf(selecteur)
  if (debut < 0) return ''
  const ouvrante = css.indexOf('{', debut)
  const fermante = css.indexOf('}', ouvrante)
  if (ouvrante < 0 || fermante < 0) return ''
  // Le selecteur doit etre suivi de son bloc, pas d'un autre selecteur (pas de virgule avant).
  if (css.slice(debut + selecteur.length, ouvrante).includes(',')) return ''
  return css.slice(debut, fermante + 1)
}

describe('mode clair : panneaux flottants repeints', () => {
  it('le panneau des quotas a un fond clair', () => {
    const bloc = regle(":root[data-base='clair'] .model-quota-popover")
    expect(bloc, 'surcharge claire de .model-quota-popover absente').not.toBe('')
    expect(bloc).toMatch(/background:\s*#f/i)
  })

  it('les libellés secondaires du panneau des quotas sont assombris', () => {
    // Ces libelles sont repeints dans une regle GROUPEE : on verifie la presence du selecteur
    // dans la partie claire du fichier, pas un bloc a lui seul.
    const partieClaire = css.slice(css.indexOf('PANNEAUX FLOTTANTS'))
    expect(partieClaire, 'bloc des panneaux flottants absent').not.toBe('')
    expect(partieClaire).toContain(".model-quota-popover small")
    expect(partieClaire).toContain(".model-quota-values small")
    expect(regle(":root[data-base='clair'] .model-quota-window > strong")).not.toBe('')
  })

  it('le menu Orchestrateur a un fond clair', () => {
    const bloc = regle(":root[data-base='clair'] .model-select-menu")
    expect(bloc, 'surcharge claire de .model-select-menu absente').not.toBe('')
    expect(bloc).toMatch(/background:\s*#f/i)
  })
})
