import { describe, expect, it } from 'vitest'
import {
  DUREE_MAX_MS,
  MS_SILENCE_FIN,
  TAUX_WHISPER,
  avancerVad,
  CRETE_CIBLE,
  GAIN_MAX,
  encoderWav16k,
  etatVadInitial,
  gainNormalisation,
  jaugeDepuisNiveau,
  niveau,
  reechantillonner,
  SEUIL_MAX,
  SEUIL_MIN,
  SEUIL_PAROLE,
  seuilValide,
  verdictMicro,
  MESSAGE_VERDICT,
  CRETE_SATURATION
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

  it('REMONTE un segment trop faible — la cause mesurée des ordres faux', () => {
    // MESURE 2026-08-31 : la même phrase à −18 dB rend « J'arrivée, ouvre le jeu. » au lieu de
    // « Jarvie, ouvre le gestionnaire de tâche. ». Le pipeline ne remontait jamais le niveau.
    const faible = parole(16_000, 0.05)
    const wav = encoderWav16k(faible, TAUX_WHISPER)
    const vue = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    let crete = 0
    for (let i = 0; i < 16_000; i += 1)
      crete = Math.max(crete, Math.abs(vue.getInt16(44 + i * 2, true)))
    // Sans normalisation la crête plafonnerait vers 0,05 × 32767 ≈ 1638.
    expect(crete).toBeGreaterThan(10_000)
  })
})

describe('gainNormalisation', () => {
  it('n’amplifie JAMAIS un segment déjà correct, et ne l’atténue pas non plus', () => {
    expect(gainNormalisation(parole(1000, 0.9))).toBe(1)
    expect(gainNormalisation(parole(1000, 1))).toBe(1)
    // Juste sous la cible : la zone morte évite de re-multiplier tout le buffer pour rien.
    expect(gainNormalisation(parole(1000, 0.88))).toBe(1)
    // Le bornage à [-1, 1] reste la seule limite haute : pas de réduction déguisée ici.
    expect(gainNormalisation(Float32Array.from([2, -2]))).toBe(1)
  })

  it('remonte un segment faible vers la crête cible', () => {
    // Amplitude choisie SOUS le plafond (0,9 / 0,15 = 6) pour prouver la cible, pas le plafond.
    const gain = gainNormalisation(parole(1000, 0.15))
    expect(gain).toBeGreaterThan(1)
    expect(gain).toBeLessThan(GAIN_MAX)
    expect(0.15 * gain).toBeCloseTo(CRETE_CIBLE, 1)
  })

  it('PLAFONNE le gain : du souffle multiplié par 200 deviendrait de la parole inventée', () => {
    // Sans plafond, whisper transcrit du bruit amplifié — et un ordre inventé s'exécute.
    // 0,9 / 0,05 = 18 demandé, donc le plafond DOIT mordre ici.
    expect(gainNormalisation(parole(1000, 0.05))).toBe(GAIN_MAX)
  })

  it('ne touche pas au silence ni au quasi-silence : y monter le gain ne crée pas de voix', () => {
    expect(gainNormalisation(new Float32Array(1000))).toBe(1)
    expect(gainNormalisation(parole(1000, 0.001))).toBe(1)
    expect(gainNormalisation(new Float32Array(0))).toBe(1)
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

describe('jauge de niveau', () => {
  it('rend 0 sur le silence absolu', () => {
    expect(jaugeDepuisNiveau(0)).toBe(0)
  })

  it('rend une fraction VISIBLE pour une voix normale, là où une échelle linéaire mentirait', () => {
    // RMS 0,05 = voix normale ; en linéaire la barre ferait 5 % et se lirait « il n'entend rien ».
    expect(jaugeDepuisNiveau(0.05)).toBeGreaterThan(0.5)
  })

  it('reste borné à 1 sur une saturation', () => {
    expect(jaugeDepuisNiveau(4)).toBe(1)
  })

  it('croît avec le niveau', () => {
    expect(jaugeDepuisNiveau(0.02)).toBeGreaterThan(jaugeDepuisNiveau(0.005))
  })

  it('reste sous le repère de seuil quand le niveau est sous le seuil de parole', () => {
    expect(jaugeDepuisNiveau(0.005)).toBeLessThan(jaugeDepuisNiveau(SEUIL_PAROLE))
  })
})

describe('seuilValide', () => {
  it('borne un seuil aberrant plutôt que de rendre Jarvis sourd', () => {
    expect(seuilValide(99)).toBe(SEUIL_MAX)
    expect(seuilValide(0)).toBe(SEUIL_MIN)
    expect(seuilValide(Number.NaN)).toBe(SEUIL_PAROLE)
  })

  it('laisse passer une valeur dans les bornes', () => {
    expect(seuilValide(0.02)).toBe(0.02)
  })
})

describe('niveau exporté', () => {
  it('est la MÊME mesure que celle qui décide de la parole', () => {
    const fort = new Float32Array(64).fill(0.5)
    expect(niveau(fort)).toBeCloseTo(0.5, 5)
    expect(niveau(new Float32Array(0))).toBe(0)
  })
})

describe('verdictMicro', () => {
  it("dit « coupé » avant toute autre chose : l'écoute inactive n'est pas un silence", () => {
    expect(verdictMicro(false, 0.5, SEUIL_PAROLE)).toBe('coupe')
  })

  it('distingue « je parle dans le vide » de « micro cassé » — le cas qui a motivé la jauge', () => {
    expect(verdictMicro(true, 0, SEUIL_PAROLE)).toBe('silence')
    expect(verdictMicro(true, SEUIL_PAROLE / 2, SEUIL_PAROLE)).toBe('silence')
  })

  it('un signal juste au seuil est FAIBLE, pas bon : il déclenche, mais transcrit mal', () => {
    expect(verdictMicro(true, SEUIL_PAROLE, SEUIL_PAROLE)).toBe('faible')
  })

  it('au double du seuil, le micro est bon', () => {
    expect(verdictMicro(true, SEUIL_PAROLE * 2, SEUIL_PAROLE)).toBe('bon')
  })

  it("au-dessus de la crête de saturation, « bon » serait un mensonge : ça écrête", () => {
    expect(verdictMicro(true, CRETE_SATURATION, SEUIL_PAROLE)).toBe('sature')
    expect(verdictMicro(true, 1, SEUIL_PAROLE)).toBe('sature')
  })

  it("suit le seuil RÉGLÉ par l'utilisateur, pas une constante figée", () => {
    expect(verdictMicro(true, 0.01, SEUIL_MAX)).toBe('silence')
    expect(verdictMicro(true, 0.01, SEUIL_MIN)).toBe('bon')
  })

  it('chaque verdict porte un message lisible, sans trou', () => {
    for (const v of ['coupe', 'silence', 'faible', 'bon', 'sature'] as const) {
      expect(MESSAGE_VERDICT[v].length).toBeGreaterThan(0)
    }
  })
})
