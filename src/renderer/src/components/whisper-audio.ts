/**
 * DE L'ONDE AU FICHIER : ce que le micro produit, et ce que whisper.cpp accepte.
 *
 * whisper.cpp ne prend qu'UNE forme : WAV PCM 16 bits, mono, 16 000 Hz. Un micro Windows rend
 * couramment du 44 100 ou 48 000 Hz en flottants. Sans conversion, la CLI rend une transcription
 * VIDE — un silence qui ressemble trait pour trait au défaut d'origine (« il ne m'entend pas »),
 * mais dont la cause serait ailleurs. D'où ces fonctions PURES, prouvables sans micro.
 *
 * L'autre décision qui vit ici : QUAND s'arrête une phrase. Whisper transcrit un fichier, pas un
 * flux — il faut donc découper. Le découpage se fait sur le silence, avec deux gardes apprises du
 * défaut d'origine : un PRÉ-ROLL (sinon la première syllabe, donc « Jarvis », est coupée) et une
 * durée minimale (sinon chaque bruit de clavier déclenche une transcription).
 */

export const TAUX_WHISPER = 16_000

/** Au-dessus de ce niveau efficace (RMS), on considère qu'il y a de la voix. */
export const SEUIL_PAROLE = 0.012
/** Silence à partir duquel la phrase est réputée finie. Assez long pour tolérer une respiration. */
export const MS_SILENCE_FIN = 700
/** En deçà, ce n'était pas une phrase : bruit, souffle, claquement. */
export const MS_PAROLE_MINIMUM = 350
/** Audio conservé AVANT le déclenchement : c'est lui qui sauve la première syllabe. */
export const MS_PRE_ROLL = 400
/** Une parole qui ne s'arrête jamais est coupée ici, plutôt que de gonfler la mémoire sans fin. */
export const DUREE_MAX_MS = 15_000

/** Interpolation linéaire : suffisante pour de la voix, et sans dépendance. */
export function reechantillonner(
  entree: Float32Array,
  tauxSource: number,
  tauxCible: number
): Float32Array {
  if (tauxSource === tauxCible) return entree
  const rapport = tauxSource / tauxCible
  const taille = Math.max(0, Math.round(entree.length / rapport))
  const sortie = new Float32Array(taille)
  for (let i = 0; i < taille; i += 1) {
    const position = i * rapport
    const gauche = Math.floor(position)
    const droite = Math.min(gauche + 1, entree.length - 1)
    const fraction = position - gauche
    sortie[i] = (entree[gauche] ?? 0) * (1 - fraction) + (entree[droite] ?? 0) * fraction
  }
  return sortie
}

/**
 * LE NIVEAU D'ENTRÉE, remonté avant encodage — la cause mesurée du « charabia ».
 *
 * MESURE du 2026-08-31, même CLI, même modèle, MÊME phrase, seul le niveau change :
 *   niveau normal → « Jarvie, ouvre le gestionnaire de tâche. »   (juste)
 *   −18 dB        → « J'arrivée, ouvre le jeu. »                  (nom perdu, ordre faux)
 * Un micro loin, un gain d'entrée bas ou une voix calme suffisent donc à rendre Jarvis inutilisable,
 * sans qu'aucune erreur ne soit remontée : la transcription réussit, elle est simplement fausse.
 *
 * Ce que fait cette fonction, et SURTOUT ce qu'elle ne fait pas :
 *  - elle n'AMPLIFIE que. Un segment déjà correct n'est jamais touché, et jamais atténué : le
 *    bornage à [-1, 1] reste la seule limite haute, avec le test qui le prouve.
 *  - le gain est PLAFONNÉ. Sans plafond, un segment quasi muet serait multiplié par 200 et son
 *    souffle deviendrait de la « parole » — whisper invente sur du bruit amplifié, et un ordre
 *    inventé s'exécute.
 *  - sous le PLANCHER de niveau efficace, on ne touche à rien : il n'y a pas de voix là-dedans,
 *    et remonter du silence ne fabrique pas de la parole.
 *
 * HONNÊTETÉ SUR LA PORTÉE : ce correctif est partiel, c'est mesuré. Le même segment −18 dB
 * normalisé (×10,8) rend « J'arvie, ouvre le jeu. » — le nom redevient atteignable par la regex
 * d'éveil, l'ordre reste faux. Remonter le niveau récupère ce qui est récupérable ; l'information
 * détruite à la capture ne revient pas. Un micro correctement réglé reste nécessaire.
 */
export const CRETE_CIBLE = 0.9
export const GAIN_MAX = 12
export const RMS_PLANCHER = 0.004
/**
 * ZONE MORTE. Une crête à 0,8999 donnerait un gain de 1,0000010 : re-multiplier 240 000
 * échantillons pour un millionième de dB est du travail pur, et brouille la garantie « un segment
 * correct n'est pas touché ». En dessous de ce seuil, on ne touche à rien.
 */
export const GAIN_MINIMUM = 1.05

export function gainNormalisation(echantillons: Float32Array): number {
  if (echantillons.length === 0) return 1
  let crete = 0
  let somme = 0
  for (let i = 0; i < echantillons.length; i += 1) {
    const valeur = echantillons[i]
    const absolu = Math.abs(valeur)
    if (absolu > crete) crete = absolu
    somme += valeur * valeur
  }
  if (crete === 0) return 1
  if (Math.sqrt(somme / echantillons.length) < RMS_PLANCHER) return 1
  const gain = CRETE_CIBLE / crete
  if (gain < GAIN_MINIMUM) return 1
  return Math.min(GAIN_MAX, gain)
}

/** Le WAV attendu par whisper.cpp, en-tête RIFF compris. */
export function encoderWav16k(pcm: Float32Array, tauxSource: number): Uint8Array {
  const echantillons = reechantillonner(pcm, tauxSource, TAUX_WHISPER)
  const gain = gainNormalisation(echantillons)
  const octetsData = echantillons.length * 2
  const tampon = new ArrayBuffer(44 + octetsData)
  const vue = new DataView(tampon)
  const texte = (position: number, valeur: string): void => {
    for (let i = 0; i < valeur.length; i += 1) vue.setUint8(position + i, valeur.charCodeAt(i))
  }
  texte(0, 'RIFF')
  vue.setUint32(4, 36 + octetsData, true)
  texte(8, 'WAVE')
  texte(12, 'fmt ')
  vue.setUint32(16, 16, true) // taille du bloc fmt
  vue.setUint16(20, 1, true) // PCM entier
  vue.setUint16(22, 1, true) // mono
  vue.setUint32(24, TAUX_WHISPER, true)
  vue.setUint32(28, TAUX_WHISPER * 2, true) // octets par seconde
  vue.setUint16(32, 2, true) // alignement de bloc
  vue.setUint16(34, 16, true) // bits par échantillon
  texte(36, 'data')
  vue.setUint32(40, octetsData, true)
  for (let i = 0; i < echantillons.length; i += 1) {
    // BORNAGE explicite : un flottant hors [-1, 1] écrit tel quel repasserait en négatif.
    const borne = Math.max(-1, Math.min(1, echantillons[i] * gain))
    vue.setInt16(44 + i * 2, borne < 0 ? borne * 0x8000 : borne * 0x7fff, true)
  }
  return new Uint8Array(tampon)
}

export interface EtatVad {
  parle: boolean
  /** Blocs de la phrase en cours, pré-roll compris. */
  tampon: readonly Float32Array[]
  /** Blocs récents gardés AVANT le déclenchement. */
  preRoll: readonly Float32Array[]
  echantillonsParole: number
  echantillonsSilence: number
}

export const etatVadInitial: EtatVad = {
  parle: false,
  tampon: [],
  preRoll: [],
  echantillonsParole: 0,
  echantillonsSilence: 0
}

function niveau(bloc: Float32Array): number {
  if (bloc.length === 0) return 0
  let somme = 0
  for (let i = 0; i < bloc.length; i += 1) somme += bloc[i] * bloc[i]
  return Math.sqrt(somme / bloc.length)
}

export function coller(blocs: readonly Float32Array[]): Float32Array {
  let taille = 0
  for (const bloc of blocs) taille += bloc.length
  const total = new Float32Array(taille)
  let position = 0
  for (const bloc of blocs) {
    total.set(bloc, position)
    position += bloc.length
  }
  return total
}

/**
 * Un bloc de micro entre, un SEGMENT sort — ou rien. Fonction pure : c'est ici que se prouve, sans
 * micro, qu'une phrase est bien découpée là où l'utilisateur s'arrête de parler.
 */
export function avancerVad(
  etat: EtatVad,
  bloc: Float32Array,
  tauxHz: number,
  seuil: number = SEUIL_PAROLE
): { etat: EtatVad; segment: Float32Array | null } {
  const parleIci = niveau(bloc) >= seuil
  const maxPreRoll = Math.round((MS_PRE_ROLL / 1000) * tauxHz)
  const maxSegment = Math.round((DUREE_MAX_MS / 1000) * tauxHz)

  if (!etat.parle) {
    if (!parleIci) {
      // Fenêtre glissante d'avant-parole : bornée, sinon elle grandirait pendant tout le silence.
      const preRoll = [...etat.preRoll, bloc]
      let total = 0
      for (const b of preRoll) total += b.length
      while (total - (preRoll[0]?.length ?? 0) >= maxPreRoll && preRoll.length > 1) {
        total -= preRoll.shift()!.length
      }
      return { etat: { ...etat, preRoll }, segment: null }
    }
    return {
      etat: {
        parle: true,
        tampon: [...etat.preRoll, bloc],
        preRoll: [],
        echantillonsParole: bloc.length,
        echantillonsSilence: 0
      },
      segment: null
    }
  }

  const tampon = [...etat.tampon, bloc]
  const echantillonsParole = etat.echantillonsParole + (parleIci ? bloc.length : 0)
  const echantillonsSilence = parleIci ? 0 : etat.echantillonsSilence + bloc.length
  let total = 0
  for (const b of tampon) total += b.length

  const finDePhrase = echantillonsSilence >= (MS_SILENCE_FIN / 1000) * tauxHz
  const tropLong = total >= maxSegment
  if (!finDePhrase && !tropLong) {
    return {
      etat: { ...etat, tampon, echantillonsParole, echantillonsSilence },
      segment: null
    }
  }

  const assezDeParole = echantillonsParole >= (MS_PAROLE_MINIMUM / 1000) * tauxHz
  return {
    etat: etatVadInitial,
    segment: assezDeParole ? coller(tampon) : null
  }
}
