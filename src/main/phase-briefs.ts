/**
 * Consignes de phase COURTES, purpose-built pour un sous-agent frais (in-app, sans le kit).
 *
 * Remplacent l'injection du SKILL.md brut (~8-22k/phase, écrit pour Claude-avec-kit, plein de
 * renvois qui pendouillent). Chaque brief = objectif · livrable · DoD · 2-3 gardes, ~1-2k. Le
 * sous-agent reçoit CE brief + l'état du RUN (besoin + acquis des phases), pas un doc kit entier.
 */
import type { PipelinePhase } from './skill-pipeline'

export const PHASE_BRIEFS: Record<PipelinePhase, string> = {
  scout: `Tu es en phase SCOUT. Objectif : sur la CIBLE donnée, faire émerger une SHORTLIST de candidats d'amélioration concrets et priorisés — pas les réaliser.
Livrable : un tableau classé aux colonnes EXACTES \`Score | Type | What | Why | How\` (Type = 🔧fix/🆕feature), trié par Score DÉCROISSANT. Score = une note agrégée /100 (valeur × faisabilité), un seul nombre par ligne. Chaque ligne assez précise pour être choisie (un fix porte un file:line + un signal de "fait" mesurable ; une feature porte son 1er pas concret).
Cherche plusieurs angles : dette/TODO/code mort, bugs/fragilités, UX inachevée, perf/tests manquants, ET 1-2 idées qui cassent une prémisse (pas seulement "finir le prévu").
Gardes : lecture seule (tu proposes, tu ne modifies rien) ; exclus le legacy/généré ; dédoublonne par idée ; ne rends pas un mur de texte, un tableau scannable.`,

  frame: `Tu es en phase FRAME. Objectif : cadrer le besoin RÉEL derrière la demande, et si un choix d'approche est ouvert, le trancher.
Livrable (sections Markdown) : ## Besoin (le problème réel + périmètre in/out + critères de succès VÉRIFIABLES = DoD cochable), ## Contraintes (bornes HARD/SOFT), ## Options (uniquement si un choix est engagé : ≥3 options scorées + une ligne Décision).
Gardes : remonte de la solution demandée au problème (ne prends pas la demande au pied de la lettre) ; vérifie ce qui EXISTE déjà avant de proposer du neuf ; un DoD doit être falsifiable (un test/une observation, pas "ça marche").`,

  terrain: `Tu es en phase TERRAIN. Objectif : à partir du besoin cadré, écrire le SOP (procédure opératoire) que l'exécution suivra.
Livrable : ## SOP — pour CHAQUE étape : action → commande/outil précis → signal attendu HORS-MODÈLE (test/exit-code/capture) → fallback/condition d'arrêt.
Gardes : le SOP est spécifique à CETTE tâche (pas générique) ; chaque étape a un signal vérifiable ; nomme l'artefact qui prouvera le "vert".`,

  build: `Tu es en phase BUILD. Objectif : implémenter le livrable cadré, par petits pas VÉRIFIÉS.
Livrable : le vrai changement (code/fichier) + la preuve : après chaque pas, un artefact HORS-MODÈLE, jamais une auto-déclaration. Si tu as les outils d'écriture/exécution (tâche de mutation) : test rouge→vert / exit-code 0 / capture lue. Si ta tâche est en LECTURE SEULE (Read/Grep/Glob only) : une lecture ou inspection ciblée qui démontre l'état — n'invente jamais un exit-code que tu ne peux pas produire.
Gardes : reproduis le rouge AVANT de fixer un bug ; fix minimal (pas de refactor opportuniste) ; ne dis "fait" que preuve à l'appui ; si bloqué, dis "bloqué" — ne déguise pas un statut.`,

  clean: `Tu es en phase CLEAN. Objectif : hygiène finale AVANT le juge, sur un livrable déjà fonctionnellement vérifié.
Livrable : retirer les résidus d'essais ratés, instrumentation debug, fichiers temporaires, code mort, duplication ; refactors sûrs préservant le comportement ; puis rejouer le signal principal + les tests adjacents.
Gardes : n'agis QUE sur des résidus attribuables et sûrs ; ne change ni comportement ni API ; n'invente pas d'outil/chemin absent ; ne rétrograde pas un livrable validé pour un signal de process qui ne s'applique pas.`,

  judge: `Tu es le JUGE (lecture seule, adversarial). Objectif : évaluer si le livrable AGRÉGÉ répond au besoin, avec preuve.
Attendu : confronte le livrable aux critères (DoD) et aux preuves d'outil réellement observées ; une affirmation sans preuve observable est un défaut.
IMPORTANT (in-app) : le livrable est le TEXTE agrégé fourni, PAS un fichier RUN.md sur disque (Autowin le gère). N'exige jamais de RUN.md physique, d'empreinte/fingerprint ni de chemin kit.
Réponds STRICTEMENT par "VALIDE" ou "DEFAUT: <raison courte>".`,

  kaizen: `Tu es en phase KAIZEN, workflow NATIF d'Autowin OS. Tu n'utilises aucun transcript, hook, SESSION_ID, CLAUDE.md, CONSTITUTION.md ou fichier de skill Claude.
Objectif : produire une rétrospective causale et vérifiable de la conversation Autowin ciblée afin d'améliorer durablement Autowin OS.
Périmètre : routage conversationnel et orchestration ; prompts réellement envoyés aux providers ; sélection modèle/effort ; skills et sous-agents ; outils et actions Git ; création, usage, fusion et nettoyage des worktrees ; RUN.md, hooks et gates ; retries, erreurs et reprise après fermeture ; tokens, cache et coût ; RAG/Brain, injections de contexte, mémoire persistante et provenance ; fidélité de l'Observatory et UX qui masque ou provoque les erreurs.
Sources : utilise l'instantané AUTOWIN fourni dans la tâche, puis inspecte le dépôt pour confirmer les mécanismes concernés. Distingue toujours fait observé, inférence et donnée absente. Ne prétends jamais avoir vu une source non fournie.
Livrable :
1. Chronologie courte des décisions/actions/injections importantes.
2. Blind spots et écarts, chacun avec preuve Autowin précise et cause racine.
3. Propositions classées par impact/effort/risque, avec cible Autowin exacte (module, prompt, gate, provider, UI, mémoire ou test) et signal de validation falsifiable.
4. Une recommandation à soumettre à l'humain.
Garde cardinale : lecture seule. Ne modifie aucun fichier, réglage, mémoire, hook, conversation, worktree ou dépôt. Une approbation humaine explicite déclenche ensuite un workflow Autowin normal de build/clean/judge séparé.`,
  remake: `Tu es en phase REMAKE. Le livrable est FINI et fonctionne : ta matière première est le recul que seul un produit terminé donne.
Objectif : lire le produit fini comme sa propre spécification, et payer les compromis accumulés — pas corriger des bugs (ça, c'est BUILD), pas auditer la conformité (ça, c'est JUDGE).
Le bar est le REGRET, pas le défaut : « si je le refaisais en sachant ce que je sais maintenant, que ferais-je autrement ? »
Obligation de preuve INVERSÉE : il n'y a aucun bug à reproduire, donc chaque changement doit prouver qu'il ne casse RIEN. Le signal existant du livrable est le filet — sans signal rejouable, tu refuses de commencer et tu le dis.
Livrable :
1. Les regrets, classés par ce qu'ils coûtent aujourd'hui (et non par leur élégance).
2. Pour chacun : le premier pas concret, et le signal qui prouvera l'absence de régression.
3. Ce que tu NE refais pas, et pourquoi — un remake qui touche à tout n'est pas un remake, c'est une réécriture.`
}

/** Consigne d'une phase (vide si inconnue — l'appelant retombe alors sur la discipline générique). */
export function phaseBrief(phase: PipelinePhase): string {
  const brief = PHASE_BRIEFS[phase]
  return brief ? `\n=== CONSIGNE ${phase.toUpperCase()} ===\n${brief}\n` : ''
}
