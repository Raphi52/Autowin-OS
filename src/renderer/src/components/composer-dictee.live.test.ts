/**
 * PREUVE RÉELLE de l'écriture EN DIRECT dans la barre de prompt.
 *
 * Les tests unitaires prouvent la découpe avec une doublure de transcription. Ils ne peuvent pas
 * dire si, avec la VRAIE CLI whisper.cpp et de la VRAIE parole, le texte tombe pendant que le micro
 * tourne. Ce fichier-ci fait la chaîne entière : la voix de Windows prononce DEUX phrases séparées
 * d'une pause, l'audio est poussé bloc par bloc dans `Dictee` comme le ferait le micro, et on
 * vérifie que DEUX textes sont écrits AVANT tout arrêt.
 *
 * Hors suite par défaut (`*.live.test.*`) et skippé tant que `AUTOWIN_WHISPER_LIVE=1` n'est pas
 * posé — le modèle pèse ~215 Mo. Lancement :
 *   AUTOWIN_WHISPER_LIVE=1 npx vitest run --config vitest.live.config.ts src/renderer/src/components/composer-dictee.live.test.ts
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { creerServiceWhisper } from '../../../main/whisper-local'
import { Dictee, type DependancesDictee } from './composer-dictee'

const RACINE = join(tmpdir(), 'autowin-whisper-live')
const ARME = process.env.AUTOWIN_WHISPER_LIVE === '1' && process.platform === 'win32'
const TAUX = 16_000

function direDansUnFichier(texte: string, chemin: string): void {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Add-Type -AssemblyName System.Speech; ` +
        `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
        `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono); ` +
        `$s.SetOutputToWaveFile('${chemin}', $f); $s.Speak('${texte}'); $s.Dispose()`
    ],
    { timeout: 120_000, windowsHide: true }
  )
}

/** WAV 16 bits mono → échantillons flottants, comme ce que rend un noeud audio. */
function pcmFlottant(chemin: string): Float32Array {
  const octets = readFileSync(chemin)
  const vue = new DataView(octets.buffer, octets.byteOffset, octets.byteLength)
  const total = (octets.byteLength - 44) / 2
  const sortie = new Float32Array(total)
  for (let i = 0; i < total; i += 1) sortie[i] = vue.getInt16(44 + i * 2, true) / 32_768
  return sortie
}

describe.skipIf(!ARME)('dictée du composer — chaîne réelle', () => {
  it('écrit DEUX phrases dans le champ pendant que le micro tourne', async () => {
    mkdirSync(RACINE, { recursive: true })
    const service = creerServiceWhisper({ racine: RACINE })
    expect((await service.installer()).installe).toBe(true)

    const un = join(RACINE, 'direct-1.wav')
    const deux = join(RACINE, 'direct-2.wav')
    direDansUnFichier('Ouvre le gestionnaire de fichiers', un)
    direDansUnFichier('Puis ferme la fenêtre', deux)

    // Une seule bande audio : phrase, PAUSE d'une seconde et demie, phrase. C'est la pause qui doit
    // déclencher l'écriture de la première phrase, micro encore ouvert.
    const a = pcmFlottant(un)
    const b = pcmFlottant(deux)
    const pause = new Float32Array(Math.round(1.5 * TAUX))
    const bande = new Float32Array(a.length + pause.length + b.length + pause.length)
    bande.set(a, 0)
    bande.set(b, a.length + pause.length)

    const ecrits: string[] = []
    let onaudio: ((e: { inputBuffer: { getChannelData(c: number): Float32Array } }) => void) | null =
      null
    const deps: DependancesDictee = {
      micro: async () => ({ getTracks: () => [{ stop: () => {} }] }),
      contexte: () =>
        ({
          sampleRate: TAUX,
          destination: {},
          createMediaStreamSource: () => ({ connect: () => {}, disconnect: () => {} }),
          createScriptProcessor: () => ({
            connect: () => {},
            disconnect: () => {},
            set onaudioprocess(v: never) {
              onaudio = v
            },
            get onaudioprocess() {
              return onaudio as never
            }
          }),
          close: async () => {}
        }) as never,
      transcrire: (wav) => service.transcrire(Buffer.from(wav)),
      onTexte: (t) => ecrits.push(t)
    }

    const dictee = new Dictee(deps)
    expect(await dictee.demarrer()).toBe(true)
    for (let i = 0; i < bande.length; i += 4096) {
      onaudio?.({ inputBuffer: { getChannelData: () => bande.slice(i, i + 4096) } })
      // Laisse la file de transcription avancer, comme le ferait le temps réel.
      await new Promise((r) => setTimeout(r, 0))
    }
    // Attente BORNÉE des deux écritures, micro toujours ouvert : c'est tout l'enjeu.
    const limite = Date.now() + 240_000
    while (ecrits.length < 2 && Date.now() < limite) await new Promise((r) => setTimeout(r, 200))

    expect(dictee.enCours).toBe(true)
    expect(ecrits.length).toBe(2)
    expect(ecrits[0]!.toLowerCase()).toContain('gestionnaire')
    expect(ecrits[1]!.toLowerCase()).toContain('ferme')
    await dictee.arreter()
  }, 900_000)
})
