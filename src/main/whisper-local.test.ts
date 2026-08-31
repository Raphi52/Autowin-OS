import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODELE_WHISPER,
  analyserTranscription,
  argumentsWhisper,
  creerServiceWhisper,
  etatWhisper,
  filsParDefaut,
  trouverExecutable
} from './whisper-local'

const racines: string[] = []
function racineTemp(): string {
  const r = mkdtempSync(join(tmpdir(), 'whisper-test-'))
  racines.push(r)
  return r
}
function installationFactice(racine: string): void {
  mkdirSync(join(racine, 'bin', 'Release'), { recursive: true })
  writeFileSync(join(racine, 'bin', 'Release', 'whisper-cli.exe'), 'x')
  writeFileSync(join(racine, MODELE_WHISPER.nom), 'y')
}
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

describe('trouverExecutable', () => {
  it('reconnaît le nom RÉCENT et le nom HISTORIQUE de la CLI whisper.cpp', () => {
    // Les archives publiées ont changé de nom en cours de route : `main.exe` avant la v1.7,
    // `whisper-cli.exe` après. Ne connaître qu'un seul nom rendrait l'installation « réussie » et
    // le moteur introuvable — la panne ne se verrait qu'à la première parole.
    expect(trouverExecutable(['Release/whisper-cli.exe', 'Release/whisper.dll'])).toBe(
      'Release/whisper-cli.exe'
    )
    expect(trouverExecutable(['Release/main.exe', 'Release/ggml.dll'])).toBe('Release/main.exe')
  })

  it('ne confond PAS la CLI avec les autres exécutables de l’archive', () => {
    // L'archive embarque bench/quantize/server/stream : en prendre un au hasard donnerait un
    // processus qui démarre, ne transcrit rien, et une erreur illisible.
    expect(
      trouverExecutable([
        'Release/bench.exe',
        'Release/quantize.exe',
        'Release/server.exe',
        'Release/whisper-stream.exe',
        'Release/whisper-cli.exe'
      ])
    ).toBe('Release/whisper-cli.exe')
    expect(trouverExecutable(['Release/bench.exe', 'Release/server.exe'])).toBeNull()
  })
})

describe('etatWhisper', () => {
  it('n’est PAS installé tant qu’il manque le modèle OU l’exécutable', () => {
    const racine = racineTemp()
    expect(etatWhisper(racine).installe).toBe(false)

    mkdirSync(join(racine, 'bin', 'Release'), { recursive: true })
    writeFileSync(join(racine, 'bin', 'Release', 'whisper-cli.exe'), 'x')
    expect(etatWhisper(racine).installe).toBe(false)

    writeFileSync(join(racine, MODELE_WHISPER.nom), 'y')
    const etat = etatWhisper(racine)
    expect(etat.installe).toBe(true)
    expect(etat.binaire).toBe(join(racine, 'bin', 'Release', 'whisper-cli.exe'))
    expect(etat.modele).toBe(join(racine, MODELE_WHISPER.nom))
  })
})

describe('analyserTranscription', () => {
  it('ne garde que la PAROLE : ni journal du moteur, ni horodatage, ni bruit annoté', () => {
    const sortie = [
      'whisper_init_from_file_with_params_no_state: loading model',
      'system_info: n_threads = 4 | AVX = 1',
      '',
      '[00:00:00.000 --> 00:00:02.000]   Jarvis, ouvre le task manager',
      '[00:00:02.000 --> 00:00:03.000]   [BLANK_AUDIO]',
      'main: total time = 812.00 ms'
    ].join('\n')
    expect(analyserTranscription(sortie)).toBe('Jarvis, ouvre le task manager')
  })

  it('rend une chaîne VIDE quand il n’y a que du silence — pas un faux ordre', () => {
    expect(analyserTranscription('[00:00:00.000 --> 00:00:04.000]   (musique)')).toBe('')
    expect(analyserTranscription('  [BLANK_AUDIO]\n')).toBe('')
    expect(analyserTranscription('')).toBe('')
  })
})

describe('argumentsWhisper', () => {
  it('demande du français, sans horodatage, et sans écrire de fichier à côté', () => {
    const args = argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', fils: 4 })
    expect(args).toEqual(['-m', 'M.bin', '-f', 'a.wav', '-l', 'fr', '-nt', '-t', '4'])
  })
})

describe('filsParDefaut', () => {
  it('utilise la machine sans l’étouffer — mesuré, pas devine', () => {
    // MESURE 2026-08-31 (16 coeurs, phrase de ~3 s, small-q5_1) : 4 fils = 3921 ms, 8 = 2717 ms,
    // 12 = 2404 ms. D'ou le plafond a 12 et les 4 coeurs laisses a l'interface.
    expect(filsParDefaut(16)).toBe(12)
    expect(filsParDefaut(8)).toBe(4)
    expect(filsParDefaut(2)).toBe(4)
    expect(filsParDefaut(64)).toBe(12)
  })
})

describe('service whisper', () => {
  it('transcrit un WAV en TEXTE, et efface le fichier temporaire', async () => {
    const racine = racineTemp()
    installationFactice(racine)
    const vus: { bin: string; args: readonly string[]; wavPresent: boolean }[] = []
    const service = creerServiceWhisper({
      racine,
      executer: async (bin, args) => {
        const wav = args[args.indexOf('-f') + 1]
        vus.push({ bin, args, wavPresent: existsSync(wav) })
        return { stdout: '[00:00:00.000 --> 00:00:01.000]  ouvre le chat', stderr: '' }
      }
    })
    const texte = await service.transcrire(new Uint8Array([1, 2, 3, 4]))
    expect(texte).toBe('ouvre le chat')
    expect(vus).toHaveLength(1)
    expect(vus[0].bin).toBe(join(racine, 'bin', 'Release', 'whisper-cli.exe'))
    // le WAV existe PENDANT l'appel — sinon la CLI transcrirait un fichier absent
    expect(vus[0].wavPresent).toBe(true)
    // ... et pas après : un micro ouvert en continu remplirait le disque de segments
    expect(existsSync(vus[0].args[vus[0].args.indexOf('-f') + 1])).toBe(false)
  })

  it('REFUSE de transcrire tant que rien n’est installé — au lieu de rendre du vide', async () => {
    const service = creerServiceWhisper({
      racine: racineTemp(),
      executer: async () => ({ stdout: '', stderr: '' })
    })
    await expect(service.transcrire(new Uint8Array([1]))).rejects.toThrow(/install/i)
  })

  it('installe UNE fois : télécharge modèle + archive, décompresse, et rend l’état installé', async () => {
    const racine = racineTemp()
    const telecharge: string[] = []
    const service = creerServiceWhisper({
      racine,
      executer: async () => ({ stdout: '', stderr: '' }),
      telecharger: async (url, destination) => {
        telecharge.push(url)
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, 'contenu')
      },
      decompresser: async (_archive, destination) => {
        mkdirSync(join(destination, 'Release'), { recursive: true })
        writeFileSync(join(destination, 'Release', 'whisper-cli.exe'), 'x')
      }
    })
    expect(service.etat().installe).toBe(false)
    const etat = await service.installer()
    expect(etat.installe).toBe(true)
    expect(telecharge).toEqual([MODELE_WHISPER.url, expect.stringContaining('whisper-bin-x64.zip')])
    // deuxième appel : rien n'est re-téléchargé (« un modèle à télécharger UNE fois »)
    await service.installer()
    expect(telecharge).toHaveLength(2)
  })

  it('n’annonce JAMAIS « installé » si la décompression n’a pas produit de CLI', async () => {
    const racine = racineTemp()
    const service = creerServiceWhisper({
      racine,
      executer: async () => ({ stdout: '', stderr: '' }),
      telecharger: async (_url, destination) => {
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, 'c')
      },
      decompresser: async () => {
        /* archive vide : rien n'est extrait */
      }
    })
    await expect(service.installer()).rejects.toThrow(/whisper/i)
    expect(service.etat().installe).toBe(false)
  })

  it('publie une PROGRESSION lisible pendant l’installation', async () => {
    const racine = racineTemp()
    const service = creerServiceWhisper({
      racine,
      executer: async () => ({ stdout: '', stderr: '' }),
      telecharger: async (_url, destination, progres) => {
        mkdirSync(dirname(destination), { recursive: true })
        progres?.(50, 100)
        writeFileSync(destination, 'c')
      },
      decompresser: async (_a, destination) => {
        mkdirSync(join(destination, 'Release'), { recursive: true })
        writeFileSync(join(destination, 'Release', 'whisper-cli.exe'), 'x')
      }
    })
    const attente = service.installer()
    expect(service.etat().installation?.enCours).toBe(true)
    await attente
    expect(service.etat().installation?.enCours).toBe(false)
    expect(service.etat().installe).toBe(true)
  })
})
