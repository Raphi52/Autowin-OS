import { tableDeTextes } from '../textes'

/**
 * TEXTES — NOMS DES THÈMES, MASCOTTE, DÉCORS DE L’ACCUEIL ET DERNIERS FICHIERS (traduction anglaise, 2026-10-27).
 *
 * Écrans couverts : theme-mode, MascotteReglage, NomSurLeBoardReglage, les décors animés de l’accueil (`home-decor-*`), la réparation du
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
  // Le choix « Magicien / Basique ».
  'mascotte.style.titre': 'Style de la mascotte',
  'mascotte.style.description':
    'Le **magicien** porte un chapeau où brille le nombre, et lance des sorts quand un agent travaille. La **bille basique** reste une bille seule, le nombre au milieu. La **machine** de NieR somnole au repos, visse au travail, salue quand c’est fini et fume en cas d’erreur ; c’est elle que montre le thème NieR. Le **panda boss** somnole au repos ; au travail il tient son médaillon d’or, qui compte les agents ; il te fait coucou des deux pattes sous une pluie de paillettes quand c’est fini, et se cache les yeux en cas d’erreur. Ses lunettes-écran disent l’état, et chaque changement le fait réagir (soupir, saut de joie, sursaut). Le changement est immédiat ; la mascotte garde sa place.',
  'mascotte.style.magicien': 'Magicien',
  'mascotte.style.basique': 'Basique',
  'mascotte.style.machine': 'Machine (NieR)',
  'mascotte.style.panda': 'Panda boss',

  // Settings · Interface — « Ton nom sur le Board » (NomSurLeBoardReglage.tsx).
  'nomBoard.titre': 'Ton nom sur le Board',
  'nomBoard.description':
    'Le nom écrit sur **tes post-it**, dans ton Board et dans celui des **collègues** qui partagent le même dossier. Par défaut, ton **compte Windows** ({compte}).',
  'nomBoard.libelle': 'Nom affiché',
  'nomBoard.enregistrer': 'Enregistrer',
  'nomBoard.parDefaut': 'Revenir au compte Windows',
  'nomBoard.erreurLecture': 'Le nom du Board n’a pas pu être lu.',
  'nomBoard.erreurEnregistrement': 'Le nom n’a pas pu être enregistré : il reste comme avant.',
  // Settings · Interface — partage de la présence dans le village commun (D6).
  'presence.titre': 'Tes agents dans le village de l’équipe',
  'presence.description':
    'Tes **tanukis** apparaissent dans l’Accueil des **collègues** qui partagent le même dossier du Board. Seul le **titre du fil** part, sans chemin, adresse, long numéro ni identifiant ; un fil **privé** part sans titre. Coupé, **plus rien** n’est partagé.',
  'presence.interrupteur': 'Partager mes agents avec l’équipe',
  'presence.partage': 'Partagés',
  'presence.coupe': 'Coupés',
  'presence.erreurEnregistrement':
    'Le choix n’a pas pu être enregistré : le partage reste comme avant.',

  // Boutons « réparer » du diagnostic (preflight-repair-affordance.ts). Le français est AUSSI celui
  // du plan du moteur (`src/main/preflight/preflight-repair.ts`), que le test de contrat compare.
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
  'mascotte.style.titre': 'Mascot style',
  'mascotte.style.description':
    'The **wizard** wears a hat where the number shines, and casts spells while an agent is working. The **basic marble** stays a plain marble, with the number in the middle. The NieR **machine** dozes at rest, tightens bolts while working, waves when done and smokes on errors; the NieR theme shows it. The **boss panda** dozes at rest; while working he holds his gold medallion, which counts the agents; he waves with both paws under falling glitter when done, and covers his eyes on errors. His screen glasses show the state, and every change makes him react (a sigh, a jump of joy, a start). The change is immediate; the mascot keeps its place.',
  'mascotte.style.magicien': 'Wizard',
  'mascotte.style.basique': 'Basic',
  'mascotte.style.machine': 'Machine (NieR)',
  'mascotte.style.panda': 'Boss panda',

  'nomBoard.titre': 'Your name on the Board',
  'nomBoard.description':
    'The name written on **your sticky notes**, in your Board and in the Board of **colleagues** who share the same folder. By default, your **Windows account** ({compte}).',
  'nomBoard.libelle': 'Displayed name',
  'nomBoard.enregistrer': 'Save',
  'nomBoard.parDefaut': 'Back to the Windows account',
  'nomBoard.erreurLecture': 'The Board name could not be read.',
  'nomBoard.erreurEnregistrement': 'The name could not be saved: it stays as it was.',
  'presence.titre': 'Your agents in the team village',
  'presence.description':
    'Your **tanukis** appear on the Home screen of **colleagues** who share the same Board folder. Only the **thread title** is sent, without paths, addresses, long numbers or identifiers; a **private** thread is sent without a title. Turned off, **nothing** is shared anymore.',
  'presence.interrupteur': 'Share my agents with the team',
  'presence.partage': 'Shared',
  'presence.coupe': 'Off',
  'presence.erreurEnregistrement': 'The choice could not be saved: sharing stays as it was.',

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
export const IDENTIQUES_AU_FRANCAIS: Readonly<Partial<Record<keyof typeof TEXTES_FR, string>>> = {
  'mascotte.style.machine': 'même mot en anglais, suivi du nom propre du jeu'
}

export const { useTextes: useTextesReglagesEtDecor, traduire: traduireReglagesEtDecor } =
  tableDeTextes(TEXTES_FR, TEXTES_EN)
