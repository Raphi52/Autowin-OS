import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  truncateSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  MODELE_WHISPER,
  analyserTranscription,
  argumentsWhisper,
  contexteAudio,
  creerServiceWhisper,
  dureeWavSecondes,
  etatWhisper,
  filsParDefaut,
  trouverExecutable
} from './whisper-local'
import { TAUX_WHISPER, encoderWav16k } from '../renderer/src/components/whisper-audio'

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

/**
 * Un faux téléchargement de la BONNE TAILLE. Écrire 7 octets ferait échouer le contrôle de taille
 * — à raison : depuis qu'il existe, un fichier trop court n'est plus une installation. Le fichier
 * est creux (`truncate`), donc instantané et sans occupation disque réelle.
 */
function ecrireFichierPlausible(destination: string): void {
  mkdirSync(dirname(destination), { recursive: true })
  writeFileSync(destination, '')
  truncateSync(destination, 25_000_000)
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

  it('jette TOUTE annotation de non-parole, meme inconnue, meme au milieu d une phrase', () => {
    // La liste fermée de mots-clés laissait passer tout ce que le modèle invente.
    expect(analyserTranscription('(rires)')).toBe('')
    expect(analyserTranscription('[bruit de prout]')).toBe('')
    expect(analyserTranscription('(soupir)')).toBe('')
    expect(analyserTranscription('[00:00:00.000 --> 00:00:02.000]   [ronflement]')).toBe('')
    expect(analyserTranscription('bonjour (rires) ca va')).toBe('bonjour ca va')
    expect(analyserTranscription('ouvre le task manager [bruit de clavier]')).toBe(
      'ouvre le task manager'
    )
    // La parole seule reste intacte.
    expect(analyserTranscription('Jarvis, ouvre le depot')).toBe('Jarvis, ouvre le depot')
  })

  it('jette les notes de musique et les asterisques, que ANNOTATION ne voyait pas', () => {
    expect(analyserTranscription('♪ Musique ♪')).toBe('')
    expect(analyserTranscription('♫♫♫')).toBe('')
    expect(analyserTranscription('*rires*')).toBe('')
    expect(analyserTranscription('ouvre le depot *toux*')).toBe('ouvre le depot')
  })

  it('jette les PHRASES DE GENERIQUE hallucinees sur du silence', () => {
    expect(analyserTranscription('Merci d’avoir regarde cette video !')).toBe('')
    expect(analyserTranscription('Sous-titrage ST’ 501')).toBe('')
    expect(analyserTranscription('Abonnez-vous')).toBe('')
    expect(analyserTranscription('Thanks for watching!')).toBe('')
    // Mais elle n'ampute JAMAIS une vraie dictee qui contient ces mots.
    expect(analyserTranscription('merci d’avoir regarde, maintenant ouvre le depot')).toBe(
      'merci d’avoir regarde, maintenant ouvre le depot'
    )
  })
})

describe('argumentsWhisper', () => {
  it('demande du français, sans horodatage, et sans écrire de fichier à côté', () => {
    const args = argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', fils: 4 })
    expect(args).toEqual(['-m', 'M.bin', '-f', 'a.wav', '-l', 'fr', '-nt', '-t', '4'])
  })

  it('borne le contexte de l’encodeur sur la durée du segment', () => {
    // MESURE 2026-08-31 : phrase de 3,32 s, 2366 ms sans `-ac`, 906 ms avec `-ac 512`, MÊME texte.
    const args = argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', fils: 4, secondes: 3.32 })
    expect(args).toEqual(['-m', 'M.bin', '-f', 'a.wav', '-l', 'fr', '-nt', '-t', '4', '-ac', '512'])
  })

  it('n’ajoute RIEN quand la durée est inconnue : on retombe sur le comportement d’avant', () => {
    expect(argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', fils: 4 })).not.toContain('-ac')
  })

  it('laisse le contexte PLEIN aux segments longs, au lieu de les tronquer', () => {
    // MESURE 2026-08-31 : `-ac 512` sur une phrase de 12,67 s a rendu 20 443 ms ET une fin FAUSSE
    // (« et preuve-je une preuve »). Un contexte trop petit est pire que pas de drapeau.
    expect(argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', secondes: 15 })).not.toContain('-ac')
    expect(argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', secondes: 40 })).not.toContain('-ac')
  })

  it('n’embarque jamais `--prompt` : il fabrique des ordres jamais prononcés', () => {
    // MESURE 2026-08-31 : avec `--prompt`, un segment à −18 dB a fait RECRACHER le prompt mot pour
    // mot par la CLI. Sur un moteur qui exécute ce qu'il entend, c'est un ordre inventé.
    const args = argumentsWhisper({ modele: 'M.bin', wav: 'a.wav', secondes: 3 })
    expect(args).not.toContain('--prompt')
  })
})

describe('contexteAudio', () => {
  it('grandit avec la durée, avec le plancher mesuré à 512', () => {
    // Sous 512, le repli de température s'enclenche : ac=256 sur 4,2 s a mesuré 18 833 ms.
    expect(contexteAudio(1)).toBe(512)
    expect(contexteAudio(3.32)).toBe(512)
    expect(contexteAudio(5.23)).toBe(600)
    expect(contexteAudio(6.79)).toBe(700)
    expect(contexteAudio(12.67)).toBe(1300)
  })

  it('rend null quand le contexte plein est atteint ou la durée absurde', () => {
    expect(contexteAudio(15)).toBeNull()
    expect(contexteAudio(30)).toBeNull()
    expect(contexteAudio(0)).toBeNull()
    expect(contexteAudio(-1)).toBeNull()
    expect(contexteAudio(Number.NaN)).toBeNull()
  })
})

describe('dureeWavSecondes', () => {
  /** Un WAV 16 kHz mono 16 bits de `secondes` de long, en-tête compris. */
  function wavDe(secondes: number): Uint8Array {
    const echantillons = Math.round(16_000 * secondes)
    const octets = echantillons * 2
    const wav = new Uint8Array(44 + octets)
    const vue = new DataView(wav.buffer)
    vue.setUint32(24, 16_000, true)
    vue.setUint32(28, 32_000, true) // octets par seconde
    vue.setUint32(40, octets, true)
    return wav
  }

  it('lit la durée dans l’en-tête, sans deviner', () => {
    expect(dureeWavSecondes(wavDe(3))).toBeCloseTo(3, 3)
    expect(dureeWavSecondes(wavDe(0.5))).toBeCloseTo(0.5, 3)
  })

  it('rend null sur un en-tête inutilisable, plutôt qu’une durée inventée', () => {
    expect(dureeWavSecondes(new Uint8Array(10))).toBeNull()
    expect(dureeWavSecondes(new Uint8Array(44))).toBeNull()
  })

  it('lit la durée du WAV RÉELLEMENT produit par l’encodeur du renderer', () => {
    // LA COUTURE QUI CASSERAIT EN SILENCE : `-ac` est calculé depuis cette durée. Si l'en-tête écrit
    // par `encoderWav16k` n'était pas lu ici, `dureeWavSecondes` rendrait null, `-ac` disparaîtrait
    // sans erreur, et on retomberait aux 2,4 s d'avant — avec tous les autres tests au vert.
    const deuxSecondes = new Float32Array(TAUX_WHISPER * 2)
    for (let i = 0; i < deuxSecondes.length; i += 1) deuxSecondes[i] = Math.sin(i / 3) * 0.3
    const wav = encoderWav16k(deuxSecondes, TAUX_WHISPER)
    expect(dureeWavSecondes(wav)).toBeCloseTo(2, 2)
    expect(contexteAudio(dureeWavSecondes(wav)!)).toBe(512)
  })

  it('ne croit pas un champ `data` plus grand que le fichier reçu', () => {
    // Un téléchargement coupé ou un WAV tronqué annoncerait 30 s dans 2 s d'octets : dimensionner
    // `-ac` sur la promesse plutôt que sur le contenu ferait tronquer la transcription.
    const wav = wavDe(2)
    new DataView(wav.buffer).setUint32(40, 32_000 * 30, true)
    expect(dureeWavSecondes(wav)).toBeCloseTo(2, 3)
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
        ecrireFichierPlausible(destination)
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
        ecrireFichierPlausible(destination)
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
        progres?.(50, 100)
        ecrireFichierPlausible(destination)
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

describe('un fichier reçu trop court n’est PAS une installation', () => {
  it('refuse une page d’erreur de 3 Ko enregistrée sous le nom du modèle', async () => {
    // Le défaut que ce test ferme : `octetsMinimum` était déclaré et lu par personne. Une
    // redirection perdue rendait 3 Ko de HTML, écrits sous `ggml-small-q5_1.bin` ; `existsSync`
    // disait « installé » et la panne ne se voyait qu'à la première parole.
    const racine = racineTemp()
    const service = creerServiceWhisper({
      racine,
      telecharger: async (_url, destination) => {
        mkdirSync(dirname(destination), { recursive: true })
        writeFileSync(destination, '<html>404</html>'.repeat(180)) // ~3 Ko
      },
      decompresser: async (_archive, destination) => {
        mkdirSync(join(destination, 'Release'), { recursive: true })
        writeFileSync(join(destination, 'Release', 'whisper-cli.exe'), 'x')
      }
    })
    await expect(service.installer()).rejects.toThrow(/incomplet/i)
    // ET le fichier douteux n'a pas survécu : sinon le clic suivant le prendrait pour un modèle.
    expect(existsSync(join(racine, MODELE_WHISPER.nom))).toBe(false)
    expect(service.etat().installe).toBe(false)
  })
})
