import { mkdtemp, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { OutlookLocalGateway } from './outlook-local'

/**
 * PIECES JOINTES d'une REPONSE, cote process principal.
 *
 * Demande de l'utilisateur du 2026-09-09 : « ca marche bien pour les nouveaux fils de message, il
 * faudrait aussi que ca marche pour les messages de reponse ». Le message NEUF porte deja ses
 * pieces (2026-09-08) ; la reponse, non — `replyToItem` ne prenait que l'identifiant et le corps.
 *
 * Les memes deux proprietes que le message neuf, pour les memes raisons deja mesurees sur ce poste :
 *  - RIEN ne passe en argument de ligne de commande : la liste des chemins voyage par un fichier
 *    UTF-8, comme le corps (la console est en cp1252, et un texte libre en argument est
 *    interpretable) ;
 *  - le NOM affiche au destinataire est celui du fichier ecrit, donc chaque piece a son propre
 *    sous-dossier : deux pieces homonymes s'ecraseraient, et renommer changerait ce qui est recu.
 *
 * Et une propriete propre a l'envoi : une piece REFUSEE annule la reponse entiere. Un envoi est
 * irreversible, et une reponse partie sans son devis se lit comme une reponse envoyee.
 */

const ID = 'A'.repeat(32)

async function racineFactice(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'autowin-test-reponse-pieces-'))
}

/** Une piece jointe telle que le renderer l'envoie : un nom, une taille, le contenu en base64. */
function piece(nom: string, contenu: string) {
  const octets = Buffer.from(contenu, 'utf8')
  return { nom, taille: octets.length, contenuBase64: octets.toString('base64') }
}

describe('reponse avec pieces jointes', () => {
  it('ECRIT chaque piece sur le disque et passe la LISTE par un fichier, pas en argument', async () => {
    let piecesPathVu = ''
    let lignes: string[] = []
    const relus: Array<{ nom: string; contenu: string }> = []
    const replier = vi.fn(
      async (_script: string, _id: string, _corpsPath: string, piecesPath?: string) => {
        piecesPathVu = piecesPath ?? ''
        lignes = (await readFile(piecesPathVu, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
        for (const ligne of lignes) {
          relus.push({ nom: basename(ligne), contenu: await readFile(ligne, 'utf8') })
        }
        return 0
      }
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem(ID, 'Ci-joint', [
      piece('devis.pdf', 'PDF-1'),
      piece('note ete.txt', 'un accent')
    ])
    expect(resultat.ok).toBe(true)
    expect(piecesPathVu).not.toBe('')
    // La liste est un FICHIER, et son contenu des chemins absolus : rien de cela n'apparait dans
    // les arguments passes au script.
    expect(lignes).toHaveLength(2)
    expect(lignes.every((ligne) => isAbsolute(ligne))).toBe(true)
    expect(relus).toEqual([
      { nom: 'devis.pdf', contenu: 'PDF-1' },
      { nom: 'note ete.txt', contenu: 'un accent' }
    ])
  })

  it('n envoie AUCUN fichier de liste quand la reponse n a pas de piece', async () => {
    const replier = vi.fn(async (_s: string, _i: string, _c: string, _piecesPath?: string) => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    expect((await passerelle.replyToItem(ID, 'Merci')).ok).toBe(true)
    // Une reponse sans piece part exactement comme avant : le script ne recoit pas le parametre.
    expect(replier.mock.calls[0]?.[3]).toBeUndefined()
  })

  it('garde deux pieces HOMONYMES distinctes', async () => {
    let chemins: string[] = []
    let contenus: string[] = []
    // Le contenu est relu DANS le mock : au retour de `replyToItem`, le dossier temporaire est deja
    // efface -- c'est la propriete que verifie le dernier test de ce fichier.
    const replier = vi.fn(async (_s: string, _i: string, _c: string, piecesPath?: string) => {
      chemins = (await readFile(piecesPath!, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
      contenus = await Promise.all(chemins.map((chemin) => readFile(chemin, 'utf8')))
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    await passerelle.replyToItem(ID, 'deux fois', [
      piece('devis.pdf', 'premier'),
      piece('devis.pdf', 'second')
    ])
    expect(chemins).toHaveLength(2)
    expect(basename(chemins[0])).toBe('devis.pdf')
    expect(basename(chemins[1])).toBe('devis.pdf')
    // Le NOM est celui que verra le destinataire : c'est le DOSSIER qui les separe, pas un suffixe.
    expect(dirname(chemins[0])).not.toBe(dirname(chemins[1]))
    expect(contenus).toEqual(['premier', 'second'])
  })

  it('REFUSE la reponse entiere quand un nom de piece remonte dans l arborescence', async () => {
    const replier = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem(ID, 'texte', [piece('..\\..\\ailleurs.txt', 'x')])
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur).toContain('nom')
    // Rien n'est parti : le refus ANNULE l'envoi, il ne le laisse pas partir sans la piece.
    expect(replier).not.toHaveBeenCalled()
  })

  it('REFUSE la reponse quand une piece est trop grosse ou le total trop lourd', async () => {
    const replier = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const grosse = {
      nom: 'gros.bin',
      taille: 11 * 1024 * 1024,
      contenuBase64: Buffer.alloc(11 * 1024 * 1024).toString('base64')
    }
    const refusGrosse = await passerelle.replyToItem(ID, 'texte', [grosse])
    expect(refusGrosse.ok).toBe(false)
    expect(refusGrosse.erreur).toContain('10 Mo')

    const moyenne = (rang: number) => ({
      nom: `p${rang}.bin`,
      taille: 8 * 1024 * 1024,
      contenuBase64: Buffer.alloc(8 * 1024 * 1024).toString('base64')
    })
    const refusTotal = await passerelle.replyToItem(ID, 'texte', [
      moyenne(1),
      moyenne(2),
      moyenne(3)
    ])
    expect(refusTotal.ok).toBe(false)
    expect(refusTotal.erreur).toContain('20 Mo')
    expect(replier).not.toHaveBeenCalled()
  })

  it('REFUSE une piece dont le contenu n est pas du base64', async () => {
    const replier = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem(ID, 'texte', [
      { nom: 'devis.pdf', taille: 3, contenuBase64: 'pas du base64 !!' }
    ])
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur).toContain('devis.pdf')
    expect(replier).not.toHaveBeenCalled()
  })

  it('NOMME la cause quand Outlook refuse une piece jointe de la reponse', async () => {
    // Code 7 du script : la piece a ete refusee. « Outlook n'a pas pu envoyer cette reponse »
    // ferait chercher l'erreur du cote du texte.
    const replier = vi.fn(async () => 7)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    const resultat = await passerelle.replyToItem(ID, 'texte', [piece('devis.pdf', 'x')])
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur).toContain('pièce jointe')
  })

  it('EFFACE les pieces du disque apres l envoi de la reponse', async () => {
    let lignes: string[] = []
    const replier = vi.fn(async (_s: string, _i: string, _c: string, piecesPath?: string) => {
      lignes = (await readFile(piecesPath!, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
      return 0
    })
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), replier })
    await passerelle.replyToItem(ID, 'texte', [piece('devis.pdf', 'secret')])
    expect(lignes).toHaveLength(1)
    // Le contenu d'une piece ne traine pas dans le dossier temporaire une fois la reponse partie.
    await expect(readFile(lignes[0], 'utf8')).rejects.toThrow()
  })
})

describe('script de reponse : pieces jointes', () => {
  const chemin = join(process.cwd(), 'scripts/outlook-local-reply.ps1')
  const octets = readFileSync(chemin)
  const lignes = octets
    .toString('utf8')
    .replace(/^\ufeff/, '')
    .split(/\r?\n/)
    .filter((ligne) => !ligne.trimStart().startsWith('#'))
    .join('\n')

  it('commence par un BOM UTF-8 et ne contient AUCUN caractere non ASCII', () => {
    // PowerShell 5.1 relit un .ps1 sans BOM en ANSI : un accent y devient un jeton invalide.
    expect([octets[0], octets[1], octets[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect(octets.subarray(3).some((octet) => octet > 0x7f)).toBe(false)
  })

  it('accepte une LISTE de pieces jointes par fichier, jamais en argument', () => {
    expect(lignes).toContain('$PiecesFichier')
    // Le parametre est OPTIONNEL : une reponse sans piece part exactement comme avant.
    expect(lignes).toMatch(/Mandatory = \$false\)\]\[string\]\$PiecesFichier/)
    expect(lignes).toContain('ReadAllLines($PiecesFichier')
  })

  it('joint les pieces AVANT d envoyer, et nomme le refus d une piece', () => {
    expect(lignes).toContain('Attachments.Add')
    expect(lignes).toContain('exit 7')
    // Une piece ajoutee apres `.Send()` n'arriverait jamais.
    expect(lignes.indexOf('Attachments.Add')).toBeLessThan(lignes.indexOf('.Send()'))
  })
})
