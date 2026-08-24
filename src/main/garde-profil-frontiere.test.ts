import { describe, expect, it } from 'vitest'
import { guardProfile, guardStringOrNull } from './ipc-guards'

/**
 * LE DÉFAUT, mesuré le 2026-08-24. `ProfileStore.save` ne valide RIEN et écrit la charge utile telle
 * quelle. Pire, il compose `[profile, ...list().filter(i => i.id !== profile.id)]` : avec un `id`
 * absent, l'objet douteux atterrit EN TÊTE de liste. Et comme `list()` est tolérant (il rend `[]`
 * sur erreur), le dégât n'est pas un plantage mais de la donnée pourrie, silencieuse.
 *
 * MÊME CLASSE que l'incident du même jour sur les conversations — un écrivain qui accepte une forme
 * que rien ne vérifie. La différence est instructive : là-bas le lecteur était STRICT, donc l'app est
 * devenue inbootable et le défaut s'est vu tout de suite. Ici le lecteur est tolérant, donc personne
 * ne s'en aperçoit. Le second est plus difficile à trouver, pas moins réel.
 *
 * PÉRIMÈTRE ASSUMÉ : on ne valide que les champs que l'appelant contrôle réellement. `topology`,
 * `roles` et `updatedAt` sont écrasés par le handler juste après — les valider serait du théâtre.
 */

const profilValide = {
  schema: 'autowin.profile/v1',
  id: 'p-1',
  name: 'Mon profil'
}

describe('valider un profil À LA FRONTIÈRE, avant toute persistance', () => {
  it('accepte un profil bien formé et ne garde que les champs contrôlés par l’appelant', () => {
    expect(guardProfile(profilValide)).toEqual(profilValide)
  })

  it('conserve la description quand elle est fournie', () => {
    expect(guardProfile({ ...profilValide, description: 'un profil de test' })).toMatchObject({
      description: 'un profil de test'
    })
  })

  it('REFUSE un profil SANS id — c’est celui qui atterrissait en tête de liste', () => {
    // L'entrée exacte qui a motivé cette garde.
    expect(() => guardProfile({ schema: 'autowin.profile/v1', name: 'x' })).toThrow(/profile\.id/)
  })

  it('refuse un id qui n’est pas une CHAÎNE, au lieu de le convertir', () => {
    // TROU DÉCOUVERT PAR SABOTAGE : remplacer la garde de type par un `String(candidat.id ?? '')`
    // laissait passer les onze tests, parce que le cas « id absent » restait refusé par le contrôle
    // de vacuité. Un `id: 42` devenait donc « 42 » sans que rien ne le signale. Ce test ferme le
    // trou en visant le TYPE, pas seulement l'absence.
    expect(() => guardProfile({ ...profilValide, id: 42 })).toThrow(/string attendue/)
  })

  it('refuse un id vide, qui passerait un simple test de type', () => {
    // L'entrée qui doit faire échouer une garde qui se contenterait de `typeof === 'string'`.
    expect(() => guardProfile({ ...profilValide, id: '   ' })).toThrow(/identifiant vide/)
  })

  it('refuse un schéma inattendu, au lieu de persister une forme d’une autre version', () => {
    expect(() => guardProfile({ ...profilValide, schema: 'autowin.profile/v99' })).toThrow(/schema/)
  })

  it('refuse ce qui n’est pas un objet', () => {
    expect(() => guardProfile('un-nom')).toThrow(/objet attendu/)
    expect(() => guardProfile(null)).toThrow(/objet attendu/)
  })

  it('refuse un nom qui n’est pas une chaîne', () => {
    expect(() => guardProfile({ ...profilValide, name: 42 })).toThrow(/profile\.name/)
  })

  it('n’invente PAS de description quand elle est absente', () => {
    // Une garde trop zélée pourrait poser une chaîne vide ; le champ doit rester absent.
    expect(guardProfile(profilValide)).not.toHaveProperty('description')
  })
})

describe('la conversation active peut légitimement être « aucune »', () => {
  it('accepte null et undefined, qui veulent tous deux dire « aucune »', () => {
    expect(guardStringOrNull(null, 'convId')).toBeNull()
    expect(guardStringOrNull(undefined, 'convId')).toBeNull()
  })

  it('accepte un identifiant', () => {
    expect(guardStringOrNull('conv-12', 'convId')).toBe('conv-12')
  })

  it('REFUSE ce qui n’est ni une chaîne ni « aucune »', () => {
    // L'entrée qui doit faire échouer une garde qui laisserait tout passer.
    expect(() => guardStringOrNull(42, 'convId')).toThrow(/convId/)
    expect(() => guardStringOrNull({}, 'convId')).toThrow(/convId/)
  })
})
