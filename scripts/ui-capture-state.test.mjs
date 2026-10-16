import { describe, expect, it } from 'vitest'
import { ETATS_CONNUS, attributDEtat, resoudreEtat, verdictEtat } from './ui-capture.mjs'

/**
 * Pourquoi ce test existe : `--state` sert a AMENER l'UI dans un etat qu'aucune navigation ne
 * produit a la demande (une fenetre mosaique en `data-etat='attention'`). S'il forcait l'etat
 * sans EXIGER d'effet, une capture prise sur une mosaique vide — zero fenetre a l'ecran — rendrait
 * un verdict vert sur un anneau qui n'a jamais ete rendu. L'entree qui doit faire echouer une
 * correction fausse est exactement celle-ci : `appliques: 0`.
 */
describe('ui-capture --state', () => {
  it('refuse un etat force qui ne touche AUCUN element (entree falsifiante : appliques=0)', () => {
    const v = verdictEtat({ etat: 'attention', selecteur: '.chat-mosaic-window', appliques: 0 })
    expect(v.ok).toBe(false)
    expect(v.echecs).toContain('etat-sans-cible(.chat-mosaic-window)')
  })

  it('accepte un etat applique a au moins un element', () => {
    expect(
      verdictEtat({ etat: 'attention', selecteur: '.chat-mosaic-window', appliques: 2 })
    ).toEqual({
      ok: true,
      echecs: []
    })
  })

  it('rejette un etat hors catalogue et accepte les etats reels du composant', () => {
    expect(resoudreEtat('attention')).toBe('attention')
    expect(resoudreEtat(' Occupe ')).toBe('occupe')
    expect(resoudreEtat('shiny')).toBeUndefined()
    expect(ETATS_CONNUS).toContain('attention')
  })

  /*
   * LE VERDICT QUI « ATTERRIT » (conv-981) : le reflet et la secousse du rond ne jouent qu'a la FIN
   * d'un run vu en cours — aucune navigation ne la produit. Le composant ecrit `data-atterrissage`
   * (anneau-activite.tsx) ; l'etat force ecrit LE MEME attribut, avec la meme valeur.
   */
  it('ecrit l attribut que le composant pose reellement, selon l etat', () => {
    expect(attributDEtat('attention')).toEqual({ nom: 'data-etat', valeur: 'attention' })
    expect(attributDEtat('occupe')).toEqual({ nom: 'data-etat', valeur: 'occupe' })
    expect(attributDEtat('atterrissage-reussi')).toEqual({
      nom: 'data-atterrissage',
      valeur: 'reussi'
    })
    expect(attributDEtat('atterrissage-echec')).toEqual({
      nom: 'data-atterrissage',
      valeur: 'echec'
    })
    expect(resoudreEtat('Atterrissage-Reussi')).toBe('atterrissage-reussi')
    expect(resoudreEtat('atterrissage-rate')).toBeUndefined()
  })
})

import { mediaMouvementEmulee } from './ui-capture.mjs'

/**
 * Mesure du 2026-08-31 : sur le poste reel, matchMedia('(prefers-reduced-motion: reduce)') vaut
 * true — la regle @media coupe l'animation du liseré. Prouver le mouvement exige donc d'emuler
 * explicitement le poste SANS reduction. L'entree falsifiante : `--full-motion` seul doit rendre
 * 'no-preference', et surtout `--reduced-motion` doit rester prioritaire (sinon on prouverait un
 * mouvement dans une condition que l'appelant a justement demande de couper).
 */
describe('emulation prefers-reduced-motion', () => {
  it('rend la valeur emulee selon les drapeaux', () => {
    expect(mediaMouvementEmulee([])).toBeUndefined()
    expect(mediaMouvementEmulee(['--full-motion'])).toBe('no-preference')
    expect(mediaMouvementEmulee(['--reduced-motion'])).toBe('reduce')
    expect(mediaMouvementEmulee(['--full-motion', '--reduced-motion'])).toBe('reduce')
  })
})

import { vueARestaurer } from './ui-capture.mjs'

/**
 * Pourquoi ce test existe : mesure du 2026-09-02 (conv-115). Le harnais clique le VRAI bouton de
 * navigation de la fenetre OUVERTE. Une phase terrain a donc envoye l'utilisateur deux fois sur
 * `knowledge` pendant qu'il travaillait, et l'y a laisse. L'entree falsifiante est celle-ci :
 * l'utilisateur etait sur `chat`, la capture demande `knowledge` -> il faut le ramener sur `chat`.
 */
describe('ui-capture — restitution de la vue de l utilisateur', () => {
  it('ramene l utilisateur la ou il etait (entree falsifiante : chat -> knowledge)', () => {
    expect(vueARestaurer({ vueAvant: 'chat', vueDemandee: 'knowledge' })).toBe('chat')
  })

  it('ne clique rien quand il n y a rien a defaire', () => {
    expect(vueARestaurer({ vueAvant: 'knowledge', vueDemandee: 'knowledge' })).toBeUndefined()
    expect(vueARestaurer({ vueAvant: null, vueDemandee: 'knowledge' })).toBeUndefined()
    expect(vueARestaurer({ vueAvant: 'nulle-part', vueDemandee: 'knowledge' })).toBeUndefined()
    expect(vueARestaurer()).toBeUndefined()
  })
})

import { choixDeListe, tauxDeLectureDuMouvement } from './ui-capture.mjs'

/**
 * `--choisir <selecteur> --valeur <v>` (conv-981, 2026-10-16) : le cercle du changement de theme part
 * du `change` de la liste de Settings · Interface, qu'aucun clic ne declenche (le menu natif d'un
 * <select> s'ouvre hors de la page). ENTREES FALSIFIANTES : `--tour` doit garder SA liste et son
 * prefixe d'echec ; un `--choisir` sans valeur ne doit rien choisir ; le choix doit ralentir
 * l'horloge comme un clic, sinon un cercle de 520 ms finit avant la premiere image.
 */
describe('ui-capture --choisir', () => {
  it('vise la liste nommee et la valeur demandee', () => {
    expect(
      choixDeListe(['--choisir', '[data-testid="interface-theme"]', '--valeur', 'clair'])
    ).toEqual({ selecteur: '[data-testid="interface-theme"]', valeur: 'clair', prefixe: 'liste' })
  })

  it('--tour garde la liste des tours et son prefixe', () => {
    expect(choixDeListe(['--tour', 'turn-7'])).toEqual({
      selecteur: '[data-execution-turn-select]',
      valeur: 'turn-7',
      prefixe: 'tour'
    })
  })

  it('sans valeur, ou sans liste : rien a choisir (jumeau)', () => {
    expect(choixDeListe(['--choisir', 'select'])).toBeNull()
    expect(choixDeListe(['--choisir', 'select', '--valeur', '--motion'])).toBeNull()
    expect(choixDeListe(['--valeur', 'clair'])).toBeNull()
    expect(choixDeListe([])).toBeNull()
  })

  it('avec --motion, le choix ralentit l horloge comme un clic', () => {
    expect(tauxDeLectureDuMouvement(['--motion', 'body', '--choisir', 'select'])).toBe(0.1)
    expect(tauxDeLectureDuMouvement(['--motion', 'body'])).toBe(1)
  })
})
