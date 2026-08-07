/**
 * Commande agent « sql_query » — consulter les bases RIG en LECTURE SEULE.
 *
 * Constaté le 2026-08-06 : à qui lui demandait de consulter `CODE_EVENEMENT_RCS`, l'agent répondait
 * « je n'ai aucun accès SQL » — exact, et la capacité n'existait pas. Elle existe maintenant, sous
 * garde stricte, parce que la connexion utilise le compte Windows de l'utilisateur, qui est
 * `db_datawriter` sur les bases de PRODUCTION des greffes (mesuré : UPDATE et DELETE autorisés).
 *
 * QUATRE COUCHES, et aucune ne suffit seule :
 *  1. `decideSqlRead` — un seul SELECT, aucun point-virgule, aucun commentaire, aucun mot-clé
 *     d'écriture, cible dans la liste blanche (cf. `sql-read-guard.ts`) ;
 *  2. l'enveloppe SQL — `BEGIN TRANSACTION` … `ROLLBACK` : même si une écriture passait, elle ne
 *     serait pas validée ;
 *  3. les bornes serveur — `SET ROWCOUNT`, `SET LOCK_TIMEOUT`, délai de requête `sqlcmd` ;
 *  4. la borne process — le fils est tué au-delà du délai, et sa sortie est plafonnée.
 *
 * `shell: false` et arguments en TABLEAU : rien ne traverse un interpréteur de commandes.
 */
import { spawn } from 'node:child_process'
import { decideSqlRead, RIG_SQL_SERVERS, type SqlReadArgs } from './sql-read-guard'

/** Assez pour constater une spécificité, trop peu pour aspirer une table. */
const DEFAULT_MAX_ROWS = 200
const MAX_ROWS_CAP = 1000
/** Une lecture de paramétrage répond en moins d'une seconde ; au-delà, quelque chose déraille. */
const QUERY_TIMEOUT_SEC = 20
const PROCESS_TIMEOUT_MS = 30_000
/** Plafond de sortie : une requête trop bavarde ne doit pas noyer le contexte du modèle. */
const MAX_OUTPUT_BYTES = 400_000

export type SqlReadOutcome =
  | { ok: true; rows: Record<string, unknown>[]; rowCount: number; truncated: boolean; summary: string }
  | { ok: false; reason: string }

export interface SqlReadCommandDeps {
  spawnFn?: typeof spawn
  /** Chemin de sqlcmd. Injectable en test ; absent = capacité non câblée. */
  sqlcmdPath?: string
  maxRows?: number
}

/**
 * Construit l'enveloppe exécutée. Publique pour être TESTÉE : c'est elle qui garantit que rien ne
 * sera validé, et une régression silencieuse ici annulerait la couche 2.
 */
export function buildReadOnlyBatch(query: string, maxRows: number): string {
  return [
    'SET NOCOUNT ON',
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

export async function runSqlRead(
  args: SqlReadArgs,
  deps: SqlReadCommandDeps = {}
): Promise<SqlReadOutcome> {
  const decision = decideSqlRead(args)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  if (!deps.sqlcmdPath) {
    return {
      ok: false,
      reason: 'Consultation SQL indisponible : sqlcmd n’est pas localisé sur ce poste.'
    }
  }
  const maxRows = Math.min(MAX_ROWS_CAP, Math.max(1, Math.trunc(deps.maxRows ?? DEFAULT_MAX_ROWS)))
  const batch = buildReadOnlyBatch(decision.query, maxRows)
  const spawnFn = deps.spawnFn ?? spawn

  return await new Promise<SqlReadOutcome>((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const timer: { handle?: ReturnType<typeof setTimeout> } = {}
    const finish = (outcome: SqlReadOutcome): void => {
      if (settled) return
      settled = true
      if (timer.handle) clearTimeout(timer.handle)
      resolve(outcome)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(
        deps.sqlcmdPath as string,
        [
          '-S', decision.server,
          '-E', // authentification Windows intégrée : aucun secret ne transite
          '-d', decision.database,
          // `-y 0` = largeur ILLIMITÉE, sans quoi sqlcmd tronque le JSON à 256 caractères. On ne peut
          // PAS y ajouter `-h -1` : sqlcmd refuse les deux ensemble (« mutually exclusive », constaté
          // en réel). L'en-tête de colonne est donc présent, et c'est le parseur qui l'ignore.
          '-y', '0',
          '-t', String(QUERY_TIMEOUT_SEC),
          '-l', '10',
          '-Q', batch
        ],
        { windowsHide: true, shell: false }
      )
    } catch (error) {
      finish({
        ok: false,
        reason: `Lancement de sqlcmd impossible : ${
          error instanceof Error ? error.message : String(error)
        }`
      })
      return
    }

    timer.handle = setTimeout(() => {
      child.kill()
      finish({ ok: false, reason: `Requête abandonnée après ${PROCESS_TIMEOUT_MS / 1000} s.` })
    }, PROCESS_TIMEOUT_MS)

    child.stdout?.on('data', (c: Buffer | string) => {
      if (stdout.length < MAX_OUTPUT_BYTES) stdout += String(c)
    })
    child.stderr?.on('data', (c: Buffer | string) => {
      if (stderr.length < 8000) stderr += String(c)
    })
    child.once('error', (error) =>
      finish({ ok: false, reason: `sqlcmd a échoué : ${error.message}` })
    )
    child.once('close', (code) => {
      const brut = stdout.trim()
      // Un message d'erreur SQL Server arrive sur stdout ET code ≠ 0 : on le rend TEL QUEL, c'est
      // l'information utile (objet inconnu, colonne inexistante, droits refusés…).
      if (code !== 0) {
        const detail = (stderr.trim() || brut || `code ${code}`).split('\n').slice(0, 6).join(' ')
        finish({ ok: false, reason: `Requête refusée par SQL Server : ${detail}` })
        return
      }
      // sqlcmd préfixe la sortie de l'en-tête de colonne (le GUID que SQL Server donne au résultat
      // `FOR JSON`) : on repart du premier caractère JSON réel. Voir le commentaire sur `-y 0`.
      const debut = brut.search(/[[{]/)
      const utile = debut >= 0 ? brut.slice(debut) : ''
      // `FOR JSON` sans ligne ne rend RIEN : c'est un résultat vide, pas une erreur.
      if (!utile) {
        finish({
          ok: true,
          rows: [],
          rowCount: 0,
          truncated: false,
          summary: 'Aucune ligne : la requête est valide et ne ramène rien.'
        })
        return
      }
      // sqlcmd peut replier le JSON sur plusieurs lignes : on les recolle avant de parser.
      let rows: Record<string, unknown>[]
      try {
        const parsed = JSON.parse(utile.replace(/\r?\n/g, ''))
        rows = Array.isArray(parsed) ? parsed : [parsed]
      } catch {
        finish({
          ok: false,
          reason: `Réponse illisible de sqlcmd (JSON attendu) : ${utile.slice(0, 200)}`
        })
        return
      }
      const truncated = rows.length >= maxRows
      finish({
        ok: true,
        rows,
        rowCount: rows.length,
        truncated,
        summary: `${rows.length} ligne(s) sur ${decision.database}@${decision.server}${
          truncated ? ` — plafond de ${maxRows} atteint, affine la requête` : ''
        }.`
      })
    })
  })
}

export { RIG_SQL_SERVERS }
