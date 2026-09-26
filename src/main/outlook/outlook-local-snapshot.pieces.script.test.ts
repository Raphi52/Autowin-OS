import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Gardes de NON-REGRESSION sur la LECTURE des pièces jointes reçues, dans le script d'instantané.
 *
 * Ce script ne peut pas être exercé depuis un test unitaire : son cœur est un dialogue COM avec
 * Outlook. Restent les propriétés du FICHIER — et ce sont exactement celles dont la perte remet une
 * panne déjà mesurée sur ce poste :
 *
 *  - l'ENCODAGE : Windows PowerShell 5.1 relit un `.ps1` sans BOM en ANSI, et un accent y devient un
 *    jeton invalide. Les scripts Outlook sont donc en ASCII + BOM, sans exception ;
 *  - le FILTRE par Content-ID : sonde du 2026-09-10 sur la vraie boîte, 40 messages lus. Les 22
 *    images de signature (`image001.png`, `image002.png`) portent TOUTES un Content-ID non vide
 *    (`image001.png@01DD3B95.4EB89B30`), et les 3 vraies pièces (`convocation individuelle -
 *    promeom v3_....pdf` 859335 octets, un `.ics`, `PV reunion CSE 23 juin 2026.pdf`) ont TOUTES un
 *    Content-ID VIDE. Sans ce filtre, le fil annonce « 1 pièce jointe » sur chaque message qui n'en
 *    a aucune, et l'information devient un bruit permanent ;
 *  - le drapeau PR_ATTACHMENT_HIDDEN (`0x7FFE000B`), qui est la solution qu'on trouve d'abord,
 *    n'est PAS lisible ici : la même sonde a rendu une ERREUR de lecture sur les 25 pièces. Un
 *    filtre bâti sur lui laisserait donc tout passer. Il ne doit pas revenir ;
 *  - la LECTURE PROTÉGÉE : `Attachments` peut lever (élément distant non téléchargé, protection
 *    antivirus). Une exception non capturée ici ferait perdre l'instantané ENTIER, donc la tuile,
 *    pour une pièce jointe illisible.
 */
describe('lecture des pieces jointes recues dans le script d instantane', () => {
  const chemin = join(__dirname, '..', '..', '..', 'scripts', 'outlook-local-snapshot.ps1')
  const octets = readFileSync(chemin)
  const script = octets.toString('utf8')
  /** Les commentaires PORTENT la raison et citent les pièges : ne pas les confondre avec du code. */
  const code = script
    .split(/\r?\n/)
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join('\n')

  it('commence par un BOM UTF-8 et ne contient AUCUN caractere non ASCII', () => {
    expect([octets[0], octets[1], octets[2]]).toEqual([0xef, 0xbb, 0xbf])
    const horsAscii = [...octets.subarray(3)].filter((octet) => octet > 0x7f)
    expect(horsAscii).toEqual([])
  })

  it('lit bien les pieces jointes et les rapporte sous le champ pieces', () => {
    expect(code).toMatch(/\.Attachments/)
    expect(code).toMatch(/pieces\s*=/)
  })

  it('ecarte les images intégrées par leur Content-ID, pas par PR_ATTACHMENT_HIDDEN', () => {
    // Le proptag du Content-ID (PR_ATTACH_CONTENT_ID), la seule marque qui distingue vraiment une
    // image de signature d'une piece jointe sur cette boite.
    expect(code).toMatch(/0x3712001F/i)
    // Le drapeau « cache » n'est pas lisible ici : s'y fier revient a ne plus filtrer du tout.
    expect(code).not.toMatch(/0x7FFE000B/i)
  })

  it('lit les pieces sous try/catch, pour ne pas perdre l instantane entier', () => {
    const debut = code.indexOf('.Attachments')
    expect(debut).toBeGreaterThan(-1)
    // Le bloc qui touche `Attachments` est gardé : on remonte au `try` qui le précède, et on vérifie
    // qu'un `catch` le suit — sinon une seule pièce illisible emporte toute la tuile.
    const avant = code.lastIndexOf('try', debut)
    expect(avant).toBeGreaterThan(-1)
    expect(code.indexOf('catch', debut)).toBeGreaterThan(debut)
  })

  it('plafonne le nombre de pieces lues par message', () => {
    // Chaque piece lue est un aller-retour COM ; 300 messages sans plafond feraient durer l'appel.
    expect(code).toMatch(/MaxPieces/)
  })
})
