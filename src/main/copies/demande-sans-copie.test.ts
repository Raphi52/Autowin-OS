import { describe, expect, it } from 'vitest'
import { estUneQuestionSansAction } from '../chat/grow-au-debut'
import { demandeSansEcritureDansLeDepot, demandeSurLeDepotPartage } from './demande-sans-copie'

/**
 * Le critère d'ouverture d'une copie neuve. Le rapport de défaut : un fil neuf ouvert par `/git` seul
 * annonçait « Ce fil travaille maintenant dans sa propre copie », alors que /git n'écrit pas dans le
 * code et doit voir l'arbre principal du dépôt.
 */
describe('demandeSansEcritureDansLeDepot', () => {
  it('le critère d’avant ouvrait une copie pour `/git` : c’est le défaut corrigé ici', () => {
    expect(estUneQuestionSansAction('/git')).toBe(false)
    expect(demandeSansEcritureDansLeDepot('/git')).toBe(true)
  })

  it.each([
    ['/git'],
    ['/git pousse tout'],
    ['/GIT commit push tout'],
    ['/maj la mise à jour est bloquée'],
    ['/gc']
  ])('skill qui travaille sur le dépôt partagé, jamais dans une copie : %s', (message) => {
    expect(demandeSansEcritureDansLeDepot(message)).toBe(true)
  })

  it.each([
    ['/scout le module veille'],
    ['/judge le dernier livrable'],
    ['/doctor'],
    ['/look'],
    ['/learn'],
    ['/check'],
    ['/rendement des fils de la semaine'],
    // Le nom sans barre en tête charge la même skill (`skillNommeeSansBarre`).
    ['scout le module veille']
  ])('skill qui lit ou écrit hors du code, sans action demandée : %s', (message) => {
    expect(demandeSansEcritureDansLeDepot(message)).toBe(true)
  })

  it.each([
    ['/scout le module veille puis corrige ce que tu trouves'],
    ['/build ajoute un tri par date'],
    ['/heal le Board est lent'],
    ['/kaizen'],
    // Skill inconnue : dans le doute, le fil reçoit sa copie.
    ['/inconnue fais un truc'],
    // « git » sans barre est la commande, pas la skill (`skill-nommee.ts`) : un rapport de panne.
    ['git push refusé'],
    ['ajoute un tri par date'],
    ['le bouton Copier ne marche plus'],
    ['go'],
    [''],
    [undefined]
  ])('demande qui peut écrire dans le code : copie ouverte : %s', (message) => {
    expect(demandeSansEcritureDansLeDepot(message)).toBe(false)
  })

  it('une question seule reste sans copie, comme avant', () => {
    expect(demandeSansEcritureDansLeDepot('pourquoi le Board est lent')).toBe(true)
  })
})

/** Même ouverte à la première écriture, une copie fausserait le travail de ces skills. */
describe('demandeSurLeDepotPartage', () => {
  it.each([['/git pousse tout'], ['/maj'], ['/GC']])('skill du dépôt partagé : %s', (m) => {
    expect(demandeSurLeDepotPartage(m)).toBe(true)
  })

  it.each([
    ['resume cette video'],
    ['/scout le module veille'],
    ['git push refusé'],
    [''],
    [undefined]
  ])('tout le reste attend la première écriture : %s', (m) => {
    expect(demandeSurLeDepotPartage(m)).toBe(false)
  })
})
