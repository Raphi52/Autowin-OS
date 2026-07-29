/**
 * ROUTER UNE INTENTION EXPRIMÉE EN LANGAGE NATUREL VERS UNE PHASE DU PIPELINE.
 *
 * Aujourd'hui il faut NOMMER la phase (« scout … », « frame … ») pour n'en jouer qu'une. Une demande
 * formulée normalement — « je veux un bouton réparer » — tombe dans l'heuristique de régime et joue
 * `frame, build` (voire les cinq phases si un mot de complexité apparaît), alors que l'utilisateur ne
 * demandait qu'un CADRAGE. MESURÉ sur 248 messages réels : « je veux / j'aimerais / il faut » a lancé
 * une orchestration 3 fois sur 3 — jamais un cadrage seul.
 *
 * CE MODULE NE DÉCIDE PAS S'IL FAUT ORCHESTRER. Il ne fait que RESTREINDRE les phases d'une tâche déjà
 * partie en orchestration. C'est délibéré : le 2026-07-28, un routage qui court-circuitait `chat()`
 * AVANT le modèle a dû être retiré (« Scout LECTURE SEULE dans src/main/ » lançait un pipeline qui
 * échouait, sans qu'aucune règle de prompt puisse le corriger). Restreindre ne peut que rendre une
 * tâche MOINS chère ; déclencher, ça peut la créer à tort. On ne refait donc pas la même erreur.
 *
 * GÉNÉRIQUE, PAS AJUSTÉ À UNE PERSONNE : familles d'intention en français ET en anglais, tolérantes à
 * la conjugaison, à l'apostrophe droite ou typographique, aux abréviations d'usage et aux TRONCATURES
 * (un utilisateur écrit « audi » pour « audite »). Le corpus d'un seul utilisateur sert à VALIDER la
 * couverture, jamais à définir la table — sinon l'app ne servirait qu'à lui.
 */
import type { PipelinePhase } from './skill-pipeline'

/** Normalise pour comparer : minuscules, accents retirés, apostrophes unifiées, espaces réduits. */
export function normalizeIntent(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[‘’`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Familles d'intention, en TÊTE de message uniquement : une intention citée au milieu d'une phrase
 * n'est pas une demande (« je me demande si scout aiderait » ne demande pas un scout).
 *
 * Ordre d'évaluation VOLONTAIRE : le plus spécifique d'abord. `judge` avant `scout`, parce que
 * « audite la qualité » contient une idée d'examen que `scout` pourrait revendiquer.
 */
const INTENT_PATTERNS: ReadonlyArray<{ phase: PipelinePhase; pattern: RegExp }> = [
  {
    // JUGER un livrable existant. « audi » couvre les troncatures (audit, audite, auditer, audi…).
    phase: 'judge',
    pattern:
      /^(?:audit\w*|audi|juge\w*|judge|evalue\w*|review\w*|relis\w*|critique\w*|(?:est-ce que )c'?est (?:bon|bien|correct|ok)|c'?est (?:bon|bien|correct|ok)\s*[?]|(?:c'?est )?vraiment (?:fini|fait|bon)|verifie la qualite|check the quality|assess\w*)(?![A-Za-z0-9_])/
  },
  {
    // CHERCHER quoi faire : aucune tâche n'est encore choisie.
    phase: 'scout',
    pattern:
      /^(?:cherche\w*|trouve\w*|scout\w*|explore\w*|repere\w*|inspecte\w*|(?:qu'?)?est-ce (?:qu'?)?(?:on|je) (?:peut|pourrais?) (?:ameliorer|faire)|(?:quoi|que) (?:ameliorer|faire)|(?:par )?ou (?:est-ce qu'?on |on )?(?:commence|demarre|commencer|demarrer)|find|look for|search for|what (?:could|should) (?:we|i)|where (?:do|should) (?:we|i) start|any (?:ideas|opportunit\w*))(?![A-Za-z0-9_])/
  },
  {
    // CADRER un besoin : l'utilisateur exprime une volonté, pas une commande d'exécution.
    phase: 'frame',
    pattern:
      /^(?:frame(?:s|r|z|e|es|ez)?|cadr(?:e|ag|er|ez)\w*|je (?:veux|voudrais|souhaite|desire)|j'?(?:aimerais|voudrais|veux)|on (?:veut|voudrait|devrait|aimerait)|il (?:faut|faudrait)|faudrait|ca doit|ca devrait|(?:j'?ai |on a )?besoin (?:de|d'?)|ce (?:qu'?il )?(?:me |nous )?faut|i (?:want|need|would like)|we (?:want|need|should)|it should|there should)(?![A-Za-z0-9_])/
  },
  {
    // PRÉPARER le terrain d'une boucle autonome.
    phase: 'terrain',
    pattern:
      /^(?:terrain\w*|prepare\w* (?:le |la )?(?:terrain|harnais|boucle|observabilite)|set ?up the (?:harness|loop))(?![A-Za-z0-9_])/
  },
  {
    // NETTOYER avant validation.
    phase: 'clean',
    pattern: /^(?:clean(?:s|ed|ing)?|cleanup|nettoie\w*|fais le menage|tidy|cleanup)(?![A-Za-z0-9_])/
  }
]

export interface IntentPhaseMatch {
  phase: PipelinePhase
  /** L'expression qui a déclenché la route — à journaliser : un routage muet est indéfendable. */
  matched: string
}

/**
 * Phase déduite de l'INTENTION en tête de message, ou `null` si aucune famille ne s'applique.
 *
 * `null` est le cas NORMAL et fréquent : la majorité des messages sont des actions directes
 * (« corrige X »), des questions ou de la conversation. On ne devine pas — on ne route que ce qui est
 * reconnu, sinon l'heuristique de régime reprend la main comme avant.
 */
export function matchIntentPhase(message: string): IntentPhaseMatch | null {
  const text = normalizeIntent(message)
  if (!text) return null
  for (const { phase, pattern } of INTENT_PATTERNS) {
    const found = pattern.exec(text)
    if (found) return { phase, matched: found[0] }
  }
  return null
}
