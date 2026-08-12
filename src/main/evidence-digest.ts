import type { ExecutionEvidence } from './providers/types'

/**
 * Projection des preuves d'exécution vers un prompt de juge.
 *
 * `ExecutionEvidence` sert DEUX consommateurs aux besoins opposés : le Chat, qui affiche
 * `stdout`/`diff` bruts inline, et le juge LLM, qui n'a besoin que des champs porteurs de verdict.
 * Sérialiser la structure entière (`JSON.stringify(evidence)`) faisait payer au juge la charge
 * d'affichage du Chat. Mesuré sur le run conv-1102 (vue Worktrees, 11/08) : prompt juge de
 * 422 504 caractères dont 44,7 % de `stdout` bruts, 26,6 % d'empreintes SHA-256 (1 652 hashes)
 * et 9,9 % de commandes recopiées — soit ~81 % de charge qu'aucun juge ne peut exploiter.
 * Le run mourait ensuite sur « Budget tokens total dépassé (9 639 639 / 2 500 000) ».
 *
 * On garde ce qui fonde un verdict — quoi, réussi ou non, quelle commande, quel code de sortie,
 * et les BORDS du stdout (l'écho de la commande en tête, la ligne de résultat en queue) — et on
 * laisse au Chat ce qui ne sert qu'à l'affichage.
 */

/**
 * Bornes du LIVRABLE agrégé transmis au juge.
 *
 * Levier n°1 du scout coût joué dans Autowin le 2026-08-12 (conv-1120), adossé aux conversations
 * réelles : sur `conv-101`, un appel juge porte 1 540 000 caractères de messages pour 6,36 $, et
 * trois passes juge du même fil totalisent 10,56 $. Le chemin greedy injecte l'agrégat ENTIER,
 * sans le plafond que les autres phases appliquent.
 *
 * On coupe au milieu, jamais aux extrémités : un livrable porte sa substance en tête (ce qui a été
 * fait) et ses preuves en queue (tests, exit codes, verdicts). Amputer un bord rendrait le juge
 * incapable de juger ; amputer le ventre lui coûte des redites.
 */
export const AGGREGATE_HEAD = 40_000
export const AGGREGATE_TAIL = 20_000

/** Borne le livrable agrégé soumis au juge sans lui retirer ses deux bords porteurs. */
export const clampAggregateForJudge = (text: string | undefined): string =>
  text ? clampMiddle(text, AGGREGATE_HEAD, AGGREGATE_TAIL) : ''

/** Bornes : têtes/queues de `stdout`, longueur de commande, nombre de preuves. */
export const EVIDENCE_STDOUT_HEAD = 400
export const EVIDENCE_STDOUT_TAIL = 800
export const EVIDENCE_COMMAND_MAX = 300
export const EVIDENCE_MAX_ITEMS = 60

export interface JudgeEvidence {
  type: string
  kind: ExecutionEvidence['kind']
  status: string
  ok: boolean
  summary: string
  command?: string
  exitCode?: number
  path?: string
  pathCount?: number
  stdout?: string
  diffLines?: number
  oracleStable?: boolean
}

/** Coupe au milieu en conservant les deux bords, qui portent l'information de verdict. */
export const clampMiddle = (text: string, head: number, tail: number): string => {
  if (text.length <= head + tail) return text
  const omitted = text.length - head - tail
  return `${text.slice(0, head)}\n… [${omitted} caractères omis] …\n${text.slice(-tail)}`
}

const countLines = (text: string): number => (text ? text.split('\n').length : 0)

/** Réduit une preuve à ses champs porteurs de verdict. */
export const evidenceForJudge = (item: ExecutionEvidence): JudgeEvidence => {
  const digest: JudgeEvidence = {
    type: item.type,
    kind: item.kind,
    status: item.status,
    ok: item.ok,
    summary: item.summary
  }
  if (item.command) digest.command = clampMiddle(item.command, EVIDENCE_COMMAND_MAX, 0)
  if (item.exitCode !== undefined) digest.exitCode = item.exitCode
  // `path` et `paths` répètent le même chemin absolu ; on n'en garde qu'un, plus le compte.
  const firstPath = item.path ?? item.paths?.[0]
  if (firstPath) digest.path = firstPath
  const pathCount = item.paths?.length ?? (item.path ? 1 : 0)
  if (pathCount > 1) digest.pathCount = pathCount
  if (item.stdout) digest.stdout = clampMiddle(item.stdout, EVIDENCE_STDOUT_HEAD, EVIDENCE_STDOUT_TAIL)
  // Le diff intégral ne fonde aucun verdict que le résumé ne porte déjà ; son volume, si.
  if (item.diff) digest.diffLines = countLines(item.diff)
  if (item.oracleStable !== undefined) digest.oracleStable = item.oracleStable
  return digest
}

/**
 * Sérialise les preuves pour un prompt de juge, bornées en nombre et en volume.
 * Les mutations et vérifications priment sur les inspections quand il faut couper.
 */
export const serializeEvidenceForJudge = (
  evidence: readonly ExecutionEvidence[] | undefined
): string => {
  const items = evidence ?? []
  if (items.length === 0) return '[]'
  let kept = items
  let dropped = 0
  if (items.length > EVIDENCE_MAX_ITEMS) {
    const rank = (item: ExecutionEvidence): number =>
      item.kind === 'mutation' ? 0 : item.kind === 'verification' ? 1 : 2
    // Tri stable par intérêt, puis on coupe la queue la moins porteuse.
    kept = [...items].sort((a, b) => rank(a) - rank(b)).slice(0, EVIDENCE_MAX_ITEMS)
    dropped = items.length - kept.length
  }
  const payload = kept.map(evidenceForJudge)
  const serialized = JSON.stringify(payload)
  return dropped > 0 ? `${serialized}\n[${dropped} preuves de moindre portée omises]` : serialized
}
