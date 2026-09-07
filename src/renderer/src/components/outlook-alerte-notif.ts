/**
 * L'ALERTE elle-même : une popup système et un son court.
 *
 * Séparée des règles pures (`outlook-alertes.ts`) parce que c'est ici que vivent les effets de bord :
 * l'autorisation de notifier et le contexte audio. Les deux moitiés sont INDÉPENDANTES — un son doit
 * partir même si l'utilisateur a refusé les popups du système, sinon l'alerte serait muette sans que
 * personne ne sache pourquoi.
 *
 * Le son est SYNTHÉTISÉ (deux notes, WebAudio) : aucun fichier à embarquer, aucune requête réseau.
 */
import type { AlerteMessage } from './outlook-alertes'

/** Demande l'autorisation de notifier, une fois. Un refus n'est pas une panne : le son reste. */
export async function autoriserPopups(): Promise<boolean> {
  const Notif = (globalThis as { Notification?: typeof Notification }).Notification
  if (!Notif) return false
  if (Notif.permission === 'granted') return true
  if (Notif.permission === 'denied') return false
  try {
    return (await Notif.requestPermission()) === 'granted'
  } catch {
    return false
  }
}

export function afficherPopup(alerte: AlerteMessage): boolean {
  const Notif = (globalThis as { Notification?: typeof Notification }).Notification
  if (!Notif || Notif.permission !== 'granted') return false
  try {
    // `tag` = l'identifiant du message : si l'alerte repart, elle REMPLACE la précédente au lieu
    // d'empiler deux popups pour un seul message.
    new Notif(`${alerte.contact} — ${alerte.sujet}`, { body: alerte.apercu, tag: alerte.id })
    return true
  } catch {
    return false
  }
}

type ContexteAudio = AudioContext & { state: string }
let contexte: ContexteAudio | null = null

/** Deux notes brèves, montantes. Court à dessein : une alerte ne doit pas couvrir un appel. */
export function jouerSon(): boolean {
  const Ctor = (
    globalThis as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }
  ).AudioContext
  if (!Ctor) return false
  try {
    if (contexte === null) contexte = new Ctor() as ContexteAudio
    if (contexte.state === 'suspended') void contexte.resume()
    const debut = contexte.currentTime
    for (const [rang, frequence] of [880, 1174].entries()) {
      const oscillateur = contexte.createOscillator()
      const gain = contexte.createGain()
      oscillateur.type = 'sine'
      oscillateur.frequency.value = frequence
      // Une enveloppe, pas un créneau : un gain qui s'ouvre et se ferme d'un coup produit un clic.
      const t = debut + rang * 0.16
      gain.gain.setValueAtTime(0.0001, t)
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15)
      oscillateur.connect(gain)
      gain.connect(contexte.destination)
      oscillateur.start(t)
      oscillateur.stop(t + 0.16)
    }
    return true
  } catch {
    return false
  }
}

/** Popup + son pour UN message. Le son part même si la popup a été refusée. */
export function alerter(alerte: AlerteMessage): void {
  afficherPopup(alerte)
  jouerSon()
}
