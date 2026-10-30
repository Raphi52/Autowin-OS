import { tableDeTextes } from '../textes'

/**
 * TEXTES — ÉCRAN « HORS DE L'APPLICATION » (conv-1286, 2026-10-29).
 *
 * Écran couvert : `HorsElectron.tsx`, affiché à la place de l'interface quand elle est ouverte dans un
 * navigateur ordinaire (`http://localhost:5173` hors de la fenêtre Electron), où le pont `window.api`
 * n'existe pas. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait foi ; l'anglais a
 * les MÊMES clés, n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`.
 *
 * RESTENT EN FRANÇAIS, hors de cette table : la commande `npm run dev`, identique dans les deux
 * langues, laissée en dur dans le composant.
 */
export const TEXTES_FR = {
  'horsElectron.kicker': 'Hors de l’application',
  'horsElectron.titre': 'Cette page ne s’ouvre que dans l’application Autowin OS',
  'horsElectron.explication':
    'Tu regardes l’interface d’Autowin OS dans un navigateur ordinaire. Elle a besoin de l’application pour lire tes conversations et tes réglages, et pour lancer les agents. Ici, ce lien n’existe pas : rien ne peut s’afficher.',
  'horsElectron.conseil': 'Ouvre l’application Autowin OS. En développement, lance-la avec'
} as const

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'horsElectron.kicker': 'Outside the app',
  'horsElectron.titre': 'This page only opens inside the Autowin OS app',
  'horsElectron.explication':
    'You are looking at the Autowin OS interface in a regular browser. It needs the app to read your conversations and settings, and to start agents. That link does not exist here, so nothing can be shown.',
  'horsElectron.conseil': 'Open the Autowin OS app. During development, start it with'
}

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {}

export const { useTextes: useTextesHorsElectron } = tableDeTextes(TEXTES_FR, TEXTES_EN)
