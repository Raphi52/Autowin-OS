import type { ExecutionEvidence, TrustedLearningOracle } from './types'
import { isStrictlyReadOnlyCommand } from './evidence-vocabulary'

function normalized(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').toLowerCase()
}

function covered(path: string, pattern: string): boolean {
  const source = normalized(path)
  const selector = normalized(pattern)
  const escaped = selector.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  const expression = escaped
    .replace(/\*\*/gu, '\u0000')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u0000/gu, '.*')
  return new RegExp(`^${expression}$`, 'u').test(source)
}

function attributedPaths(item: ExecutionEvidence): string[] {
  return [
    item.path,
    ...(item.paths ?? []),
    ...Object.keys(item.pathFingerprints ?? {}),
    ...Object.keys(item.writtenLineFingerprintsByPath ?? {})
  ].filter((path): path is string => typeof path === 'string' && path.trim().length > 0)
}

/**
 * Lie les oracles reproductibles aux mutations observées par le contrôleur dans une copie isolée.
 * Le modèle ne peut pas poser ces attributs lui-même : ils ne sont ajoutés qu'après le run, depuis
 * les événements outils et le snapshot filesystem produits par l'adaptateur.
 */
export function attestIsolatedVerificationEvidence(
  evidence: ExecutionEvidence[],
  causallyIsolated: boolean,
  trustedOracles: readonly TrustedLearningOracle[] = []
): ExecutionEvidence[] {
  if (!causallyIsolated || trustedOracles.length === 0) return evidence
  const successfulMutations = evidence.filter((item) => item.kind === 'mutation' && item.ok)
  // Le classement lexical d'une commande ne prouve jamais qu'elle n'écrit pas (`python -c`,
  // `node -e`, script maison). Toute commande sans chemin ferme donc le gate, sauf oracle exact ou
  // lecture appartenant à l'allowlist stricte. Le statut ne suffit pas : un exit non nul peut écrire.
  const hasUntrustedUnattributedCommand = evidence.some(
    (item) =>
      Boolean(item.command) &&
      attributedPaths(item).length === 0 &&
      !trustedOracles.some(
        (oracle) => oracle.command === item.command?.replace(/\s+/gu, ' ').trim()
      ) &&
      !isStrictlyReadOnlyCommand(item.command)
  )
  if (hasUntrustedUnattributedCommand) return evidence
  const mutationPaths = [...new Set(successfulMutations.flatMap(attributedPaths))].sort()
  if (mutationPaths.length === 0) return evidence

  for (const item of evidence) {
    if (item.kind !== 'verification' || !item.command) continue
    const command = item.command.replace(/\s+/gu, ' ').trim()
    const oracle = trustedOracles.find(
      (candidate) =>
        candidate.command === command &&
        mutationPaths.every((path) => candidate.covers.some((pattern) => covered(path, pattern))) &&
        mutationPaths.every(
          (path) =>
            !candidate.attestedFiles.some((attested) => normalized(attested) === normalized(path))
        )
    )
    if (!oracle) continue
    item.oracleStable = true
    item.oracleAttestation = oracle.attestation
    item.paths = [...new Set([...(item.paths ?? []), ...mutationPaths])].sort()
  }
  return evidence
}
