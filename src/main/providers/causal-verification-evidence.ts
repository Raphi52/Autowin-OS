import type { ExecutionEvidence, TrustedLearningOracle } from './types'
import { isStrictlyReadOnlyCommand } from './evidence-vocabulary'

export function normalized(value: string): string {
  return value.replace(/\\/gu, '/').replace(/^\.\//u, '').toLowerCase()
}

function covered(path: string, pattern: string): boolean {
  const source = normalized(path)
  const selector = normalized(pattern)
  const escaped = selector.replace(/[.+^${}()|[\]\\]/gu, '\\$&')
  const expression = escaped
    .replace(/\*\*/gu, '\u{e000}')
    .replace(/\*/gu, '[^/]*')
    .replace(/\u{e000}/gu, '.*')
  return new RegExp(`^${expression}$`, 'u').test(source)
}

export function attributedPaths(item: ExecutionEvidence): string[] {
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
/**
 * L'ORACLE DONT LA COUVERTURE VIENT DE SES PROPRES ARGUMENTS.
 *
 * Une seule forme le justifie : `vitest related <chemins>` joue precisement les tests qui IMPORTENT
 * les fichiers nommes. Sa couverture se PROUVE donc en confrontant ses arguments aux chemins
 * reellement mutes, au lieu de se croire depuis une liste `covers`.
 *
 * MESURE qui a motive cette forme, le 2026-08-25 : mes trois oracles exigeaient la suite COMPLETE, or
 * elle depasse le plafond de 600 s de ce depot -- les agents lancent donc necessairement du cible, et
 * le cible n'obtenait aucune attestation. `causality-not-proven` restait alors le dernier motif de
 * blocage des lecons.
 *
 * DEUX GARDES, et la premiere est celle qui compte :
 *   - la couverture doit etre COMPLETE : si un seul chemin mute manque aux arguments, on refuse.
 *     Sinon un agent mutant deux fichiers et n'en verifiant qu'un obtiendrait une preuve causale pour
 *     du code que rien n'a exerce ;
 *   - la correspondance porte sur les PREMIERS SEGMENTS de la commande, jamais sur une sous-chaine :
 *     `vitest relatedxyz` ou un habillage quelconque ne passe pas.
 */
/** Les PREMIERS SEGMENTS correspondent-ils ? Jamais une sous-chaine : `relatedxyz` ne passe pas. */
function commencePar(declaree: string, recue: string): boolean {
  const attendus = declaree.split(' ').filter(Boolean)
  const recus = recue.split(' ').filter(Boolean)
  if (attendus.length === 0 || recus.length < attendus.length) return false
  return attendus.every((segment, index) => recus[index] === segment)
}

function couvreSesArguments(
  oracle: TrustedLearningOracle,
  command: string,
  mutationPaths: readonly string[]
): boolean {
  if (!commencePar(oracle.command, command)) return false
  const attendus = oracle.command.split(' ').filter(Boolean)
  const recus = command.split(' ').filter(Boolean)
  // Les arguments sont les segments qui ne sont pas des drapeaux : ce sont les chemins nommes.
  const arguments_ = new Set(
    recus.slice(attendus.length).filter((segment) => !segment.startsWith('-')).map(normalized)
  )
  if (arguments_.size === 0) return false
  return mutationPaths.every((path) => arguments_.has(normalized(path)))
}

/**
 * LA FENETRE CAUSALE, et pourquoi le veto ne porte plus sur le run entier.
 *
 * MESURE du 2026-09-12 sur `outcome-learning/events-v1.jsonl` : 1 820 verifications enregistrees,
 * ZERO `oracleAttestation`, et 51 decisions renvoyees en file d'attente avec le motif
 * `causality-not-proven`. La cause n'est pas qu'un agent trichait : une SEULE commande sans chemin
 * et hors allowlist stricte, n'importe OU dans le run, fermait le gate pour TOUT le run -- or
 * l'exploration qui PRECEDE le rouge (un `rg` avec un tube, un `git log | head`) en produit
 * toujours. La route `publish` etait donc structurellement morte.
 *
 * CE QUI EST RESTREINT, ET CE QUI NE L'EST PAS. Une commande qui s'execute AVANT le rouge ne peut
 * pas fabriquer le vert : si elle avait neutralise l'oracle, le rouge n'aurait pas echoue. C'est le
 * ROUGE lui-meme qui atteste l'etat sain de l'oracle a cet instant. Une commande post-verte, elle,
 * ne peut pas non plus fabriquer un vert deja observe. Tout ce qui vit ENTRE les deux reste
 * suspect, y compris avant la mutation : une alteration glissee entre le rouge et la mutation
 * fabrique bel et bien le vert, et ce cas reste refuse.
 *
 * SANS ROUGE NI VERT, AUCUNE RESTRICTION : un run qui n'a pas observe d'echec puis de succes n'a
 * aucun point d'ancrage temporel ; le veto porte alors sur le run entier, comme avant.
 */
function contientCommandeNonAttribuee(
  items: readonly ExecutionEvidence[],
  trustedOracles: readonly TrustedLearningOracle[]
): boolean {
  // Le classement lexical d'une commande ne prouve jamais qu'elle n'ecrit pas (`python -c`,
  // `node -e`, script maison). Toute commande sans chemin ferme donc le gate, sauf oracle exact ou
  // lecture appartenant a l'allowlist stricte. Le statut ne suffit pas : un exit non nul peut ecrire.
  return items.some(
    (item) =>
      Boolean(item.command) &&
      attributedPaths(item).length === 0 &&
      // Un oracle dont la portee vient de ses arguments ne peut pas etre reconnu par une egalite
      // exacte : sa commande porte des chemins. Sans cette branche, ce garde classait
      // `vitest related <chemin>` comme commande non attribuee et sortait AVANT toute attestation.
      !trustedOracles.some((oracle) =>
        oracle.couvreSesArguments
          ? commencePar(oracle.command, item.command?.replace(/\s+/gu, ' ').trim() ?? '')
          : oracle.command === item.command?.replace(/\s+/gu, ' ').trim()
      ) &&
      !isStrictlyReadOnlyCommand(item.command)
  )
}

export function attestIsolatedVerificationEvidence(
  evidence: ExecutionEvidence[],
  causallyIsolated: boolean,
  trustedOracles: readonly TrustedLearningOracle[] = []
): ExecutionEvidence[] {
  if (!causallyIsolated || trustedOracles.length === 0) return evidence
  const successfulMutations = evidence.filter((item) => item.kind === 'mutation' && item.ok)
  const rouge = evidence.findIndex(
    (item) => item.kind === 'verification' && !item.ok && Boolean(item.command)
  )
  const dernierVert = evidence.findLastIndex(
    (item) => item.kind === 'verification' && item.ok && Boolean(item.command)
  )
  // La FENETRE CAUSALE : du rouge qui ouvre la chaine au dernier vert qui la ferme. Hors de ces
  // bornes, aucune commande ne peut avoir fabrique le vert observe. Sans ces deux bornes, on
  // retombe sur le run entier.
  const fenetre =
    rouge >= 0 && dernierVert > rouge ? evidence.slice(rouge, dernierVert + 1) : evidence
  if (contientCommandeNonAttribuee(fenetre, trustedOracles)) return evidence
  const mutationPaths = [...new Set(successfulMutations.flatMap(attributedPaths))].sort()
  if (mutationPaths.length === 0) return evidence

  for (const item of evidence) {
    if (item.kind !== 'verification' || !item.command) continue
    const command = item.command.replace(/\s+/gu, ' ').trim()
    const oracle = trustedOracles.find(
      (candidate) =>
        (candidate.couvreSesArguments
          ? couvreSesArguments(candidate, command, mutationPaths)
          : candidate.command === command &&
            mutationPaths.every((path) =>
              candidate.covers.some((pattern) => covered(path, pattern))
            )) &&
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
