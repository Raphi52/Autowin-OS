/**
 * Commande agent « sql_query » — consulter les bases RIG en LECTURE SEULE.
 *
 * Constaté le 2026-08-06 : à qui lui demandait de consulter `CODE_EVENEMENT_RCS`, l'agent répondait
 * « je n'ai aucun accès SQL » — exact, et la capacité n'existait pas. Elle existe maintenant, sous
 * garde stricte, parce que la connexion utilise le compte Windows de l'utilisateur, qui est
 * `db_datawriter` sur les bases de PRODUCTION des greffes (mesuré : UPDATE et DELETE autorisés).
 *
 * QUATRE COUCHES, et aucune ne suffit seule :
 *  1. le CATALOGUE — la cible doit être un greffe exploité selon `COMMUN_RIG.dbo.GREFFE`
 *     (`GRF_IS_EXPLOIT = 1`), et non un nom qui ressemble à un greffe (cf. `sql-read-catalog.ts`) ;
 *  2. `decideSqlRead` — un seul SELECT, aucun point-virgule, aucune directive sqlcmd, aucun mot-clé
 *     d'écriture, rien qui sorte de la base ciblée (cf. `sql-read-guard.ts`) ;
 *  3. l'enveloppe SQL — `BEGIN TRANSACTION` … `ROLLBACK` : même si une écriture passait, elle ne
 *     serait pas validée ;
 *  4. les bornes — `SET ROWCOUNT`, `SET LOCK_TIMEOUT`, délai de requête, délai process, plafond de
 *     sortie (cf. `sqlcmd-runner.ts`).
 */
import { decideSqlRead, type SqlReadArgs } from './sql-read-guard'
import { resolveSqlTargets, type CatalogDeps, type SqlTargetCatalog } from './sql-read-catalog'
import { runSqlcmdJson } from './sqlcmd-runner'

/** Assez pour constater une spécificité, trop peu pour aspirer une table. */
const DEFAULT_MAX_ROWS = 200
const MAX_ROWS_CAP = 1000

export type SqlReadOutcome =
  | {
      ok: true
      rows: Record<string, unknown>[]
      rowCount: number
      truncated: boolean
      summary: string
    }
  | { ok: false; reason: string }

export interface SqlReadCommandDeps extends CatalogDeps {
  maxRows?: number
  /** Catalogue déjà résolu. Injectable pour les tests, et pour éviter une résolution par appel. */
  catalog?: SqlTargetCatalog
}

/**
 * Construit l'enveloppe exécutée. Publique pour être TESTÉE : c'est elle qui garantit que rien ne
 * sera validé, et une régression silencieuse ici annulerait la couche 3.
 */
export function buildReadOnlyBatch(query: string, maxRows: number): string {
  return [
    'SET NOCOUNT ON',
    // La garde traite `"…"` comme un IDENTIFIANT délimité. Or sous `sqlcmd -Q`, QUOTED_IDENTIFIER est
    // OFF (mesuré : `SESSIONPROPERTY('QUOTED_IDENTIFIER')` = 0 sur RIG_AMIENS), donc `"…"` serait une
    // CHAÎNE. La sécurité tenait quand même — un contenu délimité est inerte dans les deux lectures —
    // mais elle tenait par accident, sur une prémisse fausse. On aligne le runtime sur le modèle de la
    // garde plutôt que de laisser une évolution future partir d'un raisonnement erroné (4ᵉ audit).
    'SET QUOTED_IDENTIFIER ON',
    // Ne jamais attendre derrière un verrou de production : on abandonne plutôt que de bloquer.
    'SET LOCK_TIMEOUT 5000',
    // Lectures non bloquantes : on ne pose pas de verrou partagé sur une base vivante.
    'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED',
    `SET ROWCOUNT ${maxRows}`,
    'BEGIN TRANSACTION',
    `${query} FOR JSON PATH, INCLUDE_NULL_VALUES`,
    // ROLLBACK inconditionnel : l'enveloppe ne peut RIEN valider, par construction.
    'ROLLBACK TRANSACTION',
    'SET ROWCOUNT 0'
  ].join(';\n')
}

/**
 * `FOR JSON PATH` est ajouté inconditionnellement à la requête, ce qui fait échouer deux formes
 * parfaitement légitimes — et `SELECT COUNT(*)` est la requête la plus naturelle qu'un agent écrive.
 * L'erreur de SQL Server est exacte mais opaque : on y ajoute la marche à suivre, pour que l'agent se
 * corrige du premier coup au lieu de brûler un aller-retour.
 */
function explainSqlError(detail: string): string {
  if (/\bMsg (?:13605|13600)\b/.test(detail)) {
    return `${detail} — la lecture est enveloppée dans FOR JSON : donne un alias à chaque colonne calculée, par exemple SELECT COUNT(*) AS n.`
  }
  if (/\bMsg 13601\b/.test(detail)) {
    return `${detail} — deux colonnes portent le même nom : donne un alias distinct à chacune plutôt qu’un SELECT *.`
  }
  return detail
}

export async function runSqlRead(
  args: SqlReadArgs,
  deps: SqlReadCommandDeps = {}
): Promise<SqlReadOutcome> {
  const catalogue = deps.catalog ?? (await resolveSqlTargets(deps))
  const decision = decideSqlRead(args, catalogue)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  const maxRows = Math.min(MAX_ROWS_CAP, Math.max(1, Math.trunc(deps.maxRows ?? DEFAULT_MAX_ROWS)))
  // On demande UNE ligne de plus que le plafond annoncé : c'est ce qui permet de distinguer un
  // résultat complet de exactement `maxRows` lignes d'un résultat réellement coupé. Sans ce +1, un
  // résultat complet de 200 lignes était annoncé « tronqué » et l'agent affinait une requête déjà
  // exhaustive (3ᵉ audit du 2026-08-07).
  const batch = buildReadOnlyBatch(decision.query, maxRows + 1)

  const resultat = await runSqlcmdJson(
    decision.server,
    decision.database,
    batch,
    deps,
    explainSqlError
  )
  if (!resultat.ok) return { ok: false, reason: resultat.reason }

  if (resultat.rows.length === 0) {
    return {
      ok: true,
      rows: [],
      rowCount: 0,
      truncated: false,
      summary: 'Aucune ligne : la requête est valide et ne ramène rien.'
    }
  }
  // La ligne excédentaire demandée plus haut ne sert qu'à DÉTECTER la coupure : on ne la rend pas.
  const truncated = resultat.rows.length > maxRows
  const visibles = truncated ? resultat.rows.slice(0, maxRows) : resultat.rows
  return {
    ok: true,
    rows: visibles,
    rowCount: visibles.length,
    truncated,
    summary: `${visibles.length} ligne(s) sur ${decision.database}@${decision.server}${
      truncated ? ` — plafond de ${maxRows} atteint, affine la requête` : ''
    }.`
  }
}
