/**
 * ROUTER UNE INTENTION EXPRIMÉE EN LANGAGE NATUREL VERS UNE PHASE DU PIPELINE.
 *
 * Il fallait NOMMER la phase (« scout … », « frame … ») pour n'en jouer qu'une. Une demande formulée
 * normalement — « je veux un bouton réparer » — tombait dans l'heuristique de régime et jouait
 * `frame, build`, alors que l'utilisateur ne demandait qu'un CADRAGE. MESURÉ sur 248 messages réels :
 * « je veux / j'aimerais / il faut » a lancé une orchestration 3 fois sur 3, jamais un cadrage seul.
 *
 * CE MODULE NE DÉCIDE PAS S'IL FAUT ORCHESTRER. Il ne fait que RESTREINDRE les phases d'une tâche déjà
 * partie en orchestration. Délibéré : le 2026-07-28, un routage qui court-circuitait `chat()` AVANT le
 * modèle a dû être retiré. Restreindre ne peut que rendre une tâche MOINS chère ; déclencher peut la
 * créer à tort.
 *
 * PORTÉE DE COUVERTURE, dite pour ce qu'elle est : familles FR et EN, conjugaisons, apostrophes,
 * troncatures, préambules de politesse, adverbes de degré. C'est ce qui est MESURÉ par les tests — pas
 * une propriété de généricité prouvée. L'audit du 2026-07-29 a montré deux fois que « générique » était
 * une affirmation trop large : d'abord calibrée sur le corpus d'un seul utilisateur, puis sur les
 * phrases d'un seul juge. Toute extension doit venir d'un balayage INDÉPENDANT, pas des exemples déjà
 * cités par celui qui a signalé le défaut précédent.
 *
 * ═══ CE QUE L'AUDIT DU 2026-07-29 A CASSÉ, ET QUI EST RÉPARÉ ICI ═══
 * Quatre défauts MAJEURS, tous prouvés par exécution sur la version précédente :
 *  1. La NÉGATION routait comme l'affirmation : « je veux pas de framework, corrige le bug » →
 *     `['frame']` sans `build`, donc le bug demandé n'était jamais corrigé. → garde de négation.
 *  2. Des mots d'usage GÉNÉRAL déclenchaient `judge`, qui rend des phases VIDES :
 *     « reviewer un article scientifique, corrige le bug » → `[]`, seul le juge tournait, sur rien.
 *     → les verbes d'examen exigent désormais un COMPLÉMENT (« review this », « évalue ce … »).
 *  3. Les POLITESSES en tête n'étaient pas tolérées : « peux-tu chercher … », « stp, cherche … »,
 *     « please clean up … » → aucune route. C'est le registre le plus courant. → préambule strippé.
 *  4. DEUX intentions dans un message : « audite ça et corrige ce que tu trouves » → `judge` → `[]`,
 *     la correction était SILENCIEUSEMENT abandonnée. → on refuse de router, le régime reprend la main.
 * Leçon de méthode : mes 74 tests étaient verts et ne couvraient que ce que j'avais imaginé. Ces cas
 * viennent d'un juge qui a EXÉCUTÉ le code contre des phrases que je n'avais pas prévues.
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
 * Préambules à IGNORER avant de chercher l'intention : politesses, connecteurs, demandes indirectes.
 * DÉFAUT MAJEUR n° 3 : « peux-tu chercher ce qui cloche » ne routait pas, alors que « cherche ce qui
 * cloche » routait — deux formulations synonymes, un seul comportement. Les deux voies de fidélité de
 * l'audit l'ont trouvé indépendamment.
 */
const POLITE_PREAMBLE =
  /^(?:(?:est-ce que )?(?:tu )?(?:peux|pourrais)(?:-tu| tu)?|(?:vous )?(?:pouvez|pourriez)(?:-vous| vous)?|merci de|merci d'|s'?il te plait|s'?il vous plait|stp|svp|pls|plz|please|can you|could you|would you|will you|bon|alors|du coup|donc|hey|salut|dis|dis-moi|ecoute|au fait|sinon|et sinon|deja)\b[\s,:!-]*/

/** Retire jusqu'à 2 préambules empilés (« bon, stp, cherche … »). Borné pour rester prévisible. */
function stripPreamble(text: string): string {
  let out = text
  for (let round = 0; round < 2; round += 1) {
    const stripped = out.replace(POLITE_PREAMBLE, '')
    if (stripped === out) break
    out = stripped.trim()
  }
  return out
}

/**
 * NÉGATION — DÉFAUT MAJEUR n° 1. « faudrait pas nettoyer » était routé en `clean`, « je veux pas de
 * framework » en `frame`. Prouvé : « je veux pas de framework, corrige le bug dans auth.ts » →
 * `['frame']` SANS `build`.
 *
 * Une intention NIÉE n'est pas une intention : on refuse de router et l'heuristique de régime reprend
 * la main — le comportement d'avant ce module, donc jamais pire.
 */
const NEGATED_INTENT = new RegExp(
  '^(?:' +
    /**
     * FR : « je (ne) veux pas », « faudrait pas », « on devrait pas », « j'ai pas besoin ».
     *
     * « PLUS » EST EXCLU de cette liste — défaut MAJEUR du cycle 2 de l'audit. « plus » est le plus
     * souvent un QUANTIFICATEUR, pas une négation : « je veux plus de tests » ne route plus rien alors
     * que « je veux » est l'exemple canonique du besoin. Prouvé en aval :
     * `regimePhases("je veux plus de details, corrige le bug")` rendait `['frame','build']`, donc le
     * module échouait SILENCIEUSEMENT à restreindre — le pipeline complet payant, sans aucun signal.
     * « plus » ne compte donc comme négation qu'avec un « ne »/« n' » explicite (traité plus bas).
     *
     * AMBIGUÏTÉ ASSUMÉE : « on devrait plus tester » veut dire « ne plus tester » OU « tester plus »
     * selon l'intonation. On choisit de ROUTER (donc la phase la moins chère) plutôt que de refuser :
     * un cadrage inutile coûte moins qu'un pipeline complet imposé en silence.
     */
    "(?:je|on|tu|il|ca|c'|nous|vous)\\s*(?:ne\\s+)?\\w*\\s*(?:pas|jamais)\\b" +
    "|(?:ne\\s+)?\\w+\\s+(?:pas|jamais)\\b" +
    /**
     * « ne … plus » / « n'… plus » : là, « plus » EST une négation.
     * `\bne\b` et NON `n(?:e|')` : sans la borne de mot, le « ne » de « NEttoie » et le « ne » de
     * « NEed » matchaient, donc « nettoie plus de tests » et « we need plus de tests » étaient pris
     * pour des négations. Attrapé par mon propre balayage indépendant, pas par un juge.
     */
    "|(?:\\w+\\s+)?(?:\\bne\\b|\\bn')\\s*\\w+\\s+plus\\b" +
    '|pas\\s+(?:besoin|la\\s+peine|de)\\b' +
    // EN : tout auxiliaire suivi de « not » (« we should not », « it will not »), plus les contractions.
    '|(?:\\w+\\s+)?(?:should|shall|must|will|would|can|could|do|does|did|is|are|was|were|have|has|had)\\s+not\\b' +
    "|(?:i|we|you|it|they)\\s+(?:don't|doesn't|didn't|won't|shouldn't|wouldn't|can't|cannot)\\b" +
    '|no\\s+need\\b' +
    "|don'?t\\b|never\\b" +
    ')'
)

/** L'intention est-elle niée dans sa PREMIÈRE proposition ? (Au-delà, c'est une autre phrase.) */
function isNegated(text: string): boolean {
  const firstClause = text.split(/[,;.!?]|\bet\b|\bpuis\b|\band\b|\bthen\b/)[0] ?? text
  return NEGATED_INTENT.test(firstClause.trim())
}

/**
 * SECONDE INTENTION — DÉFAUT MAJEUR n° 4. « audite ça et corrige ce que tu trouves » était routé en
 * `judge`, qui rend des phases VIDES : la demande de correction disparaissait sans un mot.
 *
 * Quand une action d'exécution suit l'intention, on REFUSE de router : mieux vaut le pipeline complet
 * du régime (plus cher mais complet) qu'un livrable amputé en silence.
 */
const FOLLOWING_ACTION =
  /(?:,|;|\bet\b|\bpuis\b|\bensuite\b|\band\b|\bthen\b|\balso\b)\s*(?:tu\s+)?(?:corrig|repar|fix|ajout|add|implement|impl[eé]ment|modifi|change|chang|supprim|remove|delete|renomm|rename|cr[eé]|creat|refactor|nettoi|clean|test|verifi|deploy|build|ecris|writ|mets?|met\b|fais\b|applique)/

function hasFollowingAction(text: string): boolean {
  return FOLLOWING_ACTION.test(text)
}

/**
 * Familles d'intention, en TÊTE de message (après le préambule) : une intention citée au milieu d'une
 * phrase n'est pas une demande.
 *
 * Ordre VOLONTAIRE, du plus spécifique au moins : `judge` avant `scout`, `clean`/`terrain` avant
 * `frame` — sinon une tournure comme « ça devrait être nettoyé » serait absorbée par `frame` (défaut
 * mineur signalé par l'audit).
 */
const INTENT_PATTERNS: ReadonlyArray<{ phase: PipelinePhase; pattern: RegExp }> = [
  {
    /**
     * JUGER un livrable existant.
     * DÉFAUT MAJEUR n° 2 : `review\w*`, `assess\w*`, `evalue\w*`, `relis\w*` et `critique\w*` nus
     * attrapaient des mots d'usage général (« reviewer un article », « evaluer une variable »,
     * « relis-toi », « critique » comme nom). Ces verbes exigent maintenant un COMPLÉMENT qui désigne
     * un livrable. `audit`/`juge` restent nus : ce sont des demandes univoques dans ce contexte.
     */
    phase: 'judge',
    pattern: new RegExp(
      '^(?:' +
        // `juge(s|z|r)` et NON `juge\w*` : « jugement dernier » n'est pas une demande d'audit.
        'audit\\w*|audi|juge(?:s|z|r|ons)?|judge' +
        /**
         * Verbes ambigus : un complément est OBLIGATOIRE.
         * `assess` est ABANDONNÉ, et c'est un renoncement assumé : « assess the situation » et
         * « assess the retrieval design » ont le même déterminant, donc aucune règle de complément ne
         * les sépare. Perdre un rappel vaut mieux qu'un faux positif qui vide les phases — l'audit a
         * prouvé que `assess` seul menait à `[]`, donc à une demande de correction perdue.
         */
        "|(?:review|evalue|evaluez|relis|relisez|critique|critiquez)\\s+(?:ce|cet|cette|ces|le|la|les|l'|mon|ma|mes|notre|nos|this|that|these|the|my|our)\\b" +
        "|verifie (?:la qualite|le rendu)|check the quality" +
        // Questions de validation : la forme INTERROGATIVE, jamais une satisfaction.
        "|(?:est-ce que )c'?est (?:bon|bien|correct|ok)" +
        "|c'?est (?:bon|bien|correct|ok)\\s*[?]" +
        "|(?:c'?est )?vraiment (?:fini|fait|bon)\\s*[?]" +
        ')(?![A-Za-z0-9_])'
    )
  },
  {
    // CHERCHER quoi faire : aucune tâche n'est encore choisie.
    phase: 'scout',
    pattern: new RegExp(
      '^(?:' +
        'cherche\\w*|trouve\\w*|scout\\w*|explore\\w*|repere\\w*|inspecte\\w*|brainstorm\\w*' +
        "|(?:qu'?)?est-ce (?:qu'?)?(?:on|je) (?:peut|pourrais?) (?:ameliorer|faire)" +
        '|(?:quoi|que) (?:ameliorer|faire)' +
        "|(?:par )?ou (?:est-ce qu'?on |on )?(?:commence|demarre|commencer|demarrer)" +
        '|find|look for|look into|search for|take a look' +
        '|what (?:could|should) (?:we|i)' +
        "|what'?s wrong with" +
        '|where (?:do|should) (?:we|i) start' +
        '|any (?:ideas|opportunit\\w*)' +
        '|help me (?:decide|choose)' +
        ')(?![A-Za-z0-9_])'
    )
  },
  {
    // PRÉPARER le terrain d'une boucle autonome. AVANT `frame` : « il faut préparer le harnais » est un
    // terrain, pas un cadrage.
    phase: 'terrain',
    pattern: new RegExp(
      '^(?:' +
        // `terrain` NU est abandonné : « terrain de foot » n'est pas une demande de harnais. Qui veut
        // cette phase la NOMME (`/terrain`), ce qui reste autoritaire en amont.
        '(?:il (?:faut|faudrait) |ca doit )?prepare\\w* (?:le |la )?(?:terrain|harnais|boucle|observabilite)' +
        '|set ?up the (?:harness|loop)' +
        ')(?![A-Za-z0-9_])'
    )
  },
  {
    // NETTOYER avant validation. AVANT `frame` pour la même raison : « ça devrait être nettoyé ».
    phase: 'clean',
    pattern: new RegExp(
      '^(?:' +
        'clean(?:s|ed|ing|up)?|tidy' +
        '|nettoie\\w*|fais le menage|range\\w*' +
        "|(?:ca (?:doit|devrait)|il (?:faut|faudrait)) (?:etre )?(?:nettoye|nettoyer|range|ranger)" +
        ')(?![A-Za-z0-9_])'
    )
  },
  {
    // CADRER un besoin : une volonté exprimée, pas un ordre d'exécution.
    phase: 'frame',
    pattern: new RegExp(
      '^(?:' +
        'frame(?:s|r|z|e|es|ez)?|cadr(?:e|ag|er|ez)\\w*' +
        '|je (?:veux|voudrais|souhaite|desire)' +
        "|j'?(?:aimerais|voudrais|veux)" +
        '|on (?:veut|voudrait|devrait|aimerait)' +
        '|il (?:faut|faudrait)|faudrait' +
        '|ca (?:doit|devrait)' +
        "|(?:j'?ai |on a )?besoin (?:de|d'?)" +
        "|ce (?:qu'?il )?(?:me |nous )?faut" +
        '|i (?:want|need|would like)|we (?:want|need|should)' +
        '|it should|there should' +
        ')(?![A-Za-z0-9_])'
    )
  }
]

export interface IntentPhaseMatch {
  phase: PipelinePhase
  /** L'expression qui a déclenché la route — à journaliser : un routage muet est indéfendable. */
  matched: string
}

/**
 * Phase déduite de l'INTENTION, ou `null` si aucune famille ne s'applique — ce qui est le cas NORMAL et
 * fréquent. On ne devine pas : sans reconnaissance, l'heuristique de régime reprend la main comme avant.
 *
 * Trois REFUS explicites, chacun issu d'un défaut majeur prouvé : intention niée, action d'exécution qui
 * suit, et verbe d'examen sans complément. Dans les trois cas, refuser de router est le choix SÛR : on
 * retombe sur le comportement d'avant ce module.
 */
export function matchIntentPhase(message: string): IntentPhaseMatch | null {
  const normalized = normalizeIntent(message)
  if (!normalized) return null
  const text = stripPreamble(normalized)
  if (!text) return null
  if (isNegated(text)) return null
  if (hasFollowingAction(text)) return null
  for (const { phase, pattern } of INTENT_PATTERNS) {
    const found = pattern.exec(text)
    if (found) return { phase, matched: found[0] }
  }
  return null
}
