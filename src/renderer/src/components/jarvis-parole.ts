/**
 * LA VOIX DE JARVIS — 100 % locale, dans les deux cas.
 *
 * DEUX VOIX, DANS CET ORDRE.
 *  1. La voix NEURONALE (Piper), si l'utilisateur l'a installée d'un clic. C'est celle qu'il est
 *     venu chercher : « des voix plus sympa ». Elle est prononcée par l'application, qui rend un
 *     son ; cette fenêtre ne fait que le jouer.
 *  2. Sinon, les voix DÉJÀ présentes dans le système (`speechSynthesis`). Leur qualité est le
 *     plafond du poste, mais elles marchent au premier lancement, sans rien télécharger.
 *
 * La voix neuronale n'est JAMAIS un préalable : si elle est absente, si l'application ne répond
 * pas, ou si la synthèse échoue, on retombe sur la voix du système. Jarvis ne se tait pas parce
 * qu'un moteur manque.
 *
 * Ce fichier ne DÉCIDE rien : il ne fait que prononcer. La question « faut-il parler ? » vit dans
 * `jarvis-voice.ts` (`phraseDeJarvis`), où elle se prouve sans haut-parleur.
 */

import { lireReglageVoix, REGLAGE_VOIX_DEFAUT, type ReglageVoix } from './jarvis-voix-reglage'

interface MoteurParole {
  speak: (u: SpeechSynthesisUtterance) => void
  cancel: () => void
  getVoices: () => SpeechSynthesisVoice[]
}

interface FenetreParole {
  speechSynthesis?: MoteurParole
  SpeechSynthesisUtterance?: new (texte: string) => SpeechSynthesisUtterance
}

function fenetre(): FenetreParole {
  return globalThis as unknown as FenetreParole
}

/**
 * L'IDENTIFIANT DE LA VOIX NEURONALE dans le réglage. Elle n'existe pas dans `speechSynthesis` :
 * sans cette entrée à elle, la liste des voix ne pourrait pas la nommer, et l'utilisateur ne
 * verrait nulle part la voix qu'il vient d'installer.
 */
export const VOIX_PIPER_URI = 'piper:fr_FR-siwis-medium'

/** La voix retenue : la recalculer a chaque phrase couterait un parcours de liste. */
let voixChoisie: SpeechSynthesisVoice | null = null

/** Ce que l'application expose de la voix neuronale. Absent hors application (test pur). */
interface ApiVoix {
  piperEtat?: () => Promise<{ installe: boolean }>
  piperParler?: (texte: string) => Promise<Uint8Array>
}
const apiVoix = (): ApiVoix | undefined =>
  (globalThis as unknown as { window?: { api?: ApiVoix }; api?: ApiVoix }).api

/**
 * LE SON EN COURS, retenu pour pouvoir le COUPER. Sans cette référence, « se taire » n'aurait
 * aucune prise sur la voix neuronale : `speechSynthesis.cancel()` ne connaît pas un `<audio>`, et
 * Jarvis finirait sa phrase micro déjà éteint.
 */
let sonEnCours: { pause: () => void; src: string } | null = null
let urlEnCours: string | null = null

/**
 * LE NUMÉRO DE LA PHRASE COURANTE. La synthèse neuronale prend un instant : sans ce compteur, une
 * phrase demandée puis annulée reviendrait de l'application et se jouerait quand même, après le
 * silence.
 */
let generation = 0

/** L'état de la voix neuronale, demandé UNE fois : il ne change qu'à une installation. */
let piperInstalle: Promise<boolean> | null = null

/** À appeler après une installation : la prochaine phrase redemandera l'état au lieu de le croire. */
export function oublierEtatPiper(): void {
  piperInstalle = null
}

function couperSon(): void {
  try {
    sonEnCours?.pause()
  } catch {
    // Un son déjà terminé ne se met pas en pause : il n'y a rien à réparer.
  }
  sonEnCours = null
  if (urlEnCours) {
    try {
      ;(globalThis as unknown as { URL?: typeof URL }).URL?.revokeObjectURL?.(urlEnCours)
    } catch {
      // Sans cette libération, le son resterait en mémoire ; ce n'est pas une raison d'échouer.
    }
    urlEnCours = null
  }
}

/** Les voix installees sur le poste, telles que le systeme les expose. Vide si aucune synthese. */
export function listerVoix(): SpeechSynthesisVoice[] {
  try {
    return fenetre().speechSynthesis?.getVoices() ?? []
  } catch {
    return []
  }
}

/**
 * QUELLE VOIX. D'abord CELLE QUE L'UTILISATEUR A CHOISIE dans les reglages de l'accueil : c'est la
 * seule raison d'etre du reglage, et une voix choisie qui ne serait pas prononcee serait pire que
 * pas de reglage du tout. Si ce choix ne correspond plus a rien (voix desinstallee, poste change),
 * on ne se tait PAS : on retombe sur le francais — l'assistant repond dans la langue de l'interface
 * et une voix anglaise lisant « C'est fait » est inintelligible —, puis sur la voix par defaut du
 * systeme, puis sur la premiere disponible. Aucune voix du tout = on ne parle pas, on ne casse rien.
 */
export function choisirVoix(
  voix: readonly SpeechSynthesisVoice[],
  voixURI = ''
): SpeechSynthesisVoice | null {
  if (voix.length === 0) return null
  const demandee = voixURI.trim()
  return (
    (demandee === ''
      ? undefined
      : (voix.find((v) => v.voiceURI === demandee) ?? voix.find((v) => v.name === demandee))) ??
    voix.find((v) => v.lang?.toLowerCase().startsWith('fr')) ??
    voix.find((v) => v.default) ??
    voix[0]
  )
}

/** Le reglage courant, relu depuis le stockage local. Absent (test pur) = reglage d'origine. */
function reglageCourant(): ReglageVoix {
  const w = globalThis as unknown as { localStorage?: Storage }
  if (!w.localStorage) return { ...REGLAGE_VOIX_DEFAUT }
  return lireReglageVoix(w.localStorage)
}

/**
 * Prononce avec la voix du SYSTÈME. C'est le repli : il marche partout, sans rien installer.
 *
 * Une nouvelle phrase ANNULE la précédente : Jarvis ne doit jamais empiler un retard de paroles,
 * sinon il commente encore l'ordre d'avant pendant qu'on lui en donne un nouveau.
 */
function parlerSysteme(texte: string): boolean {
  const w = fenetre()
  const moteur = w.speechSynthesis
  const Enonce = w.SpeechSynthesisUtterance
  if (!moteur || !Enonce) return false
  const reglage = reglageCourant()
  try {
    if (!voixChoisie) voixChoisie = choisirVoix(moteur.getVoices() ?? [], reglage.voixURI)
    moteur.cancel()
    const enonce = new Enonce(texte)
    if (voixChoisie) {
      enonce.voice = voixChoisie
      enonce.lang = voixChoisie.lang
    } else {
      enonce.lang = 'fr-FR'
    }
    enonce.rate = reglage.debit
    enonce.pitch = reglage.hauteur
    moteur.speak(enonce)
    return true
  } catch {
    // Un haut-parleur absent ou une politique de lecture automatique ne doit pas casser l'écoute.
    return false
  }
}

/** La voix neuronale est-elle réellement installée sur ce poste ? Demandé à l'application, une fois. */
async function piperDisponible(): Promise<boolean> {
  const api = apiVoix()
  if (!api?.piperEtat || !api.piperParler) return false
  piperInstalle ??= api
    .piperEtat()
    .then((etat) => etat.installe === true)
    .catch(() => false)
  return piperInstalle
}

/**
 * Prononce avec la voix NEURONALE. Rend `false` dès que quoi que ce soit manque — l'appelant
 * retombe alors sur la voix du système plutôt que de laisser Jarvis muet.
 */
async function parlerPiper(texte: string, mien: number): Promise<boolean> {
  if (!(await piperDisponible())) return false
  const api = apiVoix()
  const g = globalThis as unknown as {
    Blob?: typeof Blob
    URL?: typeof URL
    Audio?: new (url: string) => HTMLAudioElement
  }
  if (!api?.piperParler || !g.Blob || !g.URL?.createObjectURL || !g.Audio) return false
  try {
    const wav = await api.piperParler(texte)
    // Une phrase annulée pendant la synthèse ne se joue PAS : sinon Jarvis parlerait après
    // qu'on l'a fait taire.
    if (mien !== generation) return true
    const url = g.URL.createObjectURL(new g.Blob([wav as BlobPart], { type: 'audio/wav' }))
    couperSon()
    const son = new g.Audio(url)
    sonEnCours = son
    urlEnCours = url
    void son.play()?.catch?.(() => {
      /* lecture automatique refusée : la phrase est perdue, l'écoute continue */
    })
    return true
  } catch {
    // Moteur absent, synthèse en échec, canal coupé : la voix du système prend le relais.
    return false
  }
}

/**
 * Prononce `texte`. Rend `false` quand AUCUNE voix n'a pu parler — un poste sans synthèse doit
 * rester utilisable, seul le retour parlé manque.
 *
 * La promesse se résout dès que la phrase est LANCÉE, pas quand elle est finie : l'appelant ne
 * doit jamais attendre la fin d'une réplique pour continuer à écouter.
 */
export async function parler(texte: string): Promise<boolean> {
  if (texte.trim() === '') return false
  const mien = ++generation
  couperSon()
  if (await parlerPiper(texte, mien)) return true
  if (mien !== generation) return false
  return parlerSysteme(texte)
}

/**
 * Oublie la voix retenue : le prochain mot relira le reglage. Appele quand l'utilisateur change de
 * voix, sinon l'assistant garderait jusqu'au redemarrage celle chargee a sa premiere phrase.
 */
export function oublierVoixChoisie(): void {
  voixChoisie = null
}

/**
 * Coupe la parole IMMÉDIATEMENT : micro coupé, changement de mode, démontage du widget.
 *
 * Les DEUX voix sont coupées. N'annuler que `speechSynthesis` laissait la voix neuronale finir sa
 * phrase toute seule, micro déjà éteint — exactement ce que « se taire » doit empêcher. Le compteur
 * avance aussi : une synthèse déjà partie ne se jouera plus en revenant.
 */
export function taireJarvis(): void {
  generation += 1
  try {
    fenetre().speechSynthesis?.cancel()
  } catch {
    // Rien à faire : se taire ne peut pas échouer de façon utile.
  }
  couperSon()
  voixChoisie = null
}
