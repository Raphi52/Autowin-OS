/**
 * L'EN-TETE de `interlocuteurs-pieces.ts` doit dire POURQUOI ce module existe — et il sert
 * desormais DEUX ecrans, pas un seul.
 *
 * Ce module a ete ecrit le 2026-09-08 pour le seul ecran « nouveau message » de la tuile
 * Interlocuteurs. La livraison du 2026-09-09 (`1f96f542`) l'a branche AUSSI sur l'ecran de
 * reponse : `preparerPiecesLachees` a maintenant deux sites d'appel dans
 * `InterlocuteursWidget.tsx` — un dans `EcranConversation`, un dans `EcranNouveau`. Un en-tete
 * qui ne parle que du message neuf ferait croire au prochain lecteur qu'il peut deplacer un
 * plafond ou reecrire le texte d'un refus sans consequence sur la reponse. C'est exactement le
 * genre de partage invisible qui produit une regression sur un ecran qu'on n'a pas ouvert.
 *
 * L'ENTREE qui rend ce fichier ROUGE si la correction est fausse : remettre l'en-tete du
 * 2026-09-08, celui qui ne cite que « nouveau message ». C'est le defaut le PLUS PROBABLE,
 * puisque c'est l'etat du fichier avant cette correction — et c'est aussi ce qui arriverait a un
 * `git revert` du commit de documentation. Les deux tests tombent alors : ni le mot « reponse »,
 * ni `EcranConversation` ne figurent dans ce texte.
 *
 * Ce fichier ne se contente pas de chercher des mots : il COMPTE les sites d'appel reels dans le
 * widget et exige que l'en-tete en nomme autant. Brancher un TROISIEME ecran sans le documenter
 * le rend rouge aussi — c'est la seule facon qu'un commentaire reste vrai plus d'une semaine.
 *
 * Ce que ce fichier ne verifie PAS, volontairement : le comportement du module. Les plafonds, le
 * refus nomme et la lecture du contenu sont deja tenus par `InterlocuteursWidget.pieces.test.tsx`
 * et `InterlocuteursWidget.reponse-pieces.test.tsx`, aux deux sites d'appel.
 */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const source = (nom: string): string => readFileSync(new URL(`./${nom}`, import.meta.url), 'utf8')

/** L'en-tete = le premier bloc de commentaire du fichier, avant toute ligne executable. */
const entete = (): string => {
  const texte = source('interlocuteurs-pieces.ts')
  expect(texte.startsWith('/**')).toBe(true)
  const fin = texte.indexOf('*/')
  expect(fin).toBeGreaterThan(0)
  return texte.slice(0, fin)
}

describe("interlocuteurs-pieces : l'en-tete documente les deux ecrans servis", () => {
  it('nomme le chemin de REPONSE, pas seulement le message neuf', () => {
    const tete = entete()
    expect(tete).toMatch(/nouveau message/i)
    expect(tete).toMatch(/r[eé]ponse/i)
  })

  it('nomme chacun des ecrans qui appellent preparerPiecesLachees', () => {
    const sites = source('InterlocuteursWidget.tsx').match(/preparerPiecesLachees\(/g) ?? []
    // Deux sites aujourd'hui. Si ce chiffre bouge, l'en-tete doit bouger avec lui.
    expect(sites.length).toBe(2)
    const tete = entete()
    for (const ecran of ['EcranConversation', 'EcranNouveau']) {
      expect(tete).toContain(ecran)
    }
  })
})
