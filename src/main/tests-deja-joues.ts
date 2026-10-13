import type { ExecutionEvidence } from './providers/types'
import { isStrictlyReadOnlyCommand } from './providers/evidence-vocabulary'

/**
 * LE JUGE NE RELANCE PAS UN TEST DÉJÀ JOUÉ SUR LE CODE QU'IL INSPECTE (piste 4 de conv-914).
 *
 * Mesuré sur le contrôle final de run-a8a70cd0ee56-1 (journal `c5d52ecc…jsonl`) : 247 s, dont
 * `vitest` (5,1 s) et `npm run typecheck` (25,3 s) relancés alors que le producteur venait de les
 * jouer, soit ~12 % du passage. Le juge recevait pourtant déjà ces commandes (`serializeEvidenceForJudge`),
 * mais rien ne lui disait si le code avait changé APRÈS elles. Dans le doute, il relançait.
 *
 * Ce module répond à cette seule question, sur les preuves capturées par l'application (jamais sur
 * le texte du producteur) : quels tests ont tourné sur le code ACTUEL ? On part de la preuve la plus
 * récente et on remonte ; on s'arrête à la PREMIÈRE preuve qui aurait pu écrire un fichier. Est
 * « sans écriture » seulement ce qui est PROUVABLEMENT une lecture : outil de lecture (Read, Grep,
 * Glob), commande de la liste fermée `isStrictlyReadOnlyCommand` ou lecture git — seules ou en
 * tube de lectures —, ou un autre test
 * réutilisable. Tout le reste (édition, commande inconnue, outil externe, commande en arrière-plan)
 * arrête la remontée : en cas de doute, rien n'est réutilisé.
 *
 * LE RÉSULTAT D'UN TEST, selon ce que la preuve porte :
 * - code de sortie chiffré (Codex, `codex.ts:183`) ;
 * - `<test> ; echo NOM=$?` : le code est relu dans la sortie, la ligne `NOM=<n>` ;
 * - sinon réussi/échoué (Claude) : `ok` vient de `is_error`, levé par le CLI quand le code est non
 *   nul (mesuré sur run-a8a70cd0ee56-1 : 251 appels Bash, les 7 échecs d'exécution commencent par
 *   « Exit code N », le 8e est un refus du garde-fou, donc non exécuté).
 * fix-ok: conv-914 piste 4 — la 1re version exigeait un code de sortie chiffré ; or la preuve Claude
 * n'en porte pas (`claude.ts`, push de `executionEvidence` sans `exitCode`), et les agents écrivent
 * presque toujours `; echo EXIT=$?`, que la 1re version refusait : la règle ne se déclenchait jamais.
 *
 * LIMITES ASSUMÉES : l'ordre des preuves n'est chronologique que pour UN agent à la fois — quand
 * plusieurs agents travaillent en parallèle dans la même copie, ou après une reprise, l'appelant ne
 * passe que les preuves postérieures (`orchestrator.ts`, `debutPreuvesOrdonnees`). Une commande en
 * arrière-plan lancée AVANT la dernière écriture et qui écrirait encore après n'est pas détectée.
 */

export interface TestDejaJoue {
  commande: string
  /** Absent quand la preuve ne dit que réussi/échoué (Claude). */
  exitCode?: number
  reussi: boolean
}

/** Bornes du bloc : il s'ajoute à chaque passage du juge. */
const TESTS_MAX = 12
const COMMANDE_MAX = 200

/** Lanceurs dont le résultat se réutilise. `node -e` et `build` en sont exclus : ils peuvent écrire. */
const LANCEUR_DE_TEST =
  /^(?:npx\s+)?(?:vitest|jest|pytest|eslint)(?:\s|$)|^(?:npx\s+)?tsc\s(?:.*\s)?--noEmit(?:\s|$)|^(?:npm|pnpm|yarn)(?:\.cmd)?\s+(?:test|t|run\s+(?:test|typecheck|lint|check)(?::[\w-]+)?)(?:\s|$)|^(?:cargo|go|dotnet)\s+test(?:\s|$)/i
/** Drapeaux qui font ÉCRIRE un lanceur de test (instantanés, corrections) ou le font tourner sans fin. */
const DRAPEAU_D_ECRITURE =
  /(?:^|\s)(?:-u|--update(?:Snapshot)?|--fix|--write|-w|--watch)(?:\s|=|$)/i
/** Sortie d'un test envoyée vers un fichier : elle n'écrit pas dans le code testé. */
const REDIRECTION_FINALE = /(?:\s+\d?>{1,2}\s*(?:"[^"]*"|'[^']*'|[^\s"'&|;<>]+))+\s*$/
const CD = /^cd\s+(?:"[^"]*"|'[^']*'|[^\s"']+)$/i
const LECTURE_GIT = new Set(['status', 'diff', 'log', 'show', 'rev-parse', 'ls-files', 'blame'])
/** `echo EXIT=$?` juste après le test : le code du TEST est écrit dans la sortie. */
const ECHO_CODE = /^echo\s+(["']?)([A-Za-z_]\w*)=\$\?\1$/
/** Une variable se remplace par une valeur, jamais par une commande (contrairement à `$(…)`). */
const VARIABLE = /\$\{?[A-Za-z_]\w*\}?/g
/** Réponse du CLI à une commande lancée en arrière-plan : elle n'est pas finie. */
const ARRIERE_PLAN = /Command running in background with ID:/

/**
 * Outils SANS commande qui ne peuvent pas écrire. Liste fermée : un outil externe (MCP) arrive lui
 * aussi sans commande et classé `inspection` (`claudeToolEvidenceKind`), alors qu'il peut écrire.
 */
const OUTILS_DE_LECTURE = new Set([
  'read',
  'grep',
  'glob',
  'ls',
  'webfetch',
  'websearch',
  'web_search',
  'notebookread',
  'todowrite'
])

/**
 * Les parties séparées par `;`, une fois retirées les fusions `2>&1`.
 * fix-ok: `2>&1;` (fusion collée au `;`, la forme `> log 2>&1; echo EXIT=$?`) n'était pas retirée —
 * le `&` restant faisait refuser la commande ; test « `; echo EXIT=$?` » rouge avant, vert après.
 */
function partiesDeLaCommande(commande: string): string[] {
  return commande
    .replace(/\s2>&1(?=[\s;]|$)/g, ' ')
    .split(';')
    .map((partie) => partie.trim())
    .filter(Boolean)
}

/**
 * Les segments d'une partie enchaînée par `&&`, sans les `cd` de tête — ou `undefined` dès qu'un
 * séparateur rend l'issue indécidable (`|`, `&` seul, substitution, saut de ligne) : avec
 * `vitest | tail`, le code capturé n'est plus celui du test.
 */
function segmentsSimples(partie: string): string[] | undefined {
  if (/[\r\n`;|&]|\$\(/.test(partie.replace(/&&/g, ' '))) return undefined
  const segments = partie
    .split('&&')
    .map((segment) => segment.trim())
    .filter(Boolean)
  while (segments.length > 1 && CD.test(segments[0])) segments.shift()
  return segments.length > 0 ? segments : undefined
}

function estTestSimple(partie: string): boolean {
  const segments = segmentsSimples(partie)
  if (!segments || segments.length !== 1) return false
  const test = segments[0].replace(REDIRECTION_FINALE, '').trim()
  if (/[<>$%]/.test(test)) return false
  return LANCEUR_DE_TEST.test(test) && !DRAPEAU_D_ECRITURE.test(test)
}

function estLectureGit(segment: string): boolean {
  if (/[<>$%(){}^!]/.test(segment)) return false
  const mots = segment.split(/\s+/)
  if (mots[0]?.toLowerCase() !== 'git') return false
  let i = 1
  while (mots[i] === '-C' || mots[i] === '--no-pager') i += mots[i] === '-C' ? 2 : 1
  return (
    LECTURE_GIT.has((mots[i] ?? '').toLowerCase()) &&
    !mots.some((mot) => mot.startsWith('--output') || mot === '-o')
  )
}

/**
 * Une chaîne entre apostrophes est littérale (bash comme PowerShell) : ses caractères spéciaux
 * (`^!|;<>…`) sont neutralisés et les apostrophes retirées, ses tirets gardés (`'--pre=x'` reste une
 * option). `undefined` si une apostrophe reste seule : la partie a été coupée au milieu d'une
 * chaîne. Avec `"` ou `\`, l'appariement n'est plus sûr : la partie est rendue telle quelle.
 */
function sansChainesLitterales(partie: string): string | undefined {
  if (/["\\]/.test(partie)) return partie
  const neutre = partie.replace(/'([^']*)'/g, (_, contenu: string) =>
    contenu.replace(/[^\w./:=,+@\s-]/g, '_')
  )
  return neutre.includes("'") ? undefined : neutre
}

/**
 * fix-ok: run-a8a70cd0ee56-1 réparation 7 — le dernier nettoyage finissait par
 * `git status --porcelain | wc -l; … | grep '^!!' | …` : `segmentsSimples` refusait tout tube et
 * `^!` entre apostrophes, la lecture comptait comme une écriture, 0 test retrouvé. Un tube dont
 * CHAQUE maillon est une lecture stricte (sans redirection) reste une lecture.
 */
function partieEnLecture(partie: string): boolean {
  const neutre = sansChainesLitterales(partie)
  if (neutre === undefined) return false
  return neutre.split(/(?<!\|)\|(?!\|)/).every((maillon) => {
    const segments = segmentsSimples(maillon.trim())
    return Boolean(
      segments?.every((segment) => {
        if (CD.test(segment)) return true
        const sansVariables = segment.replace(VARIABLE, 'VAR')
        return isStrictlyReadOnlyCommand(sansVariables) || estLectureGit(sansVariables)
      })
    )
  })
}

/** Test seul, ou test suivi de `echo NOM=$?` puis de lectures ; `undefined` pour toute autre forme. */
function formeDeTest(commande: string): { nomDuCode?: string } | undefined {
  const parties = partiesDeLaCommande(commande)
  if (parties.length === 0 || !estTestSimple(parties[0])) return undefined
  if (parties.length === 1) return {}
  const echo = parties[1].match(ECHO_CODE)
  if (!echo || !parties.slice(2).every(partieEnLecture)) return undefined
  return { nomDuCode: echo[2] }
}

/** Vrai si la commande est un test dont le résultat est bien celui du test. */
export function estTestReutilisable(commande: string | undefined): boolean {
  return Boolean(commande && formeDeTest(commande))
}

/** Vrai seulement si la preuve n'a PROUVABLEMENT rien écrit. Le doute vaut écriture. */
function sansEcriture(item: ExecutionEvidence): boolean {
  /*
   * Le bilan de fin d'étape (`workspace-mutation-evidence.ts`) RÉCAPITULE les écritures de l'étape ;
   * chacune a déjà sa preuve, à sa place (Edit/Write, ou commande non prouvée en lecture). Il ne date
   * aucune écriture nouvelle.
   * fix-ok: rejeu sur run-state/run-a8a70cd0ee56-1.json — 4 étapes build sur 4 finissent par ce bilan :
   * le compter comme une écriture rendait la règle muette après TOUTE étape qui a modifié un fichier.
   */
  if (item.type === 'workspace_delta') return true
  if (item.stdout && ARRIERE_PLAN.test(item.stdout)) return false
  if (!item.command)
    return item.kind === 'inspection' && OUTILS_DE_LECTURE.has(item.type.toLowerCase())
  if (formeDeTest(item.command)) return true
  const parties = partiesDeLaCommande(item.command)
  return parties.length > 0 && parties.every(partieEnLecture)
}

function issueDuTest(
  item: ExecutionEvidence,
  forme: { nomDuCode?: string }
): Omit<TestDejaJoue, 'commande'> | undefined {
  if (forme.nomDuCode) {
    // La DERNIÈRE ligne `NOM=<n>` : la sortie gardée est la fin de la sortie de l'outil.
    const motif = new RegExp(`^${forme.nomDuCode}=(\\d+)$`)
    let code: number | undefined
    for (const ligne of (item.stdout ?? '').split(/\r?\n/)) {
      const lu = ligne.trim().match(motif)
      if (lu) code = Number(lu[1])
    }
    return code === undefined ? undefined : { exitCode: code, reussi: code === 0 }
  }
  if (typeof item.exitCode === 'number')
    return { exitCode: item.exitCode, reussi: item.exitCode === 0 }
  return { reussi: item.ok === true && item.status !== 'failed' }
}

/** Les tests joués depuis la dernière preuve qui a pu écrire, du plus ancien au plus récent. */
export function testsJouesSurLeCodeActuel(
  preuves: readonly ExecutionEvidence[] | undefined
): TestDejaJoue[] {
  const parCommande = new Map<string, TestDejaJoue>()
  const liste = preuves ?? []
  for (let i = liste.length - 1; i >= 0; i -= 1) {
    const item = liste[i]
    if (!sansEcriture(item)) break
    const forme = item.command ? formeDeTest(item.command) : undefined
    if (item.kind !== 'verification' || !item.command || !forme) continue
    const issue = issueDuTest(item, forme)
    // En remontant, le premier vu d'une commande est le plus récent : c'est lui qui compte.
    const commande = item.command.trim()
    if (issue && !parCommande.has(commande)) parCommande.set(commande, { commande, ...issue })
  }
  return [...parCommande.values()].reverse().slice(-TESTS_MAX)
}

/** Bloc du prompt du juge : vide quand aucun test n'a tourné sur le code actuel. */
export function noteTestsDejaJouesPourJuge(
  preuves: readonly ExecutionEvidence[] | undefined
): string {
  const tests = testsJouesSurLeCodeActuel(preuves)
  if (tests.length === 0) return ''
  const lignes = tests.map((test) => {
    const commande =
      test.commande.length > COMMANDE_MAX
        ? `${test.commande.slice(0, COMMANDE_MAX)}…`
        : test.commande
    const issue =
      test.exitCode !== undefined
        ? `code de sortie ${test.exitCode}`
        : test.reussi
          ? 'réussi'
          : 'échoué'
    return `- \`${commande}\` → ${issue}`
  })
  return (
    `TESTS DÉJÀ JOUÉS SUR LE CODE ACTUEL — relevés par l'application pendant l'exécution (commande et ` +
    `résultat capturés, pas déclarés par le producteur ; « réussi » = code de sortie 0) ; aucune ` +
    `commande capable de modifier un fichier n'a tourné depuis :\n${lignes.join('\n')}\n` +
    `Ne les relance pas : leur résultat vaut pour le code que tu inspectes, cite-les comme preuve. ` +
    `Relance-en un seulement si tu as une raison précise de douter, et dis laquelle. Un test absent ` +
    `de cette liste reste à lancer par toi s'il fonde ton verdict.\n`
  )
}
