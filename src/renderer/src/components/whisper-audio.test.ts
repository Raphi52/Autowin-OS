import { describe, expect, it } from 'vitest'
import {
  DUREE_MAX_MS,
  MS_SILENCE_FIN,
  TAUX_WHISPER,
  avancerVad,
  encoderWav16k,
  etatVadInitial,
  reechantillonner
} from './whisper-audio'

/** Un bloc de « parole » : du bruit franc. Un bloc de silence : des zéros. */
function parole(taille: number, amplitude = 0.3): Float32Array {
  const bloc = new Float32Array(taille)
  for (let i = 0; i < taille; i += 1) bloc[i] = Math.sin(i / 3) * amplitude
  return bloc
}
const silence = (taille: number): Float32Array => new Float32Array(taille)

const lireEntete = (wav: Uint8Array) => {
  const vue = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
  return {
    riff: String.fromCharCode(...wav.slice(0, 4)),
    wave: String.fromCharCode(...wav.slice(8, 12)),
    canaux: vue.getUint16(22, true),
    taux: vue.getUint32(24, true),
    bits: vue.getUint16(34, true),
    octetsData: vue.getUint32(40, true)
  }
}

describe('encoderWav16k', () => {
  it('produit EXACTEMENT le format que whisper.cpp accepte : mono, 16 kHz, 16 bits', () => {
    // whisper.cpp REFUSE tout autre format ; un WAV 48 kHz stéréo sortirait « transcription vide »
    // sans dire pourquoi — c'est le silence de Jarvis, une deuxième fois.
    const wav = encoderWav16k(parole(16_000), TAUX_WHISPER)
    const entete = lireEntete(wav)
    expect(entete.riff).toBe('RIFF')
    expect(entete.wave).toBe('WAVE')
    expect(entete.canaux).toBe(1)
    expect(entete.taux).toBe(16_000)
    expect(entete.bits).toBe(16)
    expect(entete.octetsData).toBe(16_000 * 2)
    expect(wav.length).toBe(44 + 16_000 * 2)
  })

  it('rééchantillonne quand le micro tourne à 48 kHz — sans quoi la voix serait accélérée', () => {
    const wav = encoderWav16k(parole(48_000), 48_000)
    expect(lireEntete(wav).taux).toBe(16_000)
    expect(lireEntete(wav).octetsData).toBe(16_000 * 2)
  })

  it('borne les échantillons hors plage au lieu de les faire boucler', () => {
    // Un dépassement non borné repasse en négatif : la voix devient un grésillement.
    const wav = encoderWav16k(Float32Array.from([2, -2, 0]), TAUX_WHISPER)
    const vue = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    expect(vue.getInt16(44, true)).toBe(32_767)
    expect(vue.getInt16(46, true)).toBe(-32_768)
    expect(vue.getInt16(48, true)).toBe(0)
  })
})

describe('reechantillonner', () => {
  it('garde la durée en secondes, pas le nombre d’échantillons', () => {
    expect(reechantillonner(parole(48_000), 48_000, 16_000).length).toBe(16_000)
    expect(reechantillonner(parole(8_000), 8_000, 16_000).length).toBe(16_000)
    const identique = parole(100)
    expect(reechantillonner(identique, 16_000, 16_000)).toBe(identique)
  })
})

describe('avancerVad', () => {
  const taille = 1_600 // 100 ms à 16 kHz
  const pousser = (etat: ReturnType<typeof avancerVad>['etat'], blocs: Float32Array[]) => {
    let courant = etat
    const segments: Float32Array[] = []
    for (const bloc of blocs) {
      const pas = avancerVad(courant, bloc, TAUX_WHISPER)
      courant = pas.etat
      if (pas.segment) segments.push(pas.segment)
    }
    return { etat: courant, segments }
  }

  it('ne rend RIEN tant que la personne parle : le segment part à la fin de la phrase', () => {
    const blocs = Array.from({ length: 10 }, () => parole(taille))
    const { segments } = pousser(etatVadInitial, blocs)
    expect(segments).toHaveLength(0)
  })

  it('rend le segment après le silence de fin de phrase, PRÉ-ROLL compris', () => {
    // L'ENTRÉE QUI CASSE UN FAUX FIX : le premier bloc de parole arrive APRÈS du silence. Sans
    // pré-roll, le début du mot est coupé — et le mot coupé, c'est « Jarvis ». Le widget n'entend
    // alors jamais son nom : exactement le défaut signalé par l'utilisateur.
    const silencePre = Array.from({ length: 5 }, () => silence(taille))
    const paroles = Array.from({ length: 8 }, () => parole(taille))
    const silencePost = Array.from({ length: 9 }, () => silence(taille))
    const { segments } = pousser(etatVadInitial, [...silencePre, ...paroles, ...silencePost])
    expect(segments).toHaveLength(1)
    const segment = segments[0]
    // 800 ms de parole + pré-roll + le silence de fin qui sert de respiration à whisper
    expect(segment.length).toBeGreaterThan(8 * taille)
    // le tout premier échantillon vient du pré-roll (silence), pas de la parole : rien n'est coupé
    expect(segment.length).toBeLessThan(20 * taille)
  })

  it('jette les bruits trop courts : un claquement de porte n’est pas une phrase', () => {
    const { segments } = pousser(etatVadInitial, [
      parole(taille),
      ...Array.from({ length: 9 }, () => silence(taille))
    ])
    expect(segments).toHaveLength(0)
  })

  it('coupe d’office une parole interminable au lieu d’accumuler sans fin', () => {
    const blocs = Array.from({ length: Math.ceil(DUREE_MAX_MS / 100) + 2 }, () => parole(taille))
    const { segments } = pousser(etatVadInitial, blocs)
    expect(segments).toHaveLength(1)
    expect(segments[0].length / TAUX_WHISPER).toBeGreaterThanOrEqual(DUREE_MAX_MS / 1000 - 0.2)
  })

  it('enchaîne DEUX phrases séparées par un silence', () => {
    // Le mot d'éveil et l'ordre peuvent être dits en deux temps : « Jarvis » … « ouvre le chat ».
    const phrase = [
      ...Array.from({ length: 5 }, () => parole(taille)),
      ...Array.from({ length: Math.ceil(MS_SILENCE_FIN / 100) + 1 }, () => silence(taille))
    ]
    const { segments } = pousser(etatVadInitial, [...phrase, ...phrase])
    expect(segments).toHaveLength(2)
  })
})
