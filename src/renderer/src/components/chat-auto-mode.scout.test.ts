import { describe, expect, it } from 'vitest'
import { lireCibleScout } from './chat-auto-mode'

/*
 * APRES UN SCOUT — un scout rend PLUSIEURS pistes. Sans regle, le maillon suivant du mode auto
 * repart sur le tableau entier : la boucle enchaine un tour PAYANT sur une cible que personne n'a
 * choisie. Cadrage du 2026-09-05 (conv-308, decision B incluant A) : la sortie d'un scout porte en
 * TETE une ligne `CIBLE:` ; l'absence de cible est une FIN de chaine ; une cible destructrice ne
 * part JAMAIS toute seule, elle demande l'accord de l'utilisateur.
 *
 * La porte se teste sur la FORME (une cible nommee existe), jamais sur la qualite du choix :
 * producteur et juge sont le meme modele, un critere de qualite auto-attribue ne prouve rien.
 */

const scout = (...lignes: string[]): string => lignes.join('\n')

describe('lireCibleScout — la ligne CIBLE:', () => {
  it('lit la cible posee en TETE de la sortie du scout', () => {
    expect(
      lireCibleScout(
        scout('CIBLE: durcir la porte anti-boucle', 'POURQUOI: 19,38 $ de tours perdus', '| autre piste |')
      )
    ).toEqual({ statut: 'cible', cible: 'durcir la porte anti-boucle' })
  })

  it('accepte les decorations de mise en forme autour de la ligne', () => {
    expect(lireCibleScout(scout('**CIBLE :** ranger les journaux', 'POURQUOI: bruit'))).toEqual({
      statut: 'cible',
      cible: 'ranger les journaux'
    })
  })

  it('CAS LIMITE — une ligne CIBLE: NOYEE au milieu du texte compte quand meme', () => {
    expect(lireCibleScout(scout('Voici mes pistes :', '', 'CIBLE: reprendre le cache'))).toEqual({
      statut: 'cible',
      cible: 'reprendre le cache'
    })
  })

  it('CAS LIMITE — la PREMIERE ligne CIBLE: fait foi, les suivantes sont ignorees', () => {
    expect(lireCibleScout(scout('CIBLE: la premiere', 'CIBLE: la seconde'))).toEqual({
      statut: 'cible',
      cible: 'la premiere'
    })
  })
})

describe('lireCibleScout — aucune cible = fin de run', () => {
  it('rend « aucune-cible » quand le scout n’ecrit AUCUNE ligne CIBLE:', () => {
    expect(lireCibleScout(scout('| piste | cout |', '| ranger | faible |'))).toEqual({
      statut: 'aucune-cible'
    })
  })

  it('rend « aucune-cible » quand le scout ecrit explicitement CIBLE: aucune', () => {
    expect(lireCibleScout('CIBLE: aucune')).toEqual({ statut: 'aucune-cible' })
    expect(lireCibleScout('CIBLE: rien')).toEqual({ statut: 'aucune-cible' })
  })

  it('CAS LIMITE — une ligne CIBLE: VIDE ne vaut pas une cible', () => {
    expect(lireCibleScout(scout('CIBLE:', 'POURQUOI: je ne sais pas'))).toEqual({
      statut: 'aucune-cible'
    })
  })

  it('CAS LIMITE — un texte vide est une fin, pas une erreur', () => {
    expect(lireCibleScout('')).toEqual({ statut: 'aucune-cible' })
  })
})

describe('lireCibleScout — cible destructrice', () => {
  it('refuse de lancer tout seul une cible qui DETRUIT', () => {
    expect(lireCibleScout('CIBLE: supprimer les 6 396 dossiers de run accumules')).toEqual({
      statut: 'cible-destructrice',
      cible: 'supprimer les 6 396 dossiers de run accumules'
    })
  })

  it('couvre les formulations techniques les plus couteuses', () => {
    for (const cible of [
      'rm -rf out/',
      'git reset --hard origin/main',
      'faire un force push sur main',
      'DROP TABLE conversations',
      'ecraser le dossier de donnees utilisateur'
    ])
      expect(lireCibleScout(`CIBLE: ${cible}`).statut).toBe('cible-destructrice')
  })

  it('CAS LIMITE — « supprimer » dans une piste ECARTEE ne contamine pas la cible retenue', () => {
    expect(
      lireCibleScout(scout('CIBLE: documenter la porte anti-boucle', 'Ecartee : supprimer le cache'))
    ).toEqual({ statut: 'cible', cible: 'documenter la porte anti-boucle' })
  })
})
