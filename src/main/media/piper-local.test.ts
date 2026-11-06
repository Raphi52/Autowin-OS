import { existsSync, mkdirSync, mkdtempSync, rmSync, truncateSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  BINAIRE_PIPER,
  VOIX_PIPER,
  argumentsPiper,
  creerServicePiper,
  etatPiper,
  trouverPiper
} from './piper-local'

const racines: string[] = []
function racineTemp(): string {
  const r = mkdtempSync(join(tmpdir(), 'piper-test-'))
  racines.push(r)
  return r
}

/**
 * Un faux téléchargement de la BONNE TAILLE. Le fichier est creux (`truncate`) : instantané, sans
 * occupation disque réelle, et pourtant assez gros pour passer le contrôle de taille — qui, lui,
 * doit rester intraitable.
 */
function ecrireFichierPlausible(destination: string, octets = 60_000_000): void {
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, '')
  truncateSync(destination, octets)
}

function installationFactice(racine: string): void {
  mkdirSync(join(racine, 'bin', 'piper'), { recursive: true })
  writeFileSync(join(racine, 'bin', 'piper', 'piper.exe'), 'x')
  writeFileSync(join(racine, VOIX_PIPER.nom), 'y')
  writeFileSync(join(racine, `${VOIX_PIPER.nom}.json`), '{}')
}

afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('trouverPiper', () => {
  it('reconnaît l’exécutable, et ne le confond pas avec les bibliothèques de l’archive', () => {
    // L'archive Windows embarque onnxruntime et espeak-ng : en prendre un rendrait un processus
    // qui démarre et ne produit aucun son — une panne muette, la pire à diagnostiquer.
    expect(trouverPiper(['piper/piper.exe', 'piper/onnxruntime.dll'])).toBe('piper/piper.exe')
    expect(trouverPiper(['piper/onnxruntime.dll', 'piper/espeak-ng.dll'])).toBeNull()
  })
})

describe('etatPiper', () => {
  it('n’est PAS installé tant qu’il manque l’exécutable, la voix OU sa fiche', () => {
    const racine = racineTemp()
    expect(etatPiper(racine).installe).toBe(false)

    mkdirSync(join(racine, 'bin', 'piper'), { recursive: true })
    writeFileSync(join(racine, 'bin', 'piper', 'piper.exe'), 'x')
    expect(etatPiper(racine).installe).toBe(false)

    writeFileSync(join(racine, VOIX_PIPER.nom), 'y')
    // La fiche `.json` manque encore : Piper refuse de démarrer sans elle, donc « installé »
    // serait un mensonge qui rendrait Jarvis muet au lieu de le laisser parler comme avant.
    expect(etatPiper(racine).installe).toBe(false)

    writeFileSync(join(racine, `${VOIX_PIPER.nom}.json`), '{}')
    const etat = etatPiper(racine)
    expect(etat.installe).toBe(true)
    expect(etat.binaire).toBe(join(racine, 'bin', 'piper', 'piper.exe'))
    expect(etat.megaoctets).toBe(VOIX_PIPER.megaoctets + BINAIRE_PIPER.megaoctets)
  })
})

describe('argumentsPiper', () => {
  it('ne met JAMAIS le texte sur la ligne de commande', () => {
    const args = argumentsPiper({ voix: 'C:/v.onnx', sortie: 'C:/s.wav' })
    expect(args).toEqual(['--model', 'C:/v.onnx', '--output_file', 'C:/s.wav'])
  })
})

describe('service Piper', () => {
  it('installe UNE fois : voix + fiche + moteur, puis ne re-télécharge rien', async () => {
    const racine = racineTemp()
    const telecharge: string[] = []
    const service = creerServicePiper({
      racine,
      telecharger: async (url, destination) => {
        telecharge.push(url)
        ecrireFichierPlausible(destination)
      },
      decompresser: async (_archive, destination) => {
        mkdirSync(join(destination, 'piper'), { recursive: true })
        writeFileSync(join(destination, 'piper', 'piper.exe'), 'x')
      }
    })
    expect(service.etat().installe).toBe(false)
    const etat = await service.installer()
    expect(etat.installe).toBe(true)
    expect(telecharge).toEqual([
      VOIX_PIPER.url,
      VOIX_PIPER.urlConfig,
      expect.stringContaining('piper_windows_amd64.zip')
    ])
    await service.installer()
    expect(telecharge).toHaveLength(3)
  })

  it('refuse une voix reçue tronquée, et n’en laisse aucune trace', async () => {
    // Le défaut fermé ici : une redirection perdue rend 3 Ko de HTML sous le nom du modèle.
    // Sans pesée, l'installation se déclare réussie et la panne n'apparaît qu'à la parole.
    const racine = racineTemp()
    const service = creerServicePiper({
      racine,
      telecharger: async (_url, destination) => {
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, '<html>404</html>'.repeat(180))
      },
      decompresser: async () => {
        /* jamais atteint */
      }
    })
    await expect(service.installer()).rejects.toThrow(/incomplet/i)
    expect(existsSync(join(racine, VOIX_PIPER.nom))).toBe(false)
    expect(service.etat().installe).toBe(false)
    expect(service.etat().installation?.erreur).toMatch(/incomplet/i)
  })

  it('n’annonce JAMAIS « installé » si l’archive ne contient pas piper', async () => {
    const racine = racineTemp()
    const service = creerServicePiper({
      racine,
      telecharger: async (_url, destination) => ecrireFichierPlausible(destination),
      decompresser: async () => {
        /* archive vide */
      }
    })
    await expect(service.installer()).rejects.toThrow(/piper/i)
    expect(service.etat().installe).toBe(false)
  })

  it('prononce par l’entrée standard et rend le son produit', async () => {
    const racine = racineTemp()
    installationFactice(racine)
    let recu = ''
    const service = creerServicePiper({
      racine,
      executer: async (binaire, args, texte) => {
        recu = texte
        expect(binaire).toBe(join(racine, 'bin', 'piper', 'piper.exe'))
        // Le WAV est écrit par piper : ici, on l'imite à l'octet près sur le chemin demandé.
        const sortie = args[args.indexOf('--output_file') + 1]
        writeFileSync(sortie, Buffer.from('RIFFsonWAVE'))
      }
    })
    const son = await service.synthetiser('  Tout de suite.  ')
    expect(recu).toBe('Tout de suite.')
    expect(Buffer.from(son).toString()).toBe('RIFFsonWAVE')
  })

  it('refuse de prononcer tant que rien n’est installé (au lieu de lancer un exécutable absent)', async () => {
    const service = creerServicePiper({ racine: racineTemp() })
    await expect(service.synthetiser('Bonjour')).rejects.toThrow(/pas installée/i)
  })
})
