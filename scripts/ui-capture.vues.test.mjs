import { describe, expect, it } from 'vitest'
import { VUES_CONNUES } from './ui-capture.mjs'
import { APP_DESTINATIONS } from '../src/shared/navigation'

/**
 * LA CAPTURE CONNAÎT TOUTES LES VUES DE L'APPLICATION (conv-1089, 2026-10-22).
 *
 * `VUES_CONNUES` est une COPIE à la main du catalogue (`src/shared/navigation.ts`) : un script Node ne
 * charge pas le TypeScript de l'application. Rien ne les liait — la vue « Besoins » ajoutée au
 * catalogue sortait en `vue-inconnue`, et sa preuve visuelle était impossible. Ce test les lie : une
 * vue ajoutée d'un seul côté le rend rouge.
 */
describe('VUES_CONNUES', () => {
  it('est exactement le catalogue des destinations de l’application', () => {
    expect([...VUES_CONNUES].sort()).toEqual(APP_DESTINATIONS.map(({ id }) => id).sort())
  })
})
