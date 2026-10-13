import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import {
  nomsDesProfils,
  termeTrouve,
  termesDesProfils,
  texteDuFichier
} from '../../scripts/identite-entreprise.mjs'

/**
 * SEPARATION ENTREPRISE / PRODUIT — garde du 2026-10-13 (conv-913, etendue en conv-916).
 *
 * Demande de l'utilisateur : la version publique du depot ne nomme AUCUNE entreprise, et tout ce qui
 * est propre a une entreprise vit dans `entreprise/<nom>/`. La version publique est ce depot SANS ce
 * dossier : il suffit donc qu'aucun fichier hors de `entreprise/` ne porte le nom, ni dans son
 * contenu (texte, UTF-16), ni dans son chemin — et que le code n'importe jamais `entreprise/`, sinon
 * la version publique ne compilerait plus.
 *
 * conv-916 : le NOM ne suffit pas. Le metier, le serveur de fichiers, les collegues et les chemins
 * personnels designent l'entreprise sans la nommer. Chaque profil les declare dans
 * `termesInterdits` (des motifs, cf. `scripts/identite-entreprise.mjs`) et la garde les interdit
 * comme le nom.
 *
 * Noms et termes viennent des PROFILS eux-memes, lus par `scripts/identite-entreprise.mjs` — la MEME
 * fonction que l'export public : ecrits en clair ici, ce test serait lui-meme une mention, et une
 * nouvelle entreprise est couverte sans le modifier. Le dossier est lu directement : la variable
 * publiee par l'app vaut `{}` pendant les tests. Sans dossier `entreprise/` (version publique), il
 * n'y a rien a proteger.
 * Perimetre : fichiers suivis ET fichiers nouveaux non ignores (`git ls-files --others
 * --exclude-standard`) — un fichier pas encore ajoute serait publie au prochain commit.
 */
const ROOT = process.cwd()
const DOSSIER_ENTREPRISE = 'entreprise/'

const NOMS_INTERDITS: string[] = nomsDesProfils(ROOT)
const TERMES = termesDesProfils(ROOT)

function fichiersDuDepot(): string[] {
  const sortie = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { cwd: ROOT, maxBuffer: 64 * 1024 * 1024 }
  ).toString('utf8')
  return [...new Set(sortie.split('\0').filter(Boolean))]
}

/** Le nom en UTF-8/ASCII (casse ignoree) et en UTF-16LE, l'encodage des scripts PowerShell. */
function contientUnNom(octets: Buffer): string | undefined {
  const minuscule = octets.toString('latin1').toLowerCase()
  for (const nom of NOMS_INTERDITS) {
    if (minuscule.includes(nom)) return nom
    const utf16 = Buffer.from(nom, 'utf16le').toString('latin1')
    if (minuscule.includes(utf16)) return nom
  }
  return undefined
}

function horsEntreprise(chemin: string): boolean {
  return !chemin.startsWith(DOSSIER_ENTREPRISE)
}

function lire(chemin: string): Buffer | undefined {
  const complet = join(ROOT, chemin)
  try {
    if (!statSync(complet).isFile()) return undefined
    return readFileSync(complet)
  } catch {
    return undefined // supprime du disque mais encore indexe : rien a publier de son contenu
  }
}

describe('separation entreprise / produit', () => {
  const fichiers = fichiersDuDepot().filter(horsEntreprise)

  it('chaque profil d entreprise fournit un nom assez long pour etre garde', () => {
    if (!existsSync(join(ROOT, 'entreprise'))) return
    expect(NOMS_INTERDITS.length).toBeGreaterThan(0)
    expect(NOMS_INTERDITS.filter((nom) => nom.length < 4)).toEqual([])
  })

  it('aucun chemin hors de entreprise/ ne porte un nom d entreprise', () => {
    const fautifs = fichiers.filter((chemin) =>
      NOMS_INTERDITS.some((nom) => chemin.toLowerCase().includes(nom))
    )
    expect(fautifs).toEqual([])
  })

  it('aucun fichier hors de entreprise/ ne contient un nom d entreprise', () => {
    const fautifs: string[] = []
    for (const chemin of fichiers) {
      const octets = lire(chemin)
      if (octets && contientUnNom(octets)) fautifs.push(chemin)
    }
    expect(fautifs).toEqual([])
  })

  it('les termes interdits des profils sont lisibles : une faute ne desarme pas la garde', () => {
    expect(TERMES.erreurs).toEqual([])
  })

  it('aucun chemin hors de entreprise/ ne porte un terme interdit', () => {
    const fautifs = fichiers.filter((chemin) => termeTrouve(chemin, TERMES.termes))
    expect(fautifs).toEqual([])
  })

  it('aucun fichier hors de entreprise/ ne contient un terme interdit', () => {
    const fautifs: string[] = []
    for (const chemin of fichiers) {
      const octets = lire(chemin)
      const terme = octets && termeTrouve(texteDuFichier(octets), TERMES.termes)
      if (terme) fautifs.push(`${chemin} — ${terme.profil}[${terme.rang}] ${terme.sujet}`)
    }
    expect(fautifs).toEqual([])
  })

  it('le code n importe jamais entreprise/ : la version publique doit compiler sans lui', () => {
    const importe = /(?:\bfrom\s+|\bimport\s*\(\s*|\brequire\s*\(\s*)['"][^'"]*\bentreprise\//
    const fautifs = fichiers
      .filter((chemin) => /\.(?:[cm]?[jt]sx?)$/.test(chemin))
      .filter((chemin) => {
        try {
          return importe.test(readFileSync(join(ROOT, chemin), 'utf8'))
        } catch {
          return false
        }
      })
    expect(fautifs).toEqual([])
  })
})

/**
 * Le lecteur de termes lui-meme, sur des profils FICTIFS : une garde dont la regle se desarme en
 * silence ne protege rien. Chaque refus a son jumeau accepte.
 */
describe('termes interdits : lecture des profils', () => {
  const racines: string[] = []
  afterAll(() => {
    for (const racine of racines) rmSync(racine, { recursive: true, force: true })
  })
  const depot = (profils: Record<string, unknown>): string => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-termes-'))
    racines.push(racine)
    for (const [nom, contenu] of Object.entries(profils)) {
      mkdirSync(join(racine, 'entreprise', nom), { recursive: true })
      writeFileSync(
        join(racine, 'entreprise', nom, 'identite.json'),
        typeof contenu === 'string' ? contenu : JSON.stringify(contenu)
      )
    }
    return racine
  }

  it('sans dossier entreprise/ (version publique) : aucun terme, aucune erreur', () => {
    expect(termesDesProfils(depot({}))).toEqual({ termes: [], erreurs: [] })
  })

  it('un profil sans liste ne protege que son nom, sans erreur', () => {
    const racine = depot({ acme: { nom: 'Acme' } })
    expect(termesDesProfils(racine)).toEqual({ termes: [], erreurs: [] })
    expect(nomsDesProfils(racine)).toEqual(['acme'])
  })

  it('une liste mal formee est une erreur nommee, jamais une liste vide', () => {
    expect(termesDesProfils(depot({ acme: { termesInterdits: 'ZORG' } })).erreurs).toEqual([
      'acme : termesInterdits doit etre une liste'
    ])
    const { termes, erreurs } = termesDesProfils(
      depot({
        acme: {
          termesInterdits: [
            { motif: '' },
            42,
            { motif: '(' },
            { motif: 'zorg', ignorerCasse: 'oui' },
            { motif: 'ZORG' }
          ]
        }
      })
    )
    expect(erreurs).toEqual([
      'acme : termesInterdits[0] : motif vide',
      'acme : termesInterdits[1] : motif absent',
      expect.stringMatching(/^acme : termesInterdits\[2\] : motif illisible/),
      'acme : termesInterdits[3] : ignorerCasse doit etre vrai ou faux'
    ])
    // Jumeau accepte, dans la meme liste : le motif valide reste garde.
    expect(termes.map((terme) => terme.rang)).toEqual([4])
  })

  it('un profil illisible est une erreur : ses termes seraient perdus', () => {
    expect(termesDesProfils(depot({ acme: '{ pas du json' })).erreurs).toEqual([
      'acme/identite.json : profil illisible, termes interdits inconnus'
    ])
  })

  it('un motif qui touche un mot courant est refuse, sa forme bornee est acceptee', () => {
    const { termes, erreurs } = termesDesProfils(
      depot({
        acme: {
          termesInterdits: [
            { motif: 'zag|gin', ignorerCasse: true },
            // Forme bornee : pas de lettre avant, sauf celle d'une sequence d'echappement (`\n`).
            { motif: '(?<!(?<!\\\\)[A-Za-z])gin(?![a-z])', ignorerCasse: true }
          ]
        }
      })
    )
    expect(erreurs).toEqual(['acme : termesInterdits[0] : motif trop large, il touche « origine »'])
    expect(termes.map((terme) => terme.rang)).toEqual([1])
    expect(termeTrouve('origine, corrige, trigger, right', termes)).toBeUndefined()
    // Mesure conv-916 : un terme ecrit juste apres `\n` dans un test passait, le `n` comptait pour
    // une lettre voisine.
    expect(termeTrouve(String.raw`'contexte\nGIN_SOURCE'`, termes)?.rang).toBe(1)
    expect(termeTrouve(String.raw`'contexte\noriginal'`, termes)).toBeUndefined()
    expect(termeTrouve('COMMUN_GIN', termes)?.rang).toBe(1)
    expect(termeTrouve('sketches/gin-analyse/x.cs', termes)?.rang).toBe(1)
  })

  it('deux profils : leurs termes s additionnent', () => {
    const { termes } = termesDesProfils(
      depot({
        acme: { termesInterdits: [{ motif: 'zorglub' }] },
        initech: { termesInterdits: [{ motif: 'tps-report' }] }
      })
    )
    expect(termes.map((terme) => `${terme.profil}:${terme.rang}`)).toEqual(['acme:0', 'initech:0'])
  })

  it('le texte d un script UTF-16 est lu ; une image ne l est pas', () => {
    const { termes } = termesDesProfils(
      depot({ acme: { termesInterdits: [{ motif: 'zorglub' }] } })
    )
    const avecMarque = Buffer.concat([
      Buffer.from([0xff, 0xfe]),
      Buffer.from('$x = "zorglub"', 'utf16le')
    ])
    expect(termeTrouve(texteDuFichier(avecMarque), termes)?.rang).toBe(0)
    const sansMarque = Buffer.from('Write-Host zorglub', 'utf16le')
    expect(termeTrouve(texteDuFichier(sansMarque), termes)?.rang).toBe(0)
    const image = Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 0x0d]),
      Buffer.from('zorglub')
    ])
    expect(texteDuFichier(image)).toBeUndefined()
    expect(termeTrouve(texteDuFichier(Buffer.from('aucun')), termes)).toBeUndefined()
  })
})
