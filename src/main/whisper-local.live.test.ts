/**
 * PREUVE RÉELLE de l'écoute locale — le seul test qui touche le vrai monde.
 *
 * Les tests unitaires prouvent les DÉCISIONS (découpe, format WAV, filtrage de la sortie) avec des
 * doublures. Ils ne peuvent rien dire de ce qui casse en vrai : une URL qui a bougé, une archive dont
 * la CLI a changé de nom, un drapeau refusé par le binaire, un WAV que whisper n'accepte pas. Ce
 * fichier-ci fait la chaîne ENTIÈRE, sans doublure : téléchargement, décompression, synthèse d'une
 * phrase par la voix de Windows, transcription par la vraie CLI.
 *
 * DEUX verrous, pas un. (1) le fichier est hors de la suite par défaut (`*.live.test.*`, exclu par
 * `vitest.config.ts`). (2) même lancé par `vitest.live.config.ts`, il reste SKIPPÉ tant que
 * `AUTOWIN_WHISPER_LIVE=1` n'est pas posé, et hors Windows (il fait parler la voix du système via
 * PowerShell). Le premier verrou seul ne suffisait pas : n'importe quel lancement de la config live
 * — la commande documentée pour TOUTES les preuves vivantes du dépôt — déclenchait un
 * téléchargement de ~215 Mo sans l'avoir demandé. Lancement explicite :
 *   AUTOWIN_WHISPER_LIVE=1 npx vitest run --config vitest.live.config.ts src/main/whisper-local.live.test.ts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { contientEveil, extraireCommandeEveil } from '../renderer/src/components/jarvis-voice'
import { creerServiceWhisper } from './whisper-local'

/** Installation RÉUTILISÉE entre exécutions : on ne retélécharge pas 215 Mo à chaque passe. */
const RACINE = join(tmpdir(), 'autowin-whisper-live')

/**
 * Le seul feu vert au téléchargement. `skipIf` et non un `return` silencieux : vitest AFFICHE le
 * test comme skippé, donc on ne peut pas croire qu'il a passé alors qu'il n'a rien fait.
 */
const ARME = process.env.AUTOWIN_WHISPER_LIVE === '1' && process.platform === 'win32'

describe.skipIf(!ARME)('whisper local — chaîne réelle', () => {
  it('installe, puis transcrit une phrase française réellement prononcée', async () => {
    mkdirSync(RACINE, { recursive: true })
    const service = creerServiceWhisper({ racine: RACINE })
    const etat = await service.installer()
    expect(etat.installe).toBe(true)
    expect(etat.binaire).not.toBeNull()
    expect(existsSync(etat.binaire!)).toBe(true)

    // La voix de Windows prononce la phrase, en 16 kHz mono — le format exact que whisper accepte.
    const wav = join(RACINE, 'phrase.wav')
    execFileSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Add-Type -AssemblyName System.Speech; ` +
          `$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
          `$f = New-Object System.Speech.AudioFormat.SpeechAudioFormatInfo(16000,[System.Speech.AudioFormat.AudioBitsPerSample]::Sixteen,[System.Speech.AudioFormat.AudioChannel]::Mono); ` +
          `$s.SetOutputToWaveFile('${wav}', $f); ` +
          `$s.Speak('Jarvis, ouvre le task manager'); $s.Dispose()`
      ],
      { timeout: 120_000, windowsHide: true }
    )
    expect(existsSync(wav)).toBe(true)

    const texte = await service.transcrire(readFileSync(wav))
    // Le mot d'éveil doit être RECONNU sur la transcription réelle — pas sur une orthographe idéale.
    // Mesure du 2026-08-31 : la CLI rend « jarvie, ouvre le task manager. », d'où la tolérance
    // bornée de `contientEveil`. C'est cette chaîne-là, et elle seule, qui décide que Jarvis agit.
    expect(texte.length).toBeGreaterThan(6)
    expect(contientEveil(texte)).toBe(true)
    expect(extraireCommandeEveil(texte)?.toLowerCase()).toContain('task manager')
  }, 900_000)
})
