/**
 * OUVRIR une pièce jointe REÇUE depuis la tuile Interlocuteurs (conv-1220, 2026-10-28).
 *
 * Demande : « rends les pièces jointes reçues cliquables : un clic sur le nom ouvre le fichier, en le
 * récupérant depuis Outlook ». Ce fichier tient la partie du processus principal : ce qui arrive du
 * renderer est revalidé, un type de fichier qui LANCE un programme est refusé avant de toucher
 * Outlook, le nom et le chemin voyagent par un fichier UTF-8 (jamais en argument), et la cause d'un
 * échec arrive jusqu'à l'utilisateur.
 *
 * Le script lui-même (`scripts/outlook-local-piece.ps1`) parle à Outlook par COM : il a été joué sur
 * la vraie boîte le 2026-10-28 (PDF du CSE, 1 434 640 octets, nom accentué intact). Ici, on tient les
 * propriétés de son FICHIER, celles dont la perte a déjà cassé un script Outlook sur ce poste.
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, readFile, rm, stat, utimes, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extensionDePiece,
  OUTLOOK_HORS_INSTANCE_CACHEE,
  OutlookLocalGateway,
  pieceQuiLance
} from './outlook-local'

const ID = 'ABCDEF0123456789ABCDEF0123456789'
const NOM = 'CR réunoin CSE du 13 oct 2026_signé.pdf'
const racines: string[] = []
const ouverts: string[] = []

afterEach(async () => {
  for (const racine of racines.splice(0)) await rm(racine, { recursive: true, force: true })
  // Les pièces « ouvertes » par les tests vivent dans le vrai dossier temporaire : on les retire.
  for (const chemin of ouverts.splice(0))
    await rm(dirname(chemin), { recursive: true, force: true })
})

async function racineFactice(): Promise<string> {
  const racine = await mkdtemp(join(tmpdir(), 'autowin-test-'))
  racines.push(racine)
  return racine
}

/** Un extracteur qui fait ce que fait le script : lit le fichier des chemins, écrit la pièce. */
function extracteurQuiEcrit(code = 0) {
  const appels: Array<{ id: string; rang: number; nom: string; chemin: string; script: string }> =
    []
  const extracteur = vi.fn(
    async (script: string, id: string, rang: number, cheminsPath: string): Promise<number> => {
      const [nom, chemin] = (await readFile(cheminsPath, 'utf8')).split('\n')
      appels.push({ id, rang, nom, chemin, script })
      if (code === 0) await writeFile(chemin, '%PDF-1.7')
      return code
    }
  )
  return { extracteur, appels }
}

function ouvreur(retour = '') {
  return vi.fn(async (chemin: string) => {
    ouverts.push(chemin)
    return retour
  })
}

describe('ouvrir une piece jointe recue', () => {
  it('fait copier la piece par Outlook puis la fait ouvrir par Windows', async () => {
    const { extracteur, appels } = extracteurQuiEcrit()
    const ouvreurFichier = ouvreur()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier
    })

    expect(await passerelle.openAttachment(ID, 1, NOM)).toEqual({ ok: true })

    expect(appels).toHaveLength(1)
    expect(appels[0].script).toMatch(/outlook-local-piece\.ps1$/)
    expect(appels[0].id).toBe(ID)
    expect(appels[0].rang).toBe(1)
    // Le nom ACCENTUÉ arrive intact : il voyage par un fichier UTF-8, pas par la console cp1252.
    expect(appels[0].nom).toBe(NOM)
    expect(appels[0].chemin.endsWith(NOM)).toBe(true)
    // Windows reçoit EXACTEMENT le fichier que le script a écrit, et ce fichier existe encore : il
    // doit rester tant que son programme le tient ouvert.
    expect(ouvreurFichier).toHaveBeenCalledWith(appels[0].chemin)
    expect(readFileSync(appels[0].chemin, 'utf8')).toBe('%PDF-1.7')
  })

  it('retire le fichier des chemins une fois l appel fini, mais garde la piece', async () => {
    let cheminsVu = ''
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: async (_s, _i, _r, cheminsPath) => {
        cheminsVu = cheminsPath
        const [, chemin] = (await readFile(cheminsPath, 'utf8')).split('\n')
        await writeFile(chemin, 'x')
        return 0
      },
      ouvreurFichier: ouvreur()
    })
    await passerelle.openAttachment(ID, 2, 'note.pdf')
    expect(existsSync(cheminsVu)).toBe(false)
    expect(existsSync(ouverts[0])).toBe(true)
  })

  it('un rang inconnu (ancien instantane) part en 1 : le script retrouve la piece par son nom', async () => {
    const { extracteur, appels } = extracteurQuiEcrit()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier: ouvreur()
    })
    expect(await passerelle.openAttachment(ID, null, 'note.pdf')).toEqual({ ok: true })
    expect(appels[0].rang).toBe(1)
  })

  it('refuse ce qui arrive abime du renderer, SANS lancer le script', async () => {
    const { extracteur } = extracteurQuiEcrit()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier: ouvreur()
    })
    const refus = [
      await passerelle.openAttachment('pas-hexa', 1, 'note.pdf'),
      await passerelle.openAttachment(ID, 0, 'note.pdf'),
      await passerelle.openAttachment(ID, 51, 'note.pdf'),
      await passerelle.openAttachment(ID, 1.5, 'note.pdf'),
      await passerelle.openAttachment(ID, '1', 'note.pdf'),
      // Un séparateur de chemin écrirait HORS du dossier temporaire.
      await passerelle.openAttachment(ID, 1, '..\\..\\Startup\\note.pdf'),
      await passerelle.openAttachment(ID, 1, 'a/b.pdf'),
      await passerelle.openAttachment(ID, 1, ''),
      await passerelle.openAttachment(ID, 1, 42)
    ]
    for (const resultat of refus) {
      expect(resultat.ok).toBe(false)
      expect(resultat.erreur).toBeTruthy()
    }
    expect(extracteur).not.toHaveBeenCalled()
  })

  it('refuse un type qui LANCE un programme, avant de toucher Outlook', async () => {
    const { extracteur } = extracteurQuiEcrit()
    const ouvreurFichier = ouvreur()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier
    })
    for (const nom of ['facture.exe', 'facture.pdf.exe', 'script.JS', 'raccourci.lnk', 'x.exe. ']) {
      const resultat = await passerelle.openAttachment(ID, 1, nom)
      expect(resultat.ok).toBe(false)
      // La phrase dit QUOI faire : passer par Outlook, qui contrôle ces fichiers.
      expect(resultat.erreur).toMatch(/Outlook/)
    }
    expect(extracteur).not.toHaveBeenCalled()
    expect(ouvreurFichier).not.toHaveBeenCalled()
  })

  it('traduit chaque code du script en phrase, et ne laisse pas de dossier vide derriere', async () => {
    for (const [code, motif] of [
      [1, /Outlook n'a pas pu fournir/],
      [3, /n’existe plus/],
      [4, /plus dans le message/],
      [9, /Outlook n'a pas pu fournir/]
    ] as const) {
      const { extracteur, appels } = extracteurQuiEcrit(code)
      const ouvreurFichier = ouvreur()
      const passerelle = new OutlookLocalGateway({
        appRoot: await racineFactice(),
        extracteurPiece: extracteur,
        ouvreurFichier
      })
      const resultat = await passerelle.openAttachment(ID, 1, 'note.pdf')
      expect(resultat.ok).toBe(false)
      expect(resultat.erreur).toMatch(motif)
      expect(ouvreurFichier).not.toHaveBeenCalled()
      expect(existsSync(dirname(appels[0].chemin))).toBe(false)
    }
  })

  it('code 0 SANS fichier ecrit : erreur nommee, Windows n est pas appele sur un chemin vide', async () => {
    const ouvreurFichier = ouvreur()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: async () => 0,
      ouvreurFichier
    })
    const resultat = await passerelle.openAttachment(ID, 1, 'note.pdf')
    expect(resultat.ok).toBe(false)
    expect(ouvreurFichier).not.toHaveBeenCalled()
  })

  it('rend la cause donnee par Windows quand il refuse d ouvrir', async () => {
    const { extracteur } = extracteurQuiEcrit()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier: ouvreur('Aucune application associee')
    })
    const resultat = await passerelle.openAttachment(ID, 1, 'note.xyz')
    expect(resultat).toEqual({
      ok: false,
      erreur: 'Windows n’a pas pu ouvrir « note.xyz » : Aucune application associee'
    })
  })

  it('hors service (instance de test cachee) : aucun script, aucune ouverture', async () => {
    const { extracteur } = extracteurQuiEcrit()
    const ouvreurFichier = ouvreur()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier,
      horsService: OUTLOOK_HORS_INSTANCE_CACHEE
    })
    expect(await passerelle.openAttachment(ID, 1, 'note.pdf')).toEqual({
      ok: false,
      erreur: OUTLOOK_HORS_INSTANCE_CACHEE
    })
    expect(extracteur).not.toHaveBeenCalled()
  })

  it('sans ouvreur branche : refus nomme, aucun script', async () => {
    const { extracteur } = extracteurQuiEcrit()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur
    })
    const resultat = await passerelle.openAttachment(ID, 1, 'note.pdf')
    expect(resultat.ok).toBe(false)
    expect(extracteur).not.toHaveBeenCalled()
  })

  it('retire les pieces ouvertes il y a plus d un jour, pas les recentes', async () => {
    const racine = join(tmpdir(), 'autowin-pieces-recues')
    await mkdir(racine, { recursive: true })
    const vieux = await mkdtemp(join(racine, 'p-test-vieux-'))
    const recent = await mkdtemp(join(racine, 'p-test-recent-'))
    racines.push(vieux, recent)
    const ilYaDeuxJours = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000)
    await utimes(vieux, ilYaDeuxJours, ilYaDeuxJours)
    const { extracteur } = extracteurQuiEcrit()
    const passerelle = new OutlookLocalGateway({
      appRoot: await racineFactice(),
      extracteurPiece: extracteur,
      ouvreurFichier: ouvreur()
    })
    await passerelle.openAttachment(ID, 1, 'note.pdf')
    expect(existsSync(vieux)).toBe(false)
    expect((await stat(recent)).isDirectory()).toBe(true)
  })
})

describe('les types de fichier qui lancent un programme', () => {
  it('lit l extension qui decidera du programme, points et espaces finaux compris', () => {
    expect(extensionDePiece('rapport.PDF')).toBe('pdf')
    expect(extensionDePiece('facture.pdf.exe')).toBe('exe')
    // Windows ignore les points et espaces finaux : « x.exe. » s'ouvre comme un .exe.
    expect(extensionDePiece('x.exe. ')).toBe('exe')
    expect(extensionDePiece('LISEZMOI')).toBe('')
  })

  it('refuse la liste Level 1 d Outlook, laisse passer les documents', () => {
    for (const nom of [
      'a.exe',
      'a.bat',
      'a.cmd',
      'a.js',
      'a.vbs',
      'a.ps1',
      'a.lnk',
      'a.hta',
      'a.msi',
      'a.iso',
      'a.url',
      'a.msix'
    ]) {
      expect(pieceQuiLance(nom), nom).toBe(true)
    }
    for (const nom of [
      'a.pdf',
      'a.docx',
      'a.xlsx',
      'a.pptx',
      'a.ics',
      'a.msg',
      'a.txt',
      'a.png',
      'a.html',
      'a.zip'
    ]) {
      expect(pieceQuiLance(nom), nom).toBe(false)
    }
  })
})

describe('le script d enregistrement d une piece recue', () => {
  const chemin = join(__dirname, '..', '..', '..', 'scripts', 'outlook-local-piece.ps1')
  const octets = readFileSync(chemin)
  const code = octets
    .toString('utf8')
    .split(/\r?\n/)
    .filter((ligne) => !/^\s*#/.test(ligne))
    .join('\n')

  it('commence par un BOM UTF-8 et ne contient AUCUN caractere non ASCII', () => {
    // PowerShell 5.1 relit un .ps1 sans BOM en ANSI : un accent y devient un jeton invalide.
    expect([octets[0], octets[1], octets[2]]).toEqual([0xef, 0xbb, 0xbf])
    expect([...octets.subarray(3)].filter((octet) => octet > 0x7f)).toEqual([])
  })

  it('lie Outlook TARDIVEMENT, pas par New-Object -ComObject', () => {
    // Sur ce poste, `New-Object -ComObject` echoue au premier acces membre (0x80040155).
    expect(code).toMatch(/GetTypeFromProgID\('Outlook\.Application'\)/)
    expect(code).not.toMatch(/New-Object\s+-ComObject/)
  })

  it('lit le nom et le chemin dans un fichier UTF-8, et verifie le NOM de la piece', () => {
    expect(code).toMatch(/ReadAllLines\(\$CheminsFichier, \(New-Object System\.Text\.UTF8Encoding/)
    expect(code).toMatch(/\.FileName -eq \$nomAttendu/)
  })

  it('n ouvre rien et n ecrit rien dans la boite : seule operation, SaveAsFile', () => {
    expect(code).toMatch(/\.SaveAsFile\(/)
    for (const interdit of [
      /\.Display\(/,
      /\.Send\(/,
      /\.Save\(\)/,
      /\.UnRead\s*=/,
      /Start-Process/,
      /Invoke-Item/
    ]) {
      expect(code).not.toMatch(interdit)
    }
  })

  it('pose la marque du web, pour que Word et Excel gardent leur mode protege', () => {
    expect(code).toMatch(/Zone\.Identifier/)
    expect(code).toMatch(/ZoneId=3/)
  })

  it('est extrait de l archive au packaging, sinon l app installee ne le trouve pas', () => {
    const config = readFileSync(join(__dirname, '..', '..', '..', 'electron-builder.yml'), 'utf8')
    expect(config).toContain('- scripts/outlook-local-piece.ps1')
  })
})
