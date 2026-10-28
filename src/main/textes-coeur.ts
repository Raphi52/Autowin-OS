import type { Langue } from '../shared/langue'
import { lireLangueReglee } from './langue-reglage'

/**
 * LES TEXTES QUE LE PROCESSUS PRINCIPAL MET À L'ÉCRAN, en français et en anglais (conv-1170, lot 18,
 * 2026-10-27, d'après la table de l'interface de conv-1146).
 *
 * Pourquoi une table à part : celle de l'interface (`renderer/src/textes.ts`) importe React, que le
 * processus principal ne charge pas. Ici vivent les notifications de fin de tour (bulle Windows et
 * carte), les contrôles du Diagnostic (noms, résultats, consignes de réparation) et la bulle
 * d'abandon d'un travail (`os.ts`).
 *
 * Mêmes règles que l'écran : le FRANÇAIS fait foi (le texte d'avant ce réglage, mot pour mot — y
 * compris les phrases sans accents de `preflight.ts` et `os.ts`), l'anglais a les MÊMES clés (le type
 * l'impose), une entrée anglaise vide retombe sur le français, `{nom}` est remplacé par une valeur.
 *
 * Ce qui n'est PAS ici, et reste en français : les identifiants (id d'un contrôle, issue `prete` /
 * `echec`), les messages de journal, et les libellés des plans de réparation (`preflight-repair.ts`),
 * copie verrouillée par test de celle que l'écran affiche lui-même.
 */
export const TEXTES_COEUR_FR = {
  // Fin de tour — bulle Windows (`notification-fin-de-tour.ts`).
  'finDeTour.corpsParDefaut': 'Le tour est terminé.',
  'finDeTour.titreEchec': '{fil} — le tour a échoué',
  'finDeTour.corpsEchec': 'Le tour s’est arrêté sur une erreur.',
  'finDeTour.titrePret': '{fil} — réponse prête',
  // Fin de tour — carte en bas à droite (`notification-popup.ts`, `notification-popup-fenetre.ts`).
  'carte.etatEchec': 'Le tour a échoué',
  'carte.etatPret': 'Réponse prête',
  'carte.ouvrirFil': 'Ouvrir le fil',
  'carte.fermer': 'Fermer',
  'carte.titreFenetre': 'Autowin — fin de tour',
  // Clic droit sur la mascotte du bureau (`mascotte-menu.ts`, conv-1196).
  'mascotte.menu.aucunFil': 'Aucun fil ne t’attend',
  'mascotte.menu.ouvrirAutowin': 'Ouvrir Autowin',
  // Diagnostic de démarrage (`preflight.ts`).
  'diagnostic.standby': 'standby — diagnostic ignoré',
  'diagnostic.brain.injoignable': 'injoignable — RAG désactivé',
  'diagnostic.brainVenv.label': 'runtime Brain (Python)',
  'diagnostic.brainVenv.absent': 'non installé sur cette machine — venv + tooling à poser une fois',
  'diagnostic.brainToken.label': 'token Brain',
  'diagnostic.brainToken.absent': 'absent — définir AUTOWIN_BRAIN_TOKEN',
  'diagnostic.claude.label': 'CLI claude',
  'diagnostic.claude.absent': 'introuvable — installer claude',
  'diagnostic.claudeSession.label': 'Session claude',
  'diagnostic.claudeSession.cliAbsent': 'CLI absent — voir « {cli} » ci-dessus',
  'diagnostic.claudeSession.absente': 'session absente — claude auth login',
  'diagnostic.claudeSession.indeterminee':
    'état de session indéterminé — le CLI claude n’a pas répondu (session ou installation)',
  'diagnostic.historique.label': 'Historique des conversations',
  'diagnostic.historique.ecarte':
    "illisible au demarrage — mis de cote, RIEN n'a ete supprime. Fichier(s) conserve(s) : {fichiers}",
  'diagnostic.resume.incomplet':
    'Configuration incomplète : {liste}. Certaines fonctions seront dégradées.',
  'diagnostic.resume.ok': 'Tous les prérequis sont OK.',
  // Diagnostic — le Brain après son délai de grâce (`preflight-announce.ts`).
  'diagnostic.brain.injoignableApres': 'injoignable après {secondes} s — {detail}',
  'diagnostic.brain.lent':
    'démarré mais toujours pas prêt après {secondes} s — warm-up anormalement long, RAG désactivé',
  'diagnostic.brain.nonDemarre':
    'injoignable après {secondes} s — service local non démarré, RAG désactivé',
  // Diagnostic — résultat d'un bouton « Réparer » (`preflight-repair.ts`).
  'reparation.aucune': 'Aucune réparation automatique connue pour ce prérequis.',
  'reparation.binaireIntrouvable':
    'Binaire claude introuvable ({bin}) : corrige CLAUDE_BIN ou réinstalle le CLI.',
  'reparation.loginSansConsole': 'Le login claude ne passe pas par une console.',
  'reparation.installEtLogin':
    'Console ouverte : installation du CLI claude, puis login enchaîné. Termine, puis re-vérifie.',
  'reparation.login': 'Console de connexion ouverte. Termine le login, puis re-vérifie.',
  'reparation.repoIntrouvable':
    'Repo Autowin OS introuvable depuis l’app : lance « powershell -File scripts/bootstrap-deps.ps1 » dans le dossier du repo.',
  'reparation.installation':
    'Console d’installation ouverte (plusieurs minutes). Elle affiche ce qui manque encore, puis re-vérifie.',
  'reparation.impossible': 'Réparation impossible : {erreur}',
  // Bulle Windows d'un travail abandonné (`os.ts`, `onAbandon`).
  'abandon.titre': 'Autowin — un travail a ete abandonne',
  'abandon.corps':
    "« {tache} » n'a pas pu etre integre. Son travail reste sur sa branche de secours.",
  'abandon.corpsRun': "{run} n'a pas pu etre integre. Son travail reste sur sa branche de secours."
} as const

export type CleCoeur = keyof typeof TEXTES_COEUR_FR

export const TEXTES_COEUR_EN: Record<CleCoeur, string> = {
  'finDeTour.corpsParDefaut': 'The turn is finished.',
  'finDeTour.titreEchec': '{fil} — the turn failed',
  'finDeTour.corpsEchec': 'The turn stopped on an error.',
  'finDeTour.titrePret': '{fil} — answer ready',
  'carte.etatEchec': 'The turn failed',
  'carte.etatPret': 'Answer ready',
  'carte.ouvrirFil': 'Open the thread',
  'carte.fermer': 'Close',
  'carte.titreFenetre': 'Autowin — end of turn',
  'mascotte.menu.aucunFil': 'No thread is waiting for you',
  'mascotte.menu.ouvrirAutowin': 'Open Autowin',
  'diagnostic.standby': 'standby — diagnostics skipped',
  'diagnostic.brain.injoignable': 'unreachable — RAG disabled',
  'diagnostic.brainVenv.label': 'Brain runtime (Python)',
  'diagnostic.brainVenv.absent': 'not installed on this machine — venv + tooling to set up once',
  'diagnostic.brainToken.label': 'Brain token',
  'diagnostic.brainToken.absent': 'missing — set AUTOWIN_BRAIN_TOKEN',
  'diagnostic.claude.label': 'claude CLI',
  'diagnostic.claude.absent': 'not found — install claude',
  'diagnostic.claudeSession.label': 'claude session',
  'diagnostic.claudeSession.cliAbsent': 'CLI missing — see “{cli}” above',
  'diagnostic.claudeSession.absente': 'no session — claude auth login',
  'diagnostic.claudeSession.indeterminee':
    'session state unknown — the claude CLI did not answer (session or installation)',
  'diagnostic.historique.label': 'Conversation history',
  'diagnostic.historique.ecarte':
    'unreadable at startup — set aside, NOTHING was deleted. File(s) kept: {fichiers}',
  'diagnostic.resume.incomplet':
    'Incomplete configuration: {liste}. Some features will be degraded.',
  'diagnostic.resume.ok': 'All prerequisites are OK.',
  'diagnostic.brain.injoignableApres': 'unreachable after {secondes} s — {detail}',
  'diagnostic.brain.lent':
    'started but still not ready after {secondes} s — abnormally long warm-up, RAG disabled',
  'diagnostic.brain.nonDemarre':
    'unreachable after {secondes} s — local service not started, RAG disabled',
  'reparation.aucune': 'No known automatic repair for this prerequisite.',
  'reparation.binaireIntrouvable':
    'claude binary not found ({bin}): fix CLAUDE_BIN or reinstall the CLI.',
  'reparation.loginSansConsole': 'The claude login does not go through a console.',
  'reparation.installEtLogin':
    'Console opened: the claude CLI is being installed, then the login follows. Finish, then re-check.',
  'reparation.login': 'Sign-in console opened. Finish the login, then re-check.',
  'reparation.repoIntrouvable':
    'Autowin OS repo not found from the app: run “powershell -File scripts/bootstrap-deps.ps1” in the repo folder.',
  'reparation.installation':
    'Installation console opened (several minutes). It shows what is still missing; then re-check.',
  'reparation.impossible': 'Repair failed: {erreur}',
  'abandon.titre': 'Autowin — a job was abandoned',
  'abandon.corps': '“{tache}” could not be integrated. Its work stays on its backup branch.',
  'abandon.corpsRun': '{run} could not be integrated. Its work stays on its backup branch.'
}

export type ValeursCoeur = Readonly<Record<string, string | number>>

interface TablesCoeur {
  readonly fr: Readonly<Record<string, string>>
  readonly en: Readonly<Record<string, string | undefined>>
}

const TABLES: TablesCoeur = { fr: TEXTES_COEUR_FR, en: TEXTES_COEUR_EN }

/**
 * La langue réglée, relue sur le disque à CHAQUE appel : le réglage change sans redémarrage, et la
 * carte suivante ou le diagnostic suivant doit déjà suivre (un fichier de quelques octets).
 */
export function langueCoeur(): Langue {
  return lireLangueReglee()
}

/**
 * Le texte d'une clé dans la langue réglée. Anglais absent ou vide : le français. `tables` est
 * injectable pour que le test prouve ce repli sur une table anglaise INCOMPLÈTE, que le type interdit.
 * Une valeur oubliée laisse son `{nom}` visible plutôt qu'un blanc ; une valeur qui contient elle-même
 * `{x}` n'est pas relue (un seul passage).
 */
export function traduireCoeur(
  cle: CleCoeur,
  valeurs?: ValeursCoeur,
  tables: TablesCoeur = TABLES
): string {
  const anglais = langueCoeur() === 'en' ? tables.en[cle] : undefined
  const texte = typeof anglais === 'string' && anglais.trim() !== '' ? anglais : tables.fr[cle]
  if (!valeurs) return texte
  return texte.replace(/\{(\w+)\}/g, (tout, nom: string) =>
    nom in valeurs ? String(valeurs[nom]) : tout
  )
}
