import { tableDeTextes } from '../textes'

/**
 * TEXTES — NOMS DES THÈMES, MASCOTTE, DÉCORS DE L’ACCUEIL ET DERNIERS FICHIERS (traduction anglaise, conv-1170, 2026-10-27).
 *
 * Écrans couverts : theme-mode, MascotteReglage, les décors animés de l’accueil (`home-decor-*`), la réparation du
 * diagnostic, le traitement des tickets et les derniers textes isolés.
 *
 * Une table par groupe d'écrans pour que les lots de traduction, menés en même temps, n'écrivent
 * jamais dans le même fichier. Règles communes, vérifiées par `tables.test.ts` : le FRANÇAIS fait
 * foi, mot pour mot celui de l'écran ; l'anglais a les MÊMES clés (le type refuse une clé manquante
 * ou en trop), n'est jamais vide, diffère du français et garde les mêmes `{valeurs}`. Un anglais
 * volontairement identique au français (nom propre, nom de produit) se déclare dans
 * `IDENTIQUES_AU_FRANCAIS`, avec sa raison.
 */
export const TEXTES_FR = {
  // Settings · Interface — « Mascotte du bureau » (MascotteReglage.tsx). Les noms des thèmes, eux,
  // sont déjà traduits par la table principale (`THEMES_EN`, `nomDeTheme` dans textes.ts, lot 1).
  'mascotte.titre': 'Mascotte du bureau',
  'mascotte.description':
    'La **bille** aux couleurs du logo, juste au-dessus de l’horloge, quand Autowin est réduit ou derrière une autre fenêtre. Son halo dit si un agent **travaille**, si un fil **t’attend** ou si un tour a **échoué** ; un clic ouvre le fil. Au survol, sa **poignée** (en haut à gauche) la déplace et sa **croix** la ferme : elle ne revient alors que par cet interrupteur. Tant qu’elle est affichée, les cartes de fin de tour portent un **liseré arc-en-ciel**. Masquée, elle disparaît aussitôt et les cartes reprennent leur bord habituel.',
  'mascotte.interrupteur': 'Afficher la mascotte du bureau',
  'mascotte.affichee': 'Affichée',
  'mascotte.masquee': 'Masquée',
  'mascotte.erreurLecture': 'Le réglage de la mascotte n’a pas pu être lu.',
  'mascotte.erreurEnregistrement':
    'Le choix n’a pas pu être enregistré : la mascotte reste comme avant.',

  // Boutons « réparer » du diagnostic (preflight-repair-affordance.ts). Le français est AUSSI celui
  // du plan du moteur (`src/main/preflight-repair.ts`), que le test de contrat compare.
  'reparation.claudeSession.libelle': 'Se connecter',
  'reparation.claudeSession.note':
    'Une console s’ouvre : le CLI est installé s’il manque, puis le login Anthropic s’y fait. Rien n’est saisi dans Autowin.',
  'reparation.brainVenv.libelle': 'Installer',
  'reparation.brainVenv.note':
    'Ouvre une console sur scripts/bootstrap-deps.ps1 : il pose le venv et le tooling du Brain (plusieurs minutes).',
  'reparation.brain.libelle': 'Démarrer',
  'reparation.brain.note':
    'Tente de lancer le brain_server local (le port s’ouvre après ~30-40 s de préchauffage).',

  // Tickets · mode automatique : le coût annoncé avant de cocher (ticket-auto-mode.ts).
  'ticketsAuto.cout':
    '{aLancer} run(s) à lancer · {parallele} en parallèle · max {parCycle}/cycle · plafond session {plafond} run(s) payants'
} as const

export const TEXTES_EN: Record<keyof typeof TEXTES_FR, string> = {
  'mascotte.titre': 'Desktop mascot',
  'mascotte.description':
    'The **marble** in the logo’s colours, just above the clock, when Autowin is minimised or behind another window. Its halo tells whether an agent is **working**, whether a thread is **waiting for you** or whether a turn has **failed**; a click opens the thread. On hover, its **handle** (top left) moves it and its **cross** closes it: it then only comes back through this switch. While it is shown, the end-of-turn cards carry a **rainbow edge**. Hidden, it disappears at once and the cards get their usual border back.',
  'mascotte.interrupteur': 'Show the desktop mascot',
  'mascotte.affichee': 'Shown',
  'mascotte.masquee': 'Hidden',
  'mascotte.erreurLecture': 'The mascot setting could not be read.',
  'mascotte.erreurEnregistrement': 'The choice could not be saved: the mascot stays as it was.',

  'reparation.claudeSession.libelle': 'Sign in',
  'reparation.claudeSession.note':
    'A console opens: the CLI is installed if missing, then the Anthropic login happens there. Nothing is typed into Autowin.',
  'reparation.brainVenv.libelle': 'Install',
  'reparation.brainVenv.note':
    'Opens a console on scripts/bootstrap-deps.ps1: it sets up the venv and the Brain tooling (several minutes).',
  'reparation.brain.libelle': 'Start',
  'reparation.brain.note':
    'Tries to start the local brain_server (the port opens after ~30-40 s of warm-up).',

  'ticketsAuto.cout':
    '{aLancer} run(s) to launch · {parallele} in parallel · max {parCycle}/cycle · session cap {plafond} paid run(s)'
}

/** Une clé de cette table, pour les fichiers hors composant qui appellent `traduireReglagesEtDecor`. */
export type CleReglagesEtDecor = keyof typeof TEXTES_FR

/** Clé → raison pour laquelle son anglais reste identique au français. */
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {}

export const { useTextes: useTextesReglagesEtDecor, traduire: traduireReglagesEtDecor } =
  tableDeTextes(TEXTES_FR, TEXTES_EN)
