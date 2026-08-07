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
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decideSqlRead, RIG_SQL_SERVERS, type SqlReadArgs } from './sql-read-guard'

/**
 * POURQUOI LA SORTIE PASSE PAR UN FICHIER ET NON PAR LE PIPE — mesuré le 2026-08-07, et c'est la
 * preuve réelle qui l'a imposé contre le raisonnement de l'audit, qui affirmait l'inverse.
 *
 * Encodage réellement produit par sqlcmd, selon le chemin de sortie :
 *
 *   pipe (stdout)          -> CP850 (codepage OEM console) : « é » = 0x82, « à » = 0x85
 *   pipe + `-f 65001`      -> INCHANGÉ, toujours CP850 (l'option ne vise que les fichiers)
 *   pipe + `-u`            -> INCHANGÉ
 *   `-o fichier`           -> CP1252
 *   `-o fichier` + `-u`    -> UTF-16LE avec BOM
 *   `-o fichier` + `-f 65001` -> UTF-8 avec BOM   <- le seul chemin explicitement Unicode
 *
 * Lu en UTF-8, le pipe rendait donc un U+FFFD par accent : « Adjonction d'activité » devenait
 * « Adjonction d'activit<>é » dans un JSON PARFAITEMENT VALIDE. L'agent recevait des libellés de
 * greffe corrompus sans aucune trace. Décoder le pipe en CP850 aurait « marché » sur ce poste, mais la
 * codepage OEM dépend de la machine : `-f 65001` est explicite et ne dépend d'aucune locale.
 *
 * Effet de bord assumé : le résultat touche brièvement le disque, dans le répertoire temporaire de
 * l'utilisateur. Le fichier est supprimé sur TOUS les chemins de sortie, y compris expiration et
 * erreur de lancement — la suppression est faite par `finish`, qui est le seul point de sortie.
 */
const OUTPUT_CODEPAGE = '65001'

/** Accès au fichier de sortie, injectable pour les tests. */
export interface OutputFileAccess {
  size: (path: string) => number
  read: (path: string) => string
  remove: (path: string) => void
}

const REAL_OUTPUT_FILE: OutputFileAccess = {
  size: (path) => {
    try {
      return statSync(path).size
    } catch {
      return 0
    }
  },
  read: (path) => readFileSync(path, 'utf8'),
  remove: (path) => {
    try {
      rmSync(path, { force: true })
    } catch {
      // Un fichier déjà disparu n'est pas une erreur : l'objectif est qu'il ne reste pas.
    }
  }
}

/** Assez pour constater une spécificité, trop peu pour aspirer une table. */
const DEFAULT_MAX_ROWS = 200
const MAX_ROWS_CAP = 1000
/** Une lecture de paramétrage répond en moins d'une seconde ; au-delà, quelque chose déraille. */
const QUERY_TIMEOUT_SEC = 20
const PROCESS_TIMEOUT_MS = 30_000
/**
 * Plafond de sortie : une requête trop bavarde ne doit pas noyer le contexte du modèle. Mesuré en
 * OCTETS sur le fichier de sortie, donc exactement — et AVANT de le lire, si bien qu'un résultat
 * démesuré n'entre jamais en mémoire.
 */
const MAX_OUTPUT_BYTES = 400_000

export type SqlReadOutcome =
  | {
      ok: true
      rows: Record<string, unknown>[]
      rowCount: number
      truncated: boolean
      summary: string
    }
  | { ok: false; reason: string }

export interface SqlReadCommandDeps {
  spawnFn?: typeof spawn
  /** Chemin de sqlcmd. Injectable en test ; absent = capacité non câblée. */
  sqlcmdPath?: string
  maxRows?: number
  /** Accès au fichier de sortie. Injectable pour tester sans toucher le disque. */
  outputFile?: OutputFileAccess
  /** Chemin du fichier de sortie. Injectable pour rendre les tests déterministes. */
  outputPath?: string
}

/**
 * Construit l'enveloppe exécutée. Publique pour être TESTÉE : c'est elle qui garantit que rien ne
 * sera validé, et une régression silencieuse ici annulerait la couche 2.
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

/** Longueur maximale du motif d'erreur rendu à l'agent : au-delà, on pollue son contexte pour rien. */
const MAX_ERROR_DETAIL = 500

/**
 * Extrait les messages de SQL Server, OÙ QU'ILS SOIENT dans la sortie.
 *
 * Une erreur de COMPILATION arrive seule, en tête. Mais une erreur d'EXÉCUTION survient après que
 * SQL Server a déjà streamé une partie du JSON : le message est alors à la FIN. La version auditée
 * ne regardait que les 6 premières lignes, et comme `FOR JSON` replie la sortie tous les 2033
 * caractères, l'agent recevait « Requête refusée par SQL Server : [{"v":"AAAA… » — un refus sans
 * motif, plus 12 ko de JSON brut dans son contexte (4ᵉ audit du 2026-08-07).
 *
 * Le texte du message est sur la ligne SUIVANTE de l'en-tête `Msg …`, d'où la reprise par paires.
 */
function extraireMessagesSql(brut: string): string | undefined {
  const lignes = brut.split('\n')
  const retenues: string[] = []
  for (let i = 0; i < lignes.length; i += 1) {
    if (!/^Msg \d+, Level \d+/.test(lignes[i])) continue
    retenues.push(lignes[i].trim())
    if (lignes[i + 1] !== undefined && !/^Msg \d+, Level \d+/.test(lignes[i + 1])) {
      retenues.push(lignes[i + 1].trim())
    }
  }
  if (retenues.length === 0) return undefined
  return retenues.join(' ').slice(0, MAX_ERROR_DETAIL)
}

/**
 * `FOR JSON PATH` est ajouté inconditionnellement à la requête, ce qui fait échouer deux formes
 * parfaitement légitimes — et `SELECT COUNT(*)` est la requête la plus naturelle qu'un agent écrive.
 * L'erreur de SQL Server est exacte mais opaque : on y ajoute la marche à suivre, pour que l'agent
 * se corrige du premier coup au lieu de brûler un aller-retour.
 */
function expliquer(detail: string): string {
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
  const decision = decideSqlRead(args)
  if (!decision.allowed) return { ok: false, reason: decision.reason }

  if (!deps.sqlcmdPath) {
    return {
      ok: false,
      reason: 'Consultation SQL indisponible : sqlcmd n’est pas localisé sur ce poste.'
    }
  }
  const maxRows = Math.min(MAX_ROWS_CAP, Math.max(1, Math.trunc(deps.maxRows ?? DEFAULT_MAX_ROWS)))
  // On demande UNE ligne de plus que le plafond annoncé : c'est ce qui permet de distinguer un
  // résultat complet de exactement `maxRows` lignes d'un résultat réellement coupé. Sans ce +1, un
  // résultat complet de 200 lignes était annoncé « tronqué » et l'agent affinait une requête déjà
  // exhaustive (défaut relevé à l'audit du 2026-08-07).
  const batch = buildReadOnlyBatch(decision.query, maxRows + 1)
  const spawnFn = deps.spawnFn ?? spawn

  const fichierSortie = deps.outputPath ?? join(tmpdir(), `autowin-sqlread-${randomUUID()}.json`)
  const sortie = deps.outputFile ?? REAL_OUTPUT_FILE

  return await new Promise<SqlReadOutcome>((resolve) => {
    let stderr = ''
    let settled = false
    const timer: { handle?: ReturnType<typeof setTimeout> } = {}
    // `finish` est le SEUL point de sortie, et c'est lui qui supprime le fichier : expiration, erreur
    // de lancement, refus ou succès, le résultat ne reste jamais sur le disque.
    const finish = (outcome: SqlReadOutcome): void => {
      if (settled) return
      settled = true
      if (timer.handle) clearTimeout(timer.handle)
      sortie.remove(fichierSortie)
      resolve(outcome)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(
        deps.sqlcmdPath as string,
        [
          '-S',
          decision.server,
          '-E', // authentification Windows intégrée : aucun secret ne transite
          '-d',
          decision.database,
          // `-y 0` = largeur ILLIMITÉE, sans quoi sqlcmd tronque le JSON à 256 caractères. On ne peut
          // PAS y ajouter `-h -1` : sqlcmd refuse les deux ensemble (« mutually exclusive », constaté
          // en réel). L'en-tête de colonne est donc présent, et c'est le parseur qui l'ignore.
          '-y',
          '0',
          // CEINTURE contre le préprocesseur de sqlcmd, qui traite le texte du lot ligne par ligne
          // AVANT de l'envoyer au moteur (second audit du 2026-08-07) :
          //   -X désactive les commandes qui sortent de SQL (`:!!` lance une commande OS, `ED`),
          //   -x désactive la substitution de variables `$(…)`.
          // La bretelle est dans la garde, qui refuse déjà `GO` et toute ligne commençant par `:`.
          // On veut les deux : ne dépendre ni d'une analyse lexicale seule, ni d'un drapeau seul.
          '-X',
          '-x',
          // Sans `-b`, sqlcmd sort en code 0 MÊME sur « Invalid object name » : la commande rendait
          // alors « la requête est valide et ne ramène rien » (3ᵉ audit du 2026-08-07). Un agent qui
          // vérifie un état en base concluait « rien » sur une requête cassée. Le message est aussi
          // détecté sur la sortie, plus bas : on ne dépend pas du seul code de retour.
          '-b',
          // Sortie vers un FICHIER en UTF-8 explicite. Sur le pipe, sqlcmd écrit la codepage OEM
          // (CP850 ici : « é » = 0x82), ce qui rendait un U+FFFD par accent dans un JSON pourtant
          // VALIDE — donc des libellés de greffe corrompus sans aucune trace. `-f 65001` ne vise que
          // les fichiers : c'est `-o` + `-f` ensemble qui donnent de l'UTF-8, et rien d'autre.
          // Mesuré le 2026-08-07 ; voir le commentaire en tête de module pour le tableau complet.
          '-f',
          OUTPUT_CODEPAGE,
          '-o',
          fichierSortie,
          '-t',
          String(QUERY_TIMEOUT_SEC),
          '-l',
          '10',
          '-Q',
          batch
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

    // Avec `-o`, tout part dans le fichier : le pipe ne sert plus qu'aux pannes de sqlcmd lui-même
    // (mesuré : sur erreur SQL, stdout et stderr sont VIDES et le message est dans le fichier).
    child.stderr?.setEncoding('utf8')
    child.stderr?.on('data', (c: Buffer | string) => {
      if (stderr.length < 8000) stderr += String(c)
    })
    child.once('error', (error) =>
      finish({ ok: false, reason: `sqlcmd a échoué : ${error.message}` })
    )
    child.once('close', (code) => {
      // Plafond vérifié AVANT la lecture, sur la taille réelle du fichier : un résultat démesuré
      // n'entre jamais en mémoire, et on ne rend pas un JSON coupé qui se reparserait en donnée FAUSSE.
      const octets = sortie.size(fichierSortie)
      if (octets > MAX_OUTPUT_BYTES) {
        finish({
          ok: false,
          reason: `Résultat trop volumineux (${Math.round(octets / 1024)} ko) : il ne peut pas être rendu sans risque de fausser la donnée. Restreins les colonnes ou ajoute un filtre.`
        })
        return
      }
      let brut: string
      try {
        // `-f 65001` produit un BOM en tête : on le retire, il n'appartient pas au contenu.
        brut = sortie
          .read(fichierSortie)
          .replace(/^\uFEFF/, '')
          .trim()
      } catch (error) {
        finish({
          ok: false,
          reason: `Sortie de sqlcmd illisible : ${
            error instanceof Error ? error.message : String(error)
          }${stderr.trim() ? ` — ${stderr.trim().slice(0, 200)}` : ''}`
        })
        return
      }
      const messagesSql = extraireMessagesSql(brut)
      const colle = brut.replace(/\r?\n/g, '')
      let rows: Record<string, unknown>[] | undefined
      let candidats = 0
      // Recherche BORNÉE. La boucle est quadratique (chaque candidat déclenche un `JSON.parse` sur
      // le reste), et elle tourne dans le process principal d'Electron : une sortie riche en `{`
      // gelait l'interface plusieurs secondes (3ᵉ audit). Le vrai début du JSON est de toute façon
      // dans les premiers octets, juste après l'en-tête de colonne de sqlcmd.
      const zoneDeRecherche = Math.min(colle.length, 2048)
      for (let i = 0; i < zoneDeRecherche && !rows && candidats < 32; i += 1) {
        if (colle[i] !== '[' && colle[i] !== '{') continue
        candidats += 1
        try {
          const parsed: unknown = JSON.parse(colle.slice(i))
          rows = Array.isArray(parsed)
            ? (parsed as Record<string, unknown>[])
            : [parsed as Record<string, unknown>]
        } catch {
          // début candidat invalide : on tente le suivant
        }
      }
      // ORDRE DÉLIBÉRÉ. Une erreur d'exécution survient APRÈS que SQL Server a déjà streamé du JSON :
      // il peut donc y avoir à la fois du JSON parsable ET un message d'erreur. Le message gagne, car
      // les lignes déjà reçues sont un résultat PARTIEL qu'on ne doit pas faire passer pour complet.
      if (code !== 0 || (messagesSql && !rows)) {
        const detail = messagesSql ?? stderr.trim() ?? ''
        finish({
          ok: false,
          reason: `Requête refusée par SQL Server : ${expliquer(detail || `code ${code}`)}`
        })
        return
      }
      // fix-ok: suppression d'un contrôle DEVENU MORT (pas un correctif à l'aveugle) — le plafond est
      // désormais vérifié plus haut sur la TAILLE du fichier, donc avant lecture et exactement.
      // L'ancien drapeau de coupure par chunk n'a plus d'objet : il n'y a plus de chunks.
      // `FOR JSON` sans ligne ne rend RIEN : c'est un résultat vide, pas une erreur.
      if (!rows && candidats === 0) {
        finish({
          ok: true,
          rows: [],
          rowCount: 0,
          truncated: false,
          summary: 'Aucune ligne : la requête est valide et ne ramène rien.'
        })
        return
      }
      if (!rows) {
        finish({
          ok: false,
          reason: `Réponse illisible de sqlcmd (JSON attendu) : ${colle.slice(0, 200)}`
        })
        return
      }
      // La ligne excédentaire demandée plus haut ne sert qu'à DÉTECTER la coupure : on ne la rend pas.
      const truncated = rows.length > maxRows
      const visibles = truncated ? rows.slice(0, maxRows) : rows
      finish({
        ok: true,
        rows: visibles,
        rowCount: visibles.length,
        truncated,
        summary: `${visibles.length} ligne(s) sur ${decision.database}@${decision.server}${
          truncated ? ` — plafond de ${maxRows} atteint, affine la requête` : ''
        }.`
      })
    })
  })
}

export { RIG_SQL_SERVERS }
