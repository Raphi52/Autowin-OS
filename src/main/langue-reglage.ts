import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { autowinAppDataRoot } from './app-data'
import { LANGUE_PAR_DEFAUT, estLangue, langueOuDefaut, type Langue } from '../shared/langue'

/**
 * LA LANGUE CHOISIE DANS SETTINGS · INTERFACE, CÔTÉ MOTEUR (conv-1146, 2026-10-26).
 *
 * L'interface garde la sienne dans son stockage local (`renderer/src/langue.ts`) : elle doit la
 * connaître AVANT son premier rendu. Le moteur, lui, ne voit pas ce stockage ; or c'est lui qui écrit
 * la consigne de chaque tour, et l'agent doit répondre dans la langue choisie. L'interface lui
 * transmet donc son choix (canal `app:langue:ecrire`), et il le garde ici, pour qu'un run repris au
 * démarrage, avant que la fenêtre ne soit chargée, parte déjà dans la bonne langue.
 *
 * Rangé sous la racine de données de l'INSTANCE (`autowinAppDataRoot()`), pas sous `%APPDATA%` comme
 * la mascotte : une instance cachée de capture qui passe en anglais pour une preuve ne doit pas faire
 * répondre en anglais l'app que l'utilisateur regarde.
 */
export const FICHIER_LANGUE = 'langue.json'

export interface LangueDeps {
  /** Racine des données de l'app ; défaut `autowinAppDataRoot()`. Injectable pour les tests. */
  racine?: string
}

export function langueReglageFile(deps: LangueDeps = {}): string {
  return join(deps.racine ?? autowinAppDataRoot(), FICHIER_LANGUE)
}

/** La langue enregistrée. Fichier absent, illisible ou abîmé, valeur inconnue : français. */
export function lireLangueReglee(deps: LangueDeps = {}): Langue {
  try {
    const brut = JSON.parse(readFileSync(langueReglageFile(deps), 'utf8')) as {
      langue?: unknown
    } | null
    return langueOuDefaut(brut?.langue)
  } catch {
    return LANGUE_PAR_DEFAUT
  }
}

/**
 * Enregistre la langue. Une valeur hors de la liste est REFUSÉE (erreur), pas ramenée au français :
 * une donnée abîmée venue de l'interface ne doit pas écraser un choix valable. Rend `true` seulement
 * si le fichier a changé : redire la même langue n'écrit rien.
 */
export function ecrireLangueReglee(valeur: unknown, deps: LangueDeps = {}): boolean {
  if (!estLangue(valeur)) throw new Error('Langue invalide (attendu : fr ou en).')
  const fichier = langueReglageFile(deps)
  if (existsSync(fichier) && lireLangueReglee(deps) === valeur) return false
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(fichier, `${JSON.stringify({ langue: valeur }, null, 2)}\n`, 'utf8')
  return true
}

/**
 * LES REPÈRES QUE L'APP LIT DANS LES RÉPONSES, gardés en français mot pour mot. Une consigne
 * « réponds en anglais » sans exception casserait leur lecture : `shared/bilan-d-etape.ts` cherche
 * « Bilan de l’étape », l'orchestrateur lit `SUITE:` et les lignes `AUTOWIN_…`, le chat exécute les
 * blocs `<cmd>`. Exportés pour que le test vérifie qu'ils restent nommés dans la consigne.
 * Le juge et le cadrage reçoivent la même consigne : leurs repères aussi (objection du juge,
 * conv-1146 réparation 2) — `VALIDE`/`DEFAUT:` (`orchestrator.ts`, verdict), `OBJECTIONS:`,
 * `MAJEUR:`/`MINEUR:`/`OK:`, `aucune`, `QUESTIONS AU BUILD:` (`objections-juge.ts`), `## Confiance`
 * et ses `VÉRIFIÉ`/`NON VÉRIFIÉ` (`cadrage-confiance.ts`), la rubrique des cas limites
 * (`frame-cas-limites.ts`). Un juge qui écrirait « VALID » serait lu comme un refus.
 * La phrase générale ne garde que ce qu'elle NOMME (objection du juge, réparation 3) : aussi les
 * rubriques de fin du chat (`agent-pilot.ts`, lues par `orchestration-outcome.ts`,
 * `markdown-cloture.ts`, `chat-auto-mode.ts` — où « rien » seul éteint le mode auto), la ligne de
 * grille du ménage (`grille-clean.ts` : « remaining » ne bloquerait plus un défaut resté ouvert) et
 * les six titres du briefing `think` (`think-briefing.ts`).
 * Réparation 4 : le juge en a encore trouvé (cible du scout, blocage, `SUITE: fin`, leçon refusée).
 * Pour cesser de les découvrir un par un, la liste vient désormais d'un BALAYAGE : chaque expression
 * régulière à mot français de `src/main`, `src/shared` et `src/renderer/src` (hors tests, 264 le
 * 2026-10-26), gardée quand elle lit une réponse d'agent ET qu'une consigne impose le mot. Ajoutés :
 * `## Cible`/`CIBLE:`/`CIBLES:` (`scout-cible.ts`), `⛔ Bloqué`/`⚠️ Non résolu` (`carte-du-fil.ts`,
 * `agent-pilot.ts`), `SUITE: fin` (`workflow-walk.ts`), `OK: leçon refusée` (`objections-juge.ts`),
 * `DE L'UTILISATEUR`/`Hypothèse :` (`cadrage-confiance.ts`), `Cas limites : sans objet`
 * (`frame-cas-limites.ts`), les quatre rubriques d'une leçon d'échec (`brain-remember.ts`), « aucune
 * suite » (`carte-du-fil.ts`, `chat-auto-mode.ts`), « aucun reste » (`message-du-run.ts`) et les
 * valeurs `nouveau`/`suite`/`aucun` de la ligne de besoin (`shared/ligne-besoin.ts`).
 * LIMITE CONNUE, hors de cette liste : des gardes qui reconnaissent une PHRASE française dans la
 * prose libre (annonce sans action et promesse, `chat-turn-messages.ts` ; accès prétendu absent,
 * `shared/outil-pretendu-absent.ts` ; « vérifié dans », `scout-plafond.ts` ; ligne « Leçon : »,
 * `lecon-non-retenue.ts` ; « corrigé en partie » / « objection précédente » dans le texte du juge,
 * `renderer/src/components/juges-bloc.ts`, affichage seulement) ne voient pas la même phrase écrite
 * en anglais. Aucun mot gardé n'y peut rien : il faudrait leur apprendre l'anglais.
 */
export const REPERES_GARDES_EN_FRANCAIS = [
  '### Bilan de l’étape',
  '- Verdict :',
  '- Fichiers touchés :',
  '- Preuves :',
  '- Reste à faire :',
  '- Question :',
  '## Besoin',
  '## Contraintes',
  '## Options',
  '## Confiance',
  'VÉRIFIÉ',
  'NON VÉRIFIÉ',
  '### Cas limites d’entrée',
  'VALIDE',
  'DEFAUT:',
  'SCORE:',
  'OBJECTIONS:',
  'MAJEUR:',
  'MINEUR:',
  'OK:',
  'aucune',
  'QUESTIONS AU BUILD:',
  '✅ Fait',
  '📍 Maintenant',
  '⏳ Reste à faire',
  '👉 Recommandé',
  'rien',
  'Grille :',
  '❌ restants',
  '## Localisation',
  '## Cartographie',
  '## Décisions',
  '## Constats',
  '## Trous',
  '## Cible',
  'CIBLE:',
  'CIBLES:',
  '⛔ Bloqué',
  '⚠️ Non résolu',
  'OK: leçon refusée',
  "DE L'UTILISATEUR",
  'Hypothèse :',
  'Cas limites : sans objet',
  'Tentative:',
  'Symptôme:',
  'Cause (prouvée):',
  'Cause (hypothèse):',
  'Prochaine stratégie:',
  'aucune suite',
  'aucun reste',
  'nouveau',
  'suite',
  'aucun',
  'SUITE: fin',
  'SUITE:',
  'AUTOWIN_',
  '<cmd>'
] as const

/**
 * Le bloc à plier après le profil utilisateur. Vide en français : la consigne d'un poste qui n'a
 * pas touché au réglage reste identique octet pour octet. STABLE : il ne dépend que du fichier, donc
 * il ne casse pas le cache du préfixe système d'un tour à l'autre. Relu à chaque tour et à chaque
 * étape : changer de langue pendant un travail vaut pour l'étape SUIVANTE, pas pour celle en cours.
 */
export function blocLangueDeReponse(deps: LangueDeps = {}): string {
  if (lireLangueReglee(deps) !== 'en') return ''
  const reperes = REPERES_GARDES_EN_FRANCAIS.map((r) => `\`${r}\``).join(', ')
  return (
    '\n=== LANGUE DE RÉPONSE : ANGLAIS (Settings · Interface) ===\n' +
    "L'utilisateur a choisi l'anglais (English) comme langue d'Autowin OS. Écris EN ANGLAIS tout ce " +
    "qu'il lit : tes réponses, explications, questions, résumés et bilans.\n" +
    'Exception stricte : les titres, étiquettes et lignes de contrôle imposés par tes consignes ' +
    "restent MOT POUR MOT en français, car l'application les lit tels quels — notamment " +
    `${reperes}. Seul le texte que tu écris après ces repères passe en anglais.\n` +
    'Le code, ses commentaires et les messages de commit suivent les règles du projet sur lequel ' +
    'tu travailles, pas ce réglage.\n'
  )
}
