import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CLE_ENV_SYSTEME, CLE_ENV_UTILISATEUR } from './env-reload'
import {
  creerCoffre,
  estNomDeCle,
  NOM_FICHIER_COFFRE,
  type ChiffrementCoffre,
  type OptionsCoffre
} from './coffre-cles'

/**
 * CE QUE CE FICHIER PROUVE : le coffre garde les clés CHIFFRÉES sur disque, ne rend jamais une valeur
 * à qui liste, importe les clés du poste sans écraser celles de l'utilisateur, masque les valeurs
 * dans un texte, et n'écrit RIEN quand le chiffrement du système manque.
 *
 * Le chiffrement de test est un vrai AES-256-GCM à clé aléatoire (pas un base64 déguisé) : si le
 * module écrivait le JSON en clair, ou s'il contournait le chiffreur, la recherche de la valeur dans
 * les octets du fichier la trouverait.
 */
function chiffreurAes(): ChiffrementCoffre & { appels: number } {
  const cle = randomBytes(32)
  const chiffreur = {
    appels: 0,
    isEncryptionAvailable: () => true,
    encryptString(texte: string): Buffer {
      chiffreur.appels++
      const iv = randomBytes(12)
      const c = createCipheriv('aes-256-gcm', cle, iv)
      const corps = Buffer.concat([c.update(texte, 'utf8'), c.final()])
      return Buffer.concat([iv, c.getAuthTag(), corps])
    },
    decryptString(donnees: Buffer): string {
      const d = createDecipheriv('aes-256-gcm', cle, donnees.subarray(0, 12))
      d.setAuthTag(donnees.subarray(12, 28))
      return Buffer.concat([d.update(donnees.subarray(28)), d.final()]).toString('utf8')
    }
  }
  return chiffreur
}

const VALEUR_MISTRAL = 'mst-9f8e7d6c5b4a3210-valeur-mistral'
const VALEUR_GITHUB = 'ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345'

let dossier: string
let fichier: string

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'coffre-cles-'))
  fichier = join(dossier, NOM_FICHIER_COFFRE)
})
afterEach(() => {
  rmSync(dossier, { recursive: true, force: true })
})

function coffreDeTest(options: Partial<OptionsCoffre> & { chiffreur?: ChiffrementCoffre } = {}) {
  const chiffreur = options.chiffreur ?? chiffreurAes()
  return creerCoffre({
    chemin: () => fichier,
    chiffrement: () => chiffreur,
    lireRegistre: () => new Map(),
    env: {},
    maintenant: () => new Date('2026-11-06T10:00:00.000Z'),
    ...options
  })
}

describe('coffre à clés — stockage chiffré', () => {
  it('écrit un fichier chiffré : aucune valeur en clair, ni en base64, dans ses octets', () => {
    const coffre = coffreDeTest()
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    coffre.ajouterCle('GITHUB_TOKEN', VALEUR_GITHUB)

    const octets = readFileSync(fichier)
    for (const valeur of [VALEUR_MISTRAL, VALEUR_GITHUB]) {
      expect(octets.includes(Buffer.from(valeur, 'utf8'))).toBe(false)
      expect(octets.includes(Buffer.from(Buffer.from(valeur).toString('base64')))).toBe(false)
    }
    // Les noms non plus : le fichier entier est chiffré, pas seulement les valeurs.
    expect(octets.includes(Buffer.from('MISTRAL_API_KEY'))).toBe(false)
    // Aucun fichier temporaire laissé à côté.
    expect(readdirSync(dossier)).toEqual([NOM_FICHIER_COFFRE])
  })

  it('relit le fichier chiffré depuis un coffre neuf (même chiffreur = même session)', () => {
    const chiffreur = chiffreurAes()
    coffreDeTest({ chiffreur }).ajouterCle('MISTRAL_API_KEY', `  ${VALEUR_MISTRAL}\n`)
    const relu = coffreDeTest({ chiffreur })
    expect(relu.valeursPourAgent([])).toEqual({ MISTRAL_API_KEY: VALEUR_MISTRAL })
  })

  it('lister ne rend jamais une valeur : nom, origine, date et longueur seulement', () => {
    const coffre = coffreDeTest()
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    const etat = coffre.etat()
    expect(etat).toEqual({
      disponible: true,
      cles: [
        {
          nom: 'MISTRAL_API_KEY',
          origine: 'utilisateur',
          ajouteLe: '2026-11-06T10:00:00.000Z',
          longueur: VALEUR_MISTRAL.length
        }
      ]
    })
    expect(JSON.stringify(etat)).not.toContain(VALEUR_MISTRAL)
  })

  it('remplace une clé du même nom (casse ignorée) et retire une clé', () => {
    const coffre = coffreDeTest()
    coffre.ajouterCle('MISTRAL_API_KEY', 'ancienne-valeur-1234')
    coffre.ajouterCle('mistral_api_key', VALEUR_MISTRAL)
    expect(coffre.valeursPourAgent([])).toEqual({ mistral_api_key: VALEUR_MISTRAL })
    expect(coffre.retirerCle('MISTRAL_API_KEY')).toBe(true)
    expect(coffre.listerCles()).toEqual([])
    expect(coffre.retirerCle('ABSENTE_KEY')).toBe(false)
  })

  it('refuse un nom invalide, un nom AUTOWIN_ et une valeur vide — sans citer la valeur', () => {
    const coffre = coffreDeTest()
    expect(() => coffre.ajouterCle('1ABC', 'valeur-quelconque')).toThrow(/Nom de clé invalide/)
    expect(() => coffre.ajouterCle('NOM AVEC ESPACE', 'valeur-quelconque')).toThrow(/invalide/)
    expect(() => coffre.ajouterCle('AUTOWIN_COFFRE_NOMS', 'valeur-quelconque')).toThrow(/réservés/)
    expect(() => coffre.ajouterCle('MISTRAL_API_KEY', '   ')).toThrow(/vide/)
    try {
      coffre.ajouterCle('AUTOWIN_X', VALEUR_MISTRAL)
    } catch (erreur) {
      expect(String(erreur)).not.toContain(VALEUR_MISTRAL)
    }
    expect(existsSync(fichier)).toBe(false)
  })

  it('invalide le cache à chaque écriture : un ajout se voit au prochain appel', () => {
    const chiffreur = chiffreurAes()
    const coffre = coffreDeTest({ chiffreur })
    expect(coffre.valeursPourAgent([])).toEqual({})
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    expect(coffre.valeursPourAgent([])).toEqual({ MISTRAL_API_KEY: VALEUR_MISTRAL })
    // Un fichier changé SANS passer par ce coffre n'est pas relu par une simple lecture : c'est bien
    // un cache (une lecture DPAPI par appel coûterait à chaque lancement d'agent)…
    coffreDeTest({ chiffreur }).ajouterCle('GITHUB_TOKEN', VALEUR_GITHUB)
    expect(Object.keys(coffre.valeursPourAgent([]))).toEqual(['MISTRAL_API_KEY'])
    // … mais une modification repart du disque : elle ne perd pas la clé ajoutée à côté.
    coffre.retirerCle('MISTRAL_API_KEY')
    expect(coffre.valeursPourAgent([])).toEqual({ GITHUB_TOKEN: VALEUR_GITHUB })
  })
})

describe('coffre à clés — chiffrement indisponible', () => {
  const sansChiffrement: ChiffrementCoffre = {
    isEncryptionAvailable: () => false,
    encryptString: () => {
      throw new Error('ne doit pas être appelé')
    },
    decryptString: () => {
      throw new Error('ne doit pas être appelé')
    }
  }

  it('coffre vide avec sa raison, aucune écriture sur disque, même par l’import', () => {
    const coffre = coffreDeTest({
      chiffreur: sansChiffrement,
      env: { MISTRAL_API_KEY: VALEUR_MISTRAL }
    })
    const etat = coffre.etat()
    expect(etat.disponible).toBe(false)
    expect(etat.raison).toMatch(/chiffrement du système n'est pas disponible/)
    expect(etat.cles).toEqual([])
    expect(() => coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)).toThrow(/rien n'est écrit/)
    const bilan = coffre.importerDuPoste()
    expect(bilan).toMatchObject({ ajoutees: 0, misesAJour: 0 })
    expect(bilan.raison).toMatch(/pas disponible/)
    expect(coffre.valeursPourAgent([])).toEqual({})
    expect(readdirSync(dossier)).toEqual([])
  })

  it('hors Electron (aucun chiffreur), même verdict : rien n’est écrit', () => {
    const coffre = coffreDeTest({ chiffrement: () => undefined })
    expect(coffre.etat().disponible).toBe(false)
    expect(() => coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)).toThrow()
    expect(readdirSync(dossier)).toEqual([])
  })

  it('un coffre qui ne se déchiffre pas est laissé intact, jamais écrasé', () => {
    writeFileSync(fichier, Buffer.from('octets chiffrés par une autre session'))
    const avant = readFileSync(fichier)
    const coffre = coffreDeTest({ env: { MISTRAL_API_KEY: VALEUR_MISTRAL } })
    expect(coffre.etat()).toMatchObject({ disponible: false, cles: [] })
    expect(coffre.etat().raison).toMatch(/ne se déchiffre pas/)
    expect(() => coffre.ajouterCle('GITHUB_TOKEN', VALEUR_GITHUB)).toThrow(/laissé intact/)
    expect(coffre.importerDuPoste().raison).toMatch(/laissé intact/)
    expect(readFileSync(fichier).equals(avant)).toBe(true)
  })

  it('reprend dès que le chiffrement devient disponible (l’échec n’est pas mis en cache)', () => {
    const aes = chiffreurAes()
    let pret = false
    const coffre = coffreDeTest({
      chiffrement: () => ({ ...aes, isEncryptionAvailable: () => pret })
    })
    expect(coffre.etat().disponible).toBe(false)
    pret = true
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    expect(coffre.etat().disponible).toBe(true)
  })
})

describe('coffre à clés — import du poste', () => {
  it('filtre les noms : suffixes de clé (casse ignorée), jamais AUTOWIN_*', () => {
    for (const nom of [
      'MISTRAL_API_KEY',
      'OPENAI_APIKEY',
      'STRIPE_KEY',
      'GITHUB_TOKEN',
      'Azure_Client_Secret',
      'ADO_PAT',
      'SMTP_PASSWORD',
      'groq_api_key'
    ])
      expect(estNomDeCle(nom), nom).toBe(true)
    for (const nom of [
      'AUTOWIN_TEAMS_CLIENT_ID',
      'AUTOWIN_API_KEY',
      'autowin_token',
      'PATH',
      'TEMP',
      'KEY',
      'MONKEY',
      'TOKEN_URL',
      'NOM AVEC ESPACE_KEY'
    ])
      expect(estNomDeCle(nom), nom).toBe(false)
  })

  it('importe HKCU, HKLM et process.env filtrés, et rend le bilan', () => {
    const registre = new Map<string, Map<string, string>>([
      [
        CLE_ENV_UTILISATEUR,
        new Map([
          ['GROQ_API_KEY', 'groq-valeur-utilisateur-123'],
          ['AUTOWIN_VERIFY_TIMEOUT_MS', '86400000'],
          ['Path', 'C:\\Windows']
        ])
      ],
      [CLE_ENV_SYSTEME, new Map([['SYSTEME_TOKEN', 'jeton-systeme-456789']])]
    ])
    const coffre = coffreDeTest({
      lireRegistre: (cle) => registre.get(cle) ?? new Map(),
      env: {
        MISTRAL_API_KEY: VALEUR_MISTRAL,
        AUTOWIN_COFFRE_NOMS: 'X',
        USERPROFILE: 'C:\\Users\\moi',
        VIDE_TOKEN: '   '
      }
    })
    expect(coffre.importerDuPoste()).toEqual({ ajoutees: 3, misesAJour: 0, ignorees: 0 })
    expect(coffre.listerCles().map((c) => [c.nom, c.origine])).toEqual([
      ['GROQ_API_KEY', 'poste'],
      ['MISTRAL_API_KEY', 'poste'],
      ['SYSTEME_TOKEN', 'poste']
    ])
    // Rejoué tel quel : rien ne change, rien n'est réécrit.
    expect(coffre.importerDuPoste()).toEqual({ ajoutees: 0, misesAJour: 0, ignorees: 3 })
  })

  it('l’utilisateur l’emporte sur le système, le registre sur l’environnement figé', () => {
    const coffre = coffreDeTest({
      lireRegistre: (cle) =>
        new Map([
          ['GROQ_API_KEY', cle === CLE_ENV_UTILISATEUR ? 'valeur-hkcu-0001' : 'valeur-hklm-0002']
        ]),
      env: { GROQ_API_KEY: 'valeur-env-figee-0003' }
    })
    coffre.importerDuPoste()
    expect(coffre.valeursPourAgent([])).toEqual({ GROQ_API_KEY: 'valeur-hkcu-0001' })
  })

  it('n’écrase jamais une clé saisie par l’utilisateur, met à jour une clé du poste', () => {
    const envPoste: NodeJS.ProcessEnv = {
      MISTRAL_API_KEY: 'valeur-du-poste-0001',
      GITHUB_TOKEN: 'ancien-jeton-poste-0001'
    }
    const coffre = coffreDeTest({ env: envPoste })
    expect(coffre.importerDuPoste()).toEqual({ ajoutees: 2, misesAJour: 0, ignorees: 0 })
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    envPoste.GITHUB_TOKEN = VALEUR_GITHUB

    expect(coffre.importerDuPoste()).toEqual({ ajoutees: 0, misesAJour: 1, ignorees: 1 })
    expect(coffre.valeursPourAgent([])).toEqual({
      MISTRAL_API_KEY: VALEUR_MISTRAL,
      GITHUB_TOKEN: VALEUR_GITHUB
    })
    expect(coffre.listerCles().find((c) => c.nom === 'MISTRAL_API_KEY')?.origine).toBe(
      'utilisateur'
    )
  })

  it('une clé retirée par l’utilisateur ne revient pas à l’import suivant ; la ressaisir la rend', () => {
    const coffre = coffreDeTest({ env: { MISTRAL_API_KEY: VALEUR_MISTRAL } })
    coffre.importerDuPoste()
    expect(coffre.retirerCle('MISTRAL_API_KEY')).toBe(true)
    expect(coffre.importerDuPoste()).toEqual({ ajoutees: 0, misesAJour: 0, ignorees: 1 })
    expect(coffre.listerCles()).toEqual([])
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    expect(coffre.listerCles().map((c) => c.nom)).toEqual(['MISTRAL_API_KEY'])
  })
})

describe('coffre à clés — injection et masquage', () => {
  it('valeursPourAgent retire les exclusions, casse ignorée', () => {
    const coffre = coffreDeTest()
    coffre.ajouterCle('ANTHROPIC_API_KEY', 'sk-ant-ne-pas-injecter')
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    expect(coffre.valeursPourAgent(['anthropic_api_key', 'XAI_API_KEY'])).toEqual({
      MISTRAL_API_KEY: VALEUR_MISTRAL
    })
  })

  it('masque chaque valeur de 8 caractères ou plus, les plus longues d’abord', () => {
    const coffre = coffreDeTest()
    coffre.ajouterCle('COURTE_KEY', 'abc1234') // 7 caractères : laissée telle quelle
    coffre.ajouterCle('BASE_TOKEN', 'abcdefgh')
    coffre.ajouterCle('LONGUE_TOKEN', 'abcdefgh-suite-longue')
    coffre.ajouterCle('MISTRAL_API_KEY', VALEUR_MISTRAL)
    const texte = `curl -H "Bearer ${VALEUR_MISTRAL}" x=abcdefgh-suite-longue y=abcdefgh z=abc1234 ${VALEUR_MISTRAL}`
    expect(coffre.masquerValeurs(texte)).toBe(
      'curl -H "Bearer [secret:MISTRAL_API_KEY]" x=[secret:LONGUE_TOKEN] y=[secret:BASE_TOKEN] ' +
        'z=abc1234 [secret:MISTRAL_API_KEY]'
    )
    expect(coffre.masquerValeurs('')).toBe('')
  })

  it('masquer sans chiffrement rend le texte intact, sans exception', () => {
    const coffre = coffreDeTest({ chiffrement: () => undefined })
    expect(coffre.masquerValeurs(`clé ${VALEUR_MISTRAL}`)).toBe(`clé ${VALEUR_MISTRAL}`)
  })
})
