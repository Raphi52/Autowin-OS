/**
 * LA VOIX DE JARVIS — 100 % locale, sans réseau et sans rien à installer.
 *
 * On utilise les voix DÉJÀ présentes dans le système (l'API `speechSynthesis` du navigateur les
 * expose). C'est le seul moyen de parler hors ligne dès le premier lancement : une vraie voix
 * neuronale se télécharge, se stocke et se choisit — ce sera une suite, pas un préalable.
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

/** La voix retenue : la recalculer a chaque phrase couterait un parcours de liste. */
let voixChoisie: SpeechSynthesisVoice | null = null

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
 * Prononce `texte`. Rend `false` quand aucune voix n'est disponible dans cette fenêtre — un poste
 * sans synthèse vocale doit rester utilisable, seul le retour parlé manque.
 *
 * Une nouvelle phrase ANNULE la précédente : Jarvis ne doit jamais empiler un retard de paroles,
 * sinon il commente encore l'ordre d'avant pendant qu'on lui en donne un nouveau.
 */
export function parler(texte: string): boolean {
  const w = fenetre()
  const moteur = w.speechSynthesis
  const Enonce = w.SpeechSynthesisUtterance
  if (!moteur || !Enonce || texte.trim() === '') return false
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

/**
 * Oublie la voix retenue : le prochain mot relira le reglage. Appele quand l'utilisateur change de
 * voix, sinon l'assistant garderait jusqu'au redemarrage celle chargee a sa premiere phrase.
 */
export function oublierVoixChoisie(): void {
  voixChoisie = null
}

/** Coupe la parole IMMÉDIATEMENT : micro coupé, changement de mode, démontage du widget. */
export function taireJarvis(): void {
  try {
    fenetre().speechSynthesis?.cancel()
  } catch {
    // Rien à faire : se taire ne peut pas échouer de façon utile.
  }
  voixChoisie = null
}
