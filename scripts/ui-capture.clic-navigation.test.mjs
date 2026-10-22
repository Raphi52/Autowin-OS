import { describe, expect, it } from 'vitest'
import { verdictCapture, vueAttendueApresClics } from './ui-capture.mjs'

/*
 * UNE VUE OUVERTE PAR --click (conv-1105, 2026-10-22).
 *
 * `--conversation` exige `--view chat` : pour photographier l'Observatory d'une conversation copiee,
 * on clique donc `nav-observatory`. Constat mesure : `--scroll` et `--taper` ne trouvaient pas la
 * vue ouverte (code 9, page encore sur « chat » et `vue-en-transition` pose 600 ms apres le clic), et
 * la photo, elle, montrait l'Observatory sous un verdict `navigation-non-appliquee(observatory)`.
 * Ce fichier tient la seconde moitie : la vue ATTENDUE est celle du dernier bouton de navigation
 * clique, pas celle de `--view`. La premiere moitie (attendre la fin du fondu apres chaque clic, la
 * fenetre cachee dessinant) se prouve sur l'instance cachee, pas en test pur.
 */

const mesuresVertes = {
  vue: 'chat',
  destinationActive: 'chat',
  longueurTexte: 5000,
  elements: 500,
  octetsPng: 200_000
}

describe('vueAttendueApresClics', () => {
  it('sans --click, la vue attendue est celle de --view', () => {
    expect(vueAttendueApresClics('chat', undefined)).toBe('chat')
  })

  it('un clic sur un bouton de navigation connu ouvre SA vue', () => {
    expect(vueAttendueApresClics('chat', '[data-testid="nav-observatory"]')).toBe('observatory')
    expect(vueAttendueApresClics('chat', "[data-testid='nav-tests']")).toBe('tests')
    expect(vueAttendueApresClics('chat', '[data-testid=nav-settings]')).toBe('settings')
  })

  it('dans une chaine, le DERNIER bouton de navigation l’emporte, les autres etapes ne comptent pas', () => {
    expect(
      vueAttendueApresClics(
        'chat',
        '[data-testid="nav-tests"] >> [data-testid="nav-observatory"] >> .observatory-turn button'
      )
    ).toBe('observatory')
  })

  it('un Alt+clic navigue aussi ; un survol ne clique pas, donc ne change pas de vue', () => {
    expect(vueAttendueApresClics('chat', 'alt:[data-testid="nav-observatory"]')).toBe('observatory')
    expect(vueAttendueApresClics('chat', 'survol:[data-testid="nav-observatory"]')).toBe('chat')
  })

  it('un clic qui ne navigue pas, ou vers une vue inconnue, garde la vue de --view', () => {
    expect(vueAttendueApresClics('chat', '.conv-pick')).toBe('chat')
    expect(vueAttendueApresClics('chat', '[data-testid="nav-inexistante"]')).toBe('chat')
    expect(vueAttendueApresClics('chat', '[data-testid="nav-observatory-filtre"]')).toBe('chat')
  })
})

describe('verdictCapture — vue ouverte par --click', () => {
  it('accepte la vue ouverte par le clic quand elle est active sur la photo', () => {
    const verdict = verdictCapture({
      ...mesuresVertes,
      destinationActive: 'observatory',
      vueAttendue: 'observatory',
      declencheur: '[data-testid="nav-observatory"]',
      declencheurTrouve: true,
      elementsAvantClic: 400
    })
    expect(verdict).toEqual({ ok: true, echecs: [] })
  })

  it('refuse toujours une photo restee sur l’ancienne vue', () => {
    const verdict = verdictCapture({
      ...mesuresVertes,
      destinationActive: 'chat',
      vueAttendue: 'observatory',
      declencheur: '[data-testid="nav-observatory"]',
      declencheurTrouve: true,
      elementsAvantClic: 400
    })
    expect(verdict.echecs).toContain('navigation-non-appliquee(chat)')
  })

  it('sans vue attendue, rien ne change : --view reste la reference', () => {
    expect(verdictCapture({ ...mesuresVertes, destinationActive: 'observatory' }).echecs).toContain(
      'navigation-non-appliquee(observatory)'
    )
  })
})
