import { createElement, type ReactNode } from 'react'
import { APP_DESTINATIONS, type AppDestination } from '../../shared/navigation'
import type { Langue } from '../../shared/langue'
import { useLangue } from './langue'

/**
 * LA TABLE DES TEXTES DE L'INTERFACE, en français et en anglais (conv-1146, 2026-10-26).
 *
 * Maison, sans bibliothèque : aucune installation n'est possible pendant que l'app tourne
 * (`scripts/garde-npm-modules.mjs`), et le besoin tient en une table et une fonction.
 *
 * LA TRADUCTION A AVANCÉ PAR LOTS. Lot 1 (conv-1146) : la barre de navigation, Settings (sections,
 * Interface, Providers, Diagnostic et ses trois panneaux) et la zone de saisie du chat — ici. Puis le
 * plan de 19 lots de conv-1170 (2026-10-27) : chaque groupe d'écrans dans sa table
 * (`textes-ecrans/`, 16 tables), les textes du processus principal dans `main/textes-coeur.ts`, les
 * dates et nombres par `formaterDate` / `formaterNombre` (`langue.ts`). Restent en français, à dessein
 * ou faute de lot : les messages renvoyés tels quels par `src/main` et `src/shared` (dont
 * `shared/watchdog-regex.ts` et le moteur du plan de lots), les consignes destinées à l'agent, la
 * voix de Jarvis, et deux formats d'heure écrits en `fr-FR` (`heure-message.ts`,
 * `observatory-timeline-axis.ts`). La phrase `interface.langue.couverture` dit à l'utilisateur ce qui
 * est traduit et NOMME ce qui reste en français (objection du juge, conv-1146, réparation 3) —
 * `textes.test.ts` vérifie qu'elle cite chaque écran de la navigation dans sa partie « traduit ».
 *
 * Le FRANÇAIS fait foi : c'est le texte d'avant ce réglage, mot pour mot, pour que rien ne change à
 * qui ne touche pas à la langue. L'anglais a les MÊMES clés (le type l'impose) ; une entrée anglaise
 * vide retombe sur le français, jamais sur une clé brute ni sur un blanc.
 *
 * Deux conventions dans les textes : `{nom}` est remplacé par une valeur, `**…**` est rendu en gras
 * (`riche`) — ce qui garde les mots en gras de l'écran sans couper les phrases en morceaux.
 *
 * Les autres écrans ont chacun LEUR table, faite par `tableDeTextes` (plus bas) dans
 * `textes-ecrans/` : mêmes règles, fichiers séparés (conv-1170).
 */
export const TEXTES_FR = {
  'rail.deployer': 'Déployer le menu',
  'rail.reduire': 'Réduire le menu',
  'alerte.prerequis': 'Un prérequis est en échec',

  'settings.eyebrow': 'CONFIGURATION',
  'settings.titre': 'Settings',
  'settings.description':
    'Capacités accordées aux agents, comportement, apparence, providers et routage, règles d’Autowin OS et prérequis machine.',
  'settings.nav': 'Sections Settings',
  'settings.section.routing': 'Routage',
  'settings.section.preflight': 'Diagnostic',
  'settings.routing.anomalie': 'Provider(s) à reconnecter : {liste}',
  'settings.providers.eyebrow': 'Fournisseurs',
  'settings.providers.reessayer': 'Réessayer',
  'settings.providers.chargement': 'Chargement des providers…',
  'settings.providers.aucun': "Aucun provider n'est exposé par l'application.",
  'settings.providers.nonExpose': "L'état des providers n'est pas exposé par l'application.",
  'settings.providers.echec': "La lecture de l'état des providers a échoué.",
  'settings.providers.aide.avant':
    'Lecture seule : la configuration (connexion, test, mode) se pilote depuis l’onglet',
  'settings.providers.aide.apres': '.',
  'settings.preflight.erreur': 'Le diagnostic a échoué. Vérifiez la configuration puis réessayez.',
  'settings.preflight.reparationEchec':
    'La réparation a échoué. Suivez la consigne affichée puis réessayez.',
  'settings.preflight.aria': 'Diagnostic de configuration',
  'settings.preflight.eyebrow': 'Configuration locale',
  'settings.preflight.titre': 'Diagnostic de démarrage',
  'settings.preflight.verification': 'Vérification…',
  'settings.preflight.relancer': 'Relancer le diagnostic',
  'settings.preflight.reparee': 'Réparation effectuée pour « {id} » : le diagnostic a été relancé.',
  'settings.preflight.intro': 'Relance le même contrôle que l’onboarding, à tout moment.',
  'settings.preflight.ouvrirDossier': 'Ouvrir le dossier',
  'settings.preflight.reparation': 'Réparation…',
  'settings.preflight.reparer': 'Réparer',
  'diagnostic.actif': 'Actif :',
  'diagnostic.choisi': 'Choisi :',
  'diagnostic.revenirAuto': 'Revenir à la détection automatique',
  'diagnostic.enregistrer': 'Enregistrer',
  'diagnostic.enregistrement': 'Enregistrement…',
  'dossierTravail.titre': 'Dossier de travail',
  'dossierTravail.changer': 'Changer de dossier',
  'dossierTravail.description':
    'Le dépôt sur lequel Autowin travaille, celui que lisent et modifient les agents.',
  'dossierTravail.erreurLecture': 'Impossible de lire le dossier de travail.',
  'dossierTravail.erreurChangement': 'Le changement de dossier a échoué. Réessaie.',
  'dossierTravail.pasGit':
    'Ce dossier n’est pas un dépôt git : les copies de travail isolées sont désactivées.',
  'dossierTravail.redemarrer': 'Redémarre Autowin pour que ce dossier devienne actif.',
  'brain.description':
    'Le dossier où Autowin lit et dépose ce qu’il retient. **Sans dépôt**, c’est un simple dossier (un partage réseau, par exemple) : Autowin n’y lance **aucune commande git**. **Avec un dépôt**, il le clone s’il manque et y commite les notes de ses runs.',
  'brain.erreurLecture': 'Impossible de lire le réglage du Brain.',
  'brain.erreurChangement': 'Le changement du Brain a échoué. Réessaie.',
  'brain.actifDepot': 'dépôt git',
  'brain.actifDossier': 'simple dossier, aucune commande git',
  'brain.dossier': 'Dossier du Brain',
  'brain.dossier.placeholder':
    'vide = détection automatique (ou dossier local d’Autowin pour un dépôt)',
  'brain.choisir': 'Choisir…',
  'brain.depot': 'Dépôt git (facultatif)',
  'brain.depot.placeholder': 'vide = simple dossier · ex. https://github.com/moi/brain.git',
  'brain.redemarrer.avant': 'Redémarre Autowin pour que',
  'brain.redemarrer.apres': 'devienne le Brain actif.',
  'brain.serveur.avant': 'Le serveur Brain déjà lancé sert encore',
  'brain.serveur.apres':
    ': tant qu’il tourne, ce qu’Autowin retient y part. Arrête-le pour qu’il reparte sur le bon dossier.',
  'brainPerso.titre': 'Brain perso',
  'brainPerso.description':
    'Ton Brain **privé**, à côté de celui de l’équipe. Autowin cherche dans **les deux**. Quand il retient un fait, il le range lui-même : ce qui touche un projet ou un outil de l’équipe va au **Brain d’équipe**, le reste au **Brain perso** — et il te dit où. Rien n’y passe du perso vers l’équipe. **Avec un dépôt git**, ton Brain perso te suit d’un poste à l’autre.',
  'brainPerso.aucun': 'Aucun Brain perso : tout ce qu’Autowin retient va au Brain d’équipe.',
  'brainPerso.actif': 'Brain perso :',
  'brainPerso.serveurOk': 'serveur prêt',
  'brainPerso.serveurAttente': 'serveur en démarrage (environ 40 s)',
  'brainPerso.dossier.placeholder':
    'ex. D:\\MonBrain · vide avec un dépôt = dossier local d’Autowin',
  'brainPerso.retirer': 'Retirer le Brain perso',
  'brainPerso.retirer.note':
    'Retirer ne supprime rien : le dossier et ses notes restent sur le disque.',

  'interface.eyebrow': 'Apparence',
  'interface.titre': 'Interface',
  'interface.theme': 'Thème',
  'interface.theme.description':
    'L’apparence de l’application : **{nbThemes} thèmes**, {nbSombres} sombres et {nbClairs} clairs, dont {nbMalvoyant} **Spécial malvoyant** à très fort contraste. **Sombre** reste le réglage par défaut : qui n’y touche pas ne voit rien changer. Le choix est mémorisé sur ce poste et s’applique aussitôt, sans redémarrage.',
  'interface.langue': 'Langue',
  'interface.langue.description':
    'La langue de l’application et des réponses de l’agent. **Français** reste le réglage par défaut. Le choix est mémorisé sur ce poste et s’applique aussitôt, sans redémarrage ; une étape de travail déjà en cours se termine dans l’ancienne langue.',
  'interface.langue.couverture':
    '**Les écrans sont traduits.** La barre de navigation et chaque écran : Accueil, Chat, Agent Studio, Knowledge, Observatory, Task Manager, Worktrees, Bureaux cachés, Tickets, Board, Maintenance et Settings (toutes ses pages, Routage compris) ; la plupart des dates ; les notifications de fin de tour et les contrôles du Diagnostic. **Restent en français :** les messages que le cœur de l’application renvoie tels quels (erreurs, refus, raisons et avertissements du plan de lots, motif invalide d’une règle de réveil) ; ce qui s’adresse à l’agent (demandes des boutons, consignes des skills de Maintenance, descriptions des skills de Settings) ; ce que dit Jarvis ; l’heure des messages du chat et l’axe du temps de l’Observatory ; un message court enregistré, qui garde la langue du moment ; vos propres données (titres, noms de tâches, notes).',
  'interface.langue.echec':
    '**L’agent n’a pas reçu ce choix.** L’écran suit la langue choisie, mais l’agent répond encore dans l’ancienne. Détail :',
  'interface.langue.reessayer': 'Réessayer',
  'interface.zoom':
    '**Pour agrandir tout l’écran** (utile avec les thèmes Spécial malvoyant) : Ctrl + molette, ou Ctrl + « + » / Ctrl + « - ». Ctrl + 0 revient à la taille normale.',
  'interface.reserve':
    '**Ce qui ne suit pas encore.** Le thème choisi s’applique à presque tout l’écran : le menu, les panneaux, les textes, les champs, et les pages **Chat**, **Accueil**, **Observatory** et **Agent Studio**. Quatre endroits gardent leurs couleurs sombres quel que soit le thème, parce qu’ils les peignent en dur : la **toile du graphe Memory** (ses étiquettes et son bandeau d’avertissement), la vue **topologie** des agents, le bandeau **Runtime actuel** au bas de l’Agent Studio, et le **décor animé du fond**. Constaté à l’écran le 7 septembre 2026 sous un thème clair.',

  'chat.cibles': 'Cibles',
  'chat.commandes': 'Commandes',
  'chat.suites': 'Pour continuer…',
  'chat.suites.mieuxNotee': 'Mieux notée : Tab la prend seule.',
  'chat.suites.aide':
    'Maj+Tab prend toutes les suites ; le mode auto les envoie toutes.\nClic : coche ou décoche — les suites cochées partent ensemble.',
  'chat.suites.note': 'note {score} sur 100',
  'chat.placeholder.pendantTour': 'Orienter l’agent sans l’interrompre (Entrée)',
  'chat.placeholder': 'Écrire à l’agent ou déposer des fichiers…',
  'chat.dictee.arreterEtTranscrire': 'Arrêter la dictée et transcrire',
  'chat.dictee.transcription': 'Transcription en cours',
  'chat.dictee.installation': 'Installation de la reconnaissance vocale en cours',
  'chat.dictee.nonInstallee': 'Installer la reconnaissance vocale (Whisper local)',
  'chat.dictee.dicter': 'Dicter au micro',
  'chat.dictee.arreter': 'Arrêter la dictée',
  'chat.dictee.dicterWhisper': 'Dicter au micro (Whisper local)',
  'chat.dictee.niveau': 'Niveau du micro · volume ×{gain}',
  'chat.dictee.volume': 'Volume de capture du micro',
  'chat.dictee.volumeTitre': 'Volume de capture : ×{gain}',
  'chat.envoi.reprendreAria': 'Reprendre la réponse',
  'chat.envoi.orienterAria': 'Orienter l’agent sans l’interrompre',
  'chat.envoi.envoyerAria': 'Envoyer le message',
  'chat.envoi.reprendre': 'Reprendre',
  'chat.envoi.orienter': 'Orienter',
  'chat.envoi.envoyer': 'Envoyer'
} as const

export type CleDeTexte = keyof typeof TEXTES_FR

export const TEXTES_EN: Record<CleDeTexte, string> = {
  'rail.deployer': 'Expand the menu',
  'rail.reduire': 'Collapse the menu',
  'alerte.prerequis': 'A prerequisite is failing',

  'settings.eyebrow': 'CONFIGURATION',
  'settings.titre': 'Settings',
  'settings.description':
    'Capabilities granted to agents, behaviour, appearance, providers and routing, Autowin OS rules and machine prerequisites.',
  'settings.nav': 'Settings sections',
  'settings.section.routing': 'Routing',
  'settings.section.preflight': 'Diagnostics',
  'settings.routing.anomalie': 'Provider(s) to reconnect: {liste}',
  'settings.providers.eyebrow': 'Providers',
  'settings.providers.reessayer': 'Retry',
  'settings.providers.chargement': 'Loading providers…',
  'settings.providers.aucun': 'The application exposes no provider.',
  'settings.providers.nonExpose': 'The application does not expose the providers’ status.',
  'settings.providers.echec': 'Reading the providers’ status failed.',
  'settings.providers.aide.avant':
    'Read-only: the configuration (connection, test, mode) is managed from the',
  'settings.providers.aide.apres': ' tab.',
  'settings.preflight.erreur': 'The diagnostic failed. Check the configuration, then try again.',
  'settings.preflight.reparationEchec':
    'The repair failed. Follow the instruction shown, then try again.',
  'settings.preflight.aria': 'Configuration diagnostic',
  'settings.preflight.eyebrow': 'Local configuration',
  'settings.preflight.titre': 'Startup diagnostic',
  'settings.preflight.verification': 'Checking…',
  'settings.preflight.relancer': 'Run the diagnostic again',
  'settings.preflight.reparee': 'Repair done for “{id}”: the diagnostic was run again.',
  'settings.preflight.intro': 'Runs the same check as onboarding, at any time.',
  'settings.preflight.ouvrirDossier': 'Open folder',
  'settings.preflight.reparation': 'Repairing…',
  'settings.preflight.reparer': 'Repair',
  'diagnostic.actif': 'Active:',
  'diagnostic.choisi': 'Chosen:',
  'diagnostic.revenirAuto': 'Back to automatic detection',
  'diagnostic.enregistrer': 'Save',
  'diagnostic.enregistrement': 'Saving…',
  'dossierTravail.titre': 'Working folder',
  'dossierTravail.changer': 'Change folder',
  'dossierTravail.description':
    'The repository Autowin works on, the one the agents read and modify.',
  'dossierTravail.erreurLecture': 'Could not read the working folder.',
  'dossierTravail.erreurChangement': 'Changing the folder failed. Try again.',
  'dossierTravail.pasGit':
    'This folder is not a git repository: isolated working copies are turned off.',
  'dossierTravail.redemarrer': 'Restart Autowin for this folder to become active.',
  'brain.description':
    'The folder where Autowin reads and stores what it remembers. **Without a repository**, it is a plain folder (a network share, for example): Autowin runs **no git command** there. **With a repository**, it clones it if missing and commits its runs’ notes to it.',
  'brain.erreurLecture': 'Could not read the Brain setting.',
  'brain.erreurChangement': 'Changing the Brain failed. Try again.',
  'brain.actifDepot': 'git repository',
  'brain.actifDossier': 'plain folder, no git command',
  'brain.dossier': 'Brain folder',
  'brain.dossier.placeholder':
    'empty = automatic detection (or Autowin’s local folder for a repository)',
  'brain.choisir': 'Choose…',
  'brain.depot': 'Git repository (optional)',
  'brain.depot.placeholder': 'empty = plain folder · e.g. https://github.com/me/brain.git',
  'brain.redemarrer.avant': 'Restart Autowin for',
  'brain.redemarrer.apres': 'to become the active Brain.',
  'brain.serveur.avant': 'The Brain server already running still serves',
  'brain.serveur.apres':
    ': while it runs, what Autowin remembers goes there. Stop it so that it restarts on the right folder.',
  'brainPerso.titre': 'Personal Brain',
  'brainPerso.description':
    'Your **private** Brain, next to the team one. Autowin searches **both**. When it remembers a fact, it files it itself: anything about a team project or tool goes to the **team Brain**, the rest to your **personal Brain** — and it tells you where. Nothing flows from personal to team. **With a git repository**, your personal Brain follows you from one machine to another.',
  'brainPerso.aucun': 'No personal Brain: everything Autowin remembers goes to the team Brain.',
  'brainPerso.actif': 'Personal Brain:',
  'brainPerso.serveurOk': 'server ready',
  'brainPerso.serveurAttente': 'server starting (about 40 s)',
  'brainPerso.dossier.placeholder':
    'e.g. D:\\MyBrain · empty with a repository = Autowin’s local folder',
  'brainPerso.retirer': 'Remove the personal Brain',
  'brainPerso.retirer.note': 'Removing deletes nothing: the folder and its notes stay on disk.',

  'interface.eyebrow': 'Appearance',
  'interface.titre': 'Interface',
  'interface.theme': 'Theme',
  'interface.theme.description':
    'The look of the application: **{nbThemes} themes**, {nbSombres} dark and {nbClairs} light, including {nbMalvoyant} **Low vision** themes with very high contrast. **Dark** remains the default setting: if you leave it alone, nothing changes. The choice is saved on this computer and applies immediately, without restarting.',
  'interface.langue': 'Language',
  'interface.langue.description':
    'The language of the application and of the agent’s replies. **Français** remains the default setting. The choice is saved on this computer and applies immediately, without restarting; a work step already running finishes in the previous language.',
  'interface.langue.couverture':
    '**The screens are translated.** The navigation bar and every screen: Home, Chat, Agent Studio, Knowledge, Observatory, Task Manager, Worktrees, Hidden desktops, Tickets, Board, Maintenance and Settings (all its pages, Routing included); most dates; end-of-turn notifications and the Diagnostics checks. **Still in French:** messages the application core passes on as they are (errors, refusals, the lot plan’s reasons and warnings, an invalid wake-up rule pattern); what is addressed to the agent (requests sent by buttons, the Maintenance skills’ instructions, the skill descriptions in Settings); what Jarvis says; the time of chat messages and the Observatory’s time axis; a short message recorded earlier, which keeps the language of that moment; your own data (titles, task names, notes).',
  'interface.langue.echec':
    '**The agent did not receive this choice.** The screen follows the chosen language, but the agent still answers in the previous one. Details:',
  'interface.langue.reessayer': 'Retry',
  'interface.zoom':
    '**To enlarge the whole screen** (useful with the Low vision themes): Ctrl + mouse wheel, or Ctrl + “+” / Ctrl + “-”. Ctrl + 0 returns to the normal size.',
  'interface.reserve':
    '**What does not follow yet.** The chosen theme applies to almost the whole screen: the menu, the panels, the texts, the fields, and the **Chat**, **Home**, **Observatory** and **Agent Studio** pages. Four places keep their dark colours whatever the theme, because they paint them in hard-coded values: the **Memory graph canvas** (its labels and its warning banner), the agents’ **topology** view, the **Current runtime** banner at the bottom of the Agent Studio, and the **animated background**. Observed on screen on 7 September 2026 under a light theme.',

  'chat.cibles': 'Targets',
  'chat.commandes': 'Commands',
  'chat.suites': 'To continue…',
  'chat.suites.mieuxNotee': 'Best rated: Tab takes it alone.',
  'chat.suites.aide':
    'Shift+Tab takes all the suggestions; auto mode sends them all.\nClick: check or uncheck — checked suggestions are sent together.',
  'chat.suites.note': 'score {score} out of 100',
  'chat.placeholder.pendantTour': 'Steer the agent without interrupting it (Enter)',
  'chat.placeholder': 'Write to the agent or drop files…',
  'chat.dictee.arreterEtTranscrire': 'Stop dictation and transcribe',
  'chat.dictee.transcription': 'Transcribing',
  'chat.dictee.installation': 'Installing speech recognition',
  'chat.dictee.nonInstallee': 'Install speech recognition (local Whisper)',
  'chat.dictee.dicter': 'Dictate with the microphone',
  'chat.dictee.arreter': 'Stop dictation',
  'chat.dictee.dicterWhisper': 'Dictate with the microphone (local Whisper)',
  'chat.dictee.niveau': 'Microphone level · volume ×{gain}',
  'chat.dictee.volume': 'Microphone capture volume',
  'chat.dictee.volumeTitre': 'Capture volume: ×{gain}',
  'chat.envoi.reprendreAria': 'Resume the reply',
  'chat.envoi.orienterAria': 'Steer the agent without interrupting it',
  'chat.envoi.envoyerAria': 'Send the message',
  'chat.envoi.reprendre': 'Resume',
  'chat.envoi.orienter': 'Steer',
  'chat.envoi.envoyer': 'Send'
}

/**
 * Les noms des écrans de la barre de navigation, en anglais. En français, le nom vient de
 * `APP_DESTINATIONS` (`shared/navigation.ts`), seule source : il n'est pas recopié ici.
 * `Record<AppDestination, …>` : un écran ajouté sans nom anglais ne compile pas.
 */
export const DESTINATIONS_EN: Record<AppDestination, string> = {
  accueil: 'Home',
  chat: 'Chat',
  'agent-studio': 'Agent Studio',
  knowledge: 'Knowledge',
  observatory: 'Observatory',
  'task-manager': 'Task Manager',
  worktree: 'Worktrees',
  hdesk: 'Hidden desktops',
  tickets: 'Tickets',
  besoins: 'Board',
  tests: 'Maintenance',
  settings: 'Settings'
}

/**
 * Les noms des thèmes en anglais. En français, le nom vient du registre (`theme-mode.ts`) ; un thème
 * sans nom anglais ici garde son nom français, il ne disparaît pas de la liste.
 */
export const THEMES_EN: Readonly<Record<string, string>> = {
  sombre: 'Dark',
  clair: 'Light',
  'nebuleuse-verre': 'Holographic',
  'holographique-clair': 'Holographic white',
  'machine-a-ecrire': 'Typewriter',
  'ninja-claude': 'Ninja Claude',
  'vanilla-claude': 'Vanilla Claude',
  'nier-automata': 'NieR:Automata',
  'malvoyant-sombre': 'Low vision — dark',
  'malvoyant-clair': 'Low vision — light'
}

export type ValeursDeTexte = Readonly<Record<string, string | number>>

interface Tables {
  readonly fr: Readonly<Record<string, string>>
  readonly en: Readonly<Record<string, string | undefined>>
}

/**
 * LA RÈGLE, en un seul endroit, pour la table principale comme pour celles des écrans : anglais
 * absent ou vide → le français ; `{nom}` remplacé par sa valeur, une valeur oubliée reste visible.
 */
function texteDans(
  tables: Tables,
  cle: string,
  langue: Langue,
  valeurs: ValeursDeTexte | undefined
): string {
  const anglais = langue === 'en' ? tables.en[cle] : undefined
  const texte = typeof anglais === 'string' && anglais.trim() !== '' ? anglais : tables.fr[cle]
  if (!valeurs) return texte
  return texte.replace(/\{(\w+)\}/g, (tout, nom: string) =>
    nom in valeurs ? String(valeurs[nom]) : tout
  )
}

/** Ce que rend `tableDeTextes` : la même paire `traduire` / `useTextes` que la table principale. */
export interface TableDeTextes<Cle extends string> {
  readonly traduire: (cle: Cle, langue: Langue, valeurs?: ValeursDeTexte) => string
  readonly useTextes: () => {
    langue: Langue
    t: (cle: Cle, valeurs?: ValeursDeTexte) => string
  }
}

/**
 * UNE TABLE DE TEXTES PAR GROUPE D'ÉCRANS (traduction complète, conv-1170, 2026-10-27). Une seule
 * table pour toute l'app ferait écrire tous les lots de traduction dans le MÊME fichier en même temps ;
 * chaque groupe d'écrans a donc la sienne (`textes-ecrans/`), avec exactement les règles de la table
 * principale (`texteDans`, `riche` inchangé).
 *
 * `fr` : un objet `as const`, le français mot pour mot. `en` : les MÊMES clés — une clé manquante
 * viole la contrainte de `En`, une clé en trop se heurte au `never` de l'intersection ; les deux
 * cas ne compilent pas, même quand `en` est passé par une variable (pas seulement en littéral).
 */
export function tableDeTextes<
  Fr extends Readonly<Record<string, string>>,
  En extends Readonly<Record<keyof Fr, string>>
>(
  fr: Fr,
  en: En & Readonly<Record<Exclude<keyof En, keyof Fr>, never>>
): TableDeTextes<Extract<keyof Fr, string>> {
  const tables: Tables = { fr, en }
  const traduireIci = (
    cle: Extract<keyof Fr, string>,
    langue: Langue,
    valeurs?: ValeursDeTexte
  ): string => texteDans(tables, cle, langue, valeurs)
  function useTextesIci(): {
    langue: Langue
    t: (cle: Extract<keyof Fr, string>, valeurs?: ValeursDeTexte) => string
  } {
    const langue = useLangue()
    return { langue, t: (cle, valeurs) => traduireIci(cle, langue, valeurs) }
  }
  return { traduire: traduireIci, useTextes: useTextesIci }
}

const TABLE_PRINCIPALE = tableDeTextes(TEXTES_FR, TEXTES_EN)

/**
 * Le texte d'une clé dans une langue. Anglais absent ou vide : le français. `tables` est injectable
 * pour que le test prouve ce repli sur une table anglaise INCOMPLÈTE, que le type interdit ici.
 */
export function traduire(
  cle: CleDeTexte,
  langue: Langue,
  valeurs?: ValeursDeTexte,
  tables?: Tables
): string {
  return tables
    ? texteDans(tables, cle, langue, valeurs)
    : TABLE_PRINCIPALE.traduire(cle, langue, valeurs)
}

/**
 * Le même texte, avec ses passages `**…**` rendus en gras. `balise` : `b` pour un écran qui marquait
 * déjà son gras en `<b>` (BrainSettings), afin que le français reste identique balise pour balise.
 */
export function riche(texte: string, balise: 'strong' | 'b' = 'strong'): ReactNode[] {
  return texte
    .split('**')
    .map((morceau, rang) =>
      rang % 2 === 1 ? createElement(balise, { key: rang }, morceau) : morceau
    )
    .filter((morceau) => morceau !== '')
}

export function nomDeDestination(id: AppDestination, langue: Langue): string {
  if (langue === 'en') return DESTINATIONS_EN[id]
  return APP_DESTINATIONS.find((d) => d.id === id)?.label ?? id
}

export function nomDeTheme(id: string, libelleFrancais: string, langue: Langue): string {
  return langue === 'en' ? (THEMES_EN[id] ?? libelleFrancais) : libelleFrancais
}

/** Pour un composant : la langue courante et `t`, qui suivent le réglage sans redémarrage. */
export function useTextes(): {
  langue: Langue
  t: (cle: CleDeTexte, valeurs?: ValeursDeTexte) => string
} {
  return TABLE_PRINCIPALE.useTextes()
}
