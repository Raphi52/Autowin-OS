import { describe, expect, it } from 'vitest'
import { isNonActionableWall, suppressionFor } from './watchdog-suppression'

/**
 * La suppression protège Auto-Kaizen d'incidents qu'il ne peut PAS corriger : abandon volontaire,
 * panne fournisseur, mur non actionnable. Un incident non supprimé lance un agent — et sur un mur
 * (quota, token expiré) cet agent ne fait qu'ajouter du bruit.
 *
 * Motivation mesurée : sur 952 conversations, 720 portent un échec, amplifié par 2248 alertes
 * « 🚨 Auto-Kaizen suspendu ». Une part de ces alertes vient d'échecs NON actionnables passés à
 * travers la suppression — dont le token OAuth expiré de conv-1086.
 */
describe('suppression — un token d’auth expiré est un MUR, pas un défaut à kaizen', () => {
  // La chaîne EXACTE vue sur conv-1086 (2026-08-13).
  const conv1086 =
    'Failed to authenticate. API Error: 401 OAuth access token has expired. Re-authenticate to continue.'

  it('la chaîne réelle de conv-1086 est désormais supprimée (non-actionable)', () => {
    expect(suppressionFor('Phase build échec', conv1086)).toBe('non-actionable')
    expect(isNonActionableWall('', conv1086)).toBe(true)
  })

  it('couvre les formulations d’auth expirée, quel que soit le fournisseur', () => {
    for (const detail of [
      'OAuth token expired',
      'access token has expired',
      'Please re-authenticate to continue',
      'authentication_error: invalid token',
      'Invalid API key provided',
      'HTTP 401 — auth token expired',
      '401 Unauthorized: oauth session ended'
    ]) {
      expect(isNonActionableWall('', detail), detail).toBe(true)
    }
  })

  it('CONTRÔLE NÉGATIF : un vrai défaut mentionnant 401 par hasard n’est PAS avalé', () => {
    // « 401 » comme numéro de ligne / de test, sans vocabulaire d'authentification, reste un défaut
    // à analyser — sinon on masquerait de vrais bugs.
    expect(isNonActionableWall('', 'assertion failed at foo.test.ts:401')).toBe(false)
    expect(isNonActionableWall('', 'expected 401 items but got 400')).toBe(false)
    expect(suppressionFor('Phase build échec', 'TypeError: cannot read x at line 401')).toBeUndefined()
  })
})
