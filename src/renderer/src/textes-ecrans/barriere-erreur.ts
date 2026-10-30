import { APP_DESTINATIONS, type AppDestination } from '../../../shared/navigation'
import { tableDeTextes, nomDeDestination } from '../textes'
import type { Langue } from '../../../shared/langue'

/**
 * TEXTES — LE BLOC EN PANNE (conv-1327, 2026-10-30).
 *
 * Écran couvert : `BarriereErreur.tsx`, affiché à la place d'un composant qui a levé une erreur. Règles
 * communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait foi ; l'anglais a les MÊMES clés, n'est
 * jamais vide, diffère du français et garde les mêmes `{valeurs}`.
 */
export const TEXTES_FR = {
  'barriere.titreBloc': '{nom} : une erreur a arrêté ce bloc',
  'barriere.titreVue': '{nom} : une erreur a arrêté cet écran',
  'barriere.titreRacine': 'Une erreur a arrêté l’interface',
  'barriere.suite': 'Le reste de l’application continue de marcher.',
  'barriere.suiteRacine': 'Tes conversations et les agents en cours ne sont pas touchés.',
  'barriere.sansDetail': 'Erreur sans message.',
  'barriere.reessayer': 'Réessayer',
  'barriere.recharger': 'Recharger l’interface',
  'barriere.zone.liste': 'Liste des conversations',
  'barriere.zone.fil': 'Fil de la conversation',
  'barriere.zone.saisie': 'Zone de saisie',
  'barriere.zone.details': 'Panneau Détails',
  'barriere.zone.message': 'Message du fil',
  'barriere.zone.lots': 'Tableau des lots',
  'barriere.zone.navigateur': 'Navigateur intégré',
  'barriere.zone.miseAJour': 'Mise à jour',
  'barriere.zone.decor': 'Fond de l’Accueil'
} as const

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'barriere.titreBloc': '{nom}: an error stopped this block',
  'barriere.titreVue': '{nom}: an error stopped this screen',
  'barriere.titreRacine': 'An error stopped the interface',
  'barriere.suite': 'The rest of the app keeps working.',
  'barriere.suiteRacine': 'Your conversations and running agents are not affected.',
  'barriere.sansDetail': 'Error without a message.',
  'barriere.reessayer': 'Try again',
  'barriere.recharger': 'Reload the interface',
  'barriere.zone.liste': 'Conversation list',
  'barriere.zone.fil': 'Conversation thread',
  'barriere.zone.saisie': 'Message box',
  'barriere.zone.details': 'Details panel',
  'barriere.zone.message': 'Thread message',
  'barriere.zone.lots': 'Batch board',
  'barriere.zone.navigateur': 'Built-in browser',
  'barriere.zone.miseAJour': 'Update',
  'barriere.zone.decor': 'Home background'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {}

const table = tableDeTextes(TEXTES_FR, TEXTES_EN)
export const useTextesBarriere = table.useTextes

/** Les zones qui ne sont pas des écrans : un bloc à l'intérieur d'un écran, ou une pièce de la coque. */
const CLES_DE_ZONE: Readonly<Record<string, keyof typeof TEXTES_FR>> = {
  'chat-liste': 'barriere.zone.liste',
  'chat-fil': 'barriere.zone.fil',
  'chat-saisie': 'barriere.zone.saisie',
  'chat-workflows': 'barriere.zone.details',
  'chat-message': 'barriere.zone.message',
  'chat-lots': 'barriere.zone.lots',
  'chat-navigateur': 'barriere.zone.navigateur',
  'mise-a-jour': 'barriere.zone.miseAJour',
  decor: 'barriere.zone.decor'
}

/** Vrai si la zone est un écran de l'application : son nom est alors celui du menu de gauche. */
export function estUnEcran(zone: string): zone is AppDestination {
  return APP_DESTINATIONS.some((destination) => destination.id === zone)
}

/** Le nom montré à l'utilisateur : celui du menu pour un écran, celui de la table pour un bloc. */
export function nomDeZone(zone: string, langue: Langue): string {
  if (estUnEcran(zone)) return nomDeDestination(zone, langue)
  const cle = CLES_DE_ZONE[zone]
  if (!cle) return zone
  return (langue === 'en' ? TEXTES_EN : TEXTES_FR)[cle]
}
