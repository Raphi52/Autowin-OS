import { mkdtemp, readFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it, vi } from 'vitest'
import { OutlookLocalGateway } from './outlook-local'

/**
 * PIECES JOINTES d'un message NEUF, cote process principal.
 *
 * Demande de l'utilisateur du 2026-09-08 : glisser un PDF dans l'ecran « nouveau message » de la
 * tuile Interlocuteurs. Le renderer ne peut pas passer un chemin disque — il lit le CONTENU du
 * fichier lache (un fichier glisse depuis Outlook n'existe meme pas sur le disque). C'est donc ici
 * que les octets redeviennent des fichiers, et ici qu'ils sont valides : ce qui arrive vient du
 * renderer par IPC, et une frontiere de confiance ne se garde pas d'un seul cote.
 *
 * Deux proprietes structurent ces tests, chacune adossee a une contrainte deja mesuree sur ce poste :
 *  - RIEN ne passe en argument de ligne de commande sauf l'adresse (la console est en cp1252) : la
 *    liste des chemins voyage par un fichier UTF-8, comme l'objet et le corps ;
 *  - le NOM affiche au destinataire est celui du fichier ecrit : chaque piece a donc son propre
 *    sous-dossier, sinon deux pieces homonymes s'ecraseraient ou il faudrait renommer.
 */

async function racineFactice(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'autowin-test-pieces-'))
}

/** Une piece jointe telle que le renderer l'envoie : un nom, une taille, le contenu en base64. */
function piece(nom: string, contenu: string) {
  const octets = Buffer.from(contenu, 'utf8')
  return { nom, taille: octets.length, contenuBase64: octets.toString('base64') }
}

describe('message neuf avec pieces jointes', () => {
  it('ECRIT chaque piece sur le disque et passe la LISTE par un fichier, pas en argument', async () => {
    let piecesPathVu = ''
    let lignes: string[] = []
    const relus: Array<{ nom: string; contenu: string }> = []
    const redacteur = vi.fn(
      async (
        _script: string,
        _adresse: string,
        _objetPath: string,
        _corpsPath: string,
        piecesPath?: string
      ) => {
        piecesPathVu = piecesPath ?? ''
        lignes = (await readFile(piecesPathVu, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
        for (const ligne of lignes) {
          relus.push({ nom: basename(ligne), contenu: await readFile(ligne, 'utf8') })
        }
        return 0
      }
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    const resultat = await passerelle.sendNew('zoe@ex.fr', 'Devis', 'Ci-joint', [
      piece('devis.pdf', 'PDF-1'),
      piece('note été.txt', 'un accent')
    ])
    expect(resultat.ok).toBe(true)
    expect(piecesPathVu).not.toBe('')
    expect(lignes.every((ligne) => isAbsolute(ligne))).toBe(true)
    // Le nom vu par le destinataire est celui du fichier : il est conserve tel quel, accents compris.
    expect(relus).toEqual([
      { nom: 'devis.pdf', contenu: 'PDF-1' },
      { nom: 'note été.txt', contenu: 'un accent' }
    ])
    // Chaque piece dans son propre sous-dossier : deux homonymes ne s'ecrasent pas.
    expect(new Set(lignes.map((ligne) => dirname(ligne))).size).toBe(2)
  })

  it('n envoie AUCUN fichier de liste quand il n y a pas de piece', async () => {
    // Le script doit rester utilisable comme avant : pas de fichier vide a interpreter.
    const redacteur = vi.fn(
      async (_s: string, _a: string, _o: string, _c: string, _piecesPath?: string) => 0
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    expect((await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps')).ok).toBe(true)
    expect(redacteur.mock.calls[0][4]).toBeUndefined()
    expect((await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [])).ok).toBe(true)
    expect(redacteur.mock.calls[1][4]).toBeUndefined()
  })

  it('garde deux pieces HOMONYMES distinctes', async () => {
    // Les contenus sont relus DANS le redacteur : apres l'envoi les fichiers sont effaces (voir le
    // dernier test de ce fichier), donc les relire ensuite ne prouverait rien.
    let chemins: string[] = []
    let contenus: string[] = []
    const redacteur = vi.fn(
      async (_s: string, _a: string, _o: string, _c: string, piecesPath?: string) => {
        chemins = (await readFile(piecesPath!, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
        contenus = await Promise.all(chemins.map((chemin) => readFile(chemin, 'utf8')))
        return 0
      }
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    const resultat = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [
      piece('devis.pdf', 'premier'),
      piece('devis.pdf', 'second')
    ])
    expect(resultat.ok).toBe(true)
    expect(chemins).toHaveLength(2)
    // Meme nom de fichier des deux cotes : c'est celui que verra le destinataire.
    expect(chemins.map((chemin) => basename(chemin))).toEqual(['devis.pdf', 'devis.pdf'])
    expect(contenus).toEqual(['premier', 'second'])
  })

  it('REFUSE un nom de piece qui remonte dans l arborescence', async () => {
    // Le nom vient du renderer : il sert a NOMMER un fichier ecrit sur le disque. Un chemin y
    // ecrirait ailleurs que dans le dossier temporaire.
    const redacteur = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    for (const nom of ['../evade.pdf', '..\\evade.pdf', 'C:\\Windows\\evade.pdf', '  ', '.']) {
      const resultat = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [
        piece(nom, 'contenu')
      ])
      expect(resultat.ok, nom).toBe(false)
      expect(resultat.erreur ?? '', nom).toMatch(/nom/i)
    }
    expect(redacteur).not.toHaveBeenCalled()
  })

  it('REFUSE l envoi entier quand une piece est trop grosse ou le total trop lourd', async () => {
    // Un envoi est irreversible : on ne part pas SANS la piece que l'utilisateur a jointe, on refuse.
    const redacteur = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    const gros = {
      nom: 'gros.pdf',
      taille: 11 * 1024 * 1024,
      contenuBase64: Buffer.alloc(11 * 1024 * 1024, 1).toString('base64')
    }
    const trop = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [gros])
    expect(trop.ok).toBe(false)
    expect(trop.erreur ?? '').toMatch(/10 Mo/)

    const moyen = (nom: string) => ({
      nom,
      taille: 8 * 1024 * 1024,
      contenuBase64: Buffer.alloc(8 * 1024 * 1024, 2).toString('base64')
    })
    const total = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [
      moyen('a.pdf'),
      moyen('b.pdf'),
      moyen('c.pdf')
    ])
    expect(total.ok).toBe(false)
    expect(total.erreur ?? '').toMatch(/20 Mo/)
    expect(redacteur).not.toHaveBeenCalled()
  })

  it('REFUSE une piece dont le contenu n est pas du base64', async () => {
    const redacteur = vi.fn(async () => 0)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    const resultat = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [
      { nom: 'devis.pdf', taille: 3, contenuBase64: 'pas du base64 !!' }
    ])
    expect(resultat.ok).toBe(false)
    expect(redacteur).not.toHaveBeenCalled()
  })

  it('NOMME la cause quand Outlook refuse une piece jointe', async () => {
    // Code 7, propre a ce chemin. Sans lui, « Outlook n'a pas pu envoyer ce message » ferait
    // chercher l'erreur du cote de l'adresse ou du texte.
    const redacteur = vi.fn(async () => 7)
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    const resultat = await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [
      piece('devis.pdf', 'PDF-1')
    ])
    expect(resultat.ok).toBe(false)
    expect(resultat.erreur ?? '').toMatch(/pi[eè]ce/i)
  })

  it('EFFACE les pieces du disque apres l envoi', async () => {
    // Le PDF d'un client ne traine pas dans le dossier temporaire une fois le message parti.
    let lignes: string[] = []
    const redacteur = vi.fn(
      async (_s: string, _a: string, _o: string, _c: string, piecesPath?: string) => {
        lignes = (await readFile(piecesPath!, 'utf8')).split(/\r?\n/).filter((l) => l !== '')
        return 0
      }
    )
    const passerelle = new OutlookLocalGateway({ appRoot: await racineFactice(), redacteur })
    await passerelle.sendNew('zoe@ex.fr', 'Objet', 'Corps', [piece('devis.pdf', 'PDF-1')])
    await expect(readFile(lignes[0], 'utf8')).rejects.toThrow()
  })
})
