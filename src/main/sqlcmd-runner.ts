/**
 * Exécuteur `sqlcmd` bas niveau — le SEUL endroit du code qui sait comment parler à sqlcmd.
 *
 * Pourquoi ce module existe séparément : deux appelants en ont besoin (la lecture demandée par
 * l'agent, et la résolution du catalogue des bases greffes), et chacune des options ci-dessous est la
 * conclusion d'un audit qui a coûté cher. Les dupliquer, c'est garantir qu'une copie divergera.
 *
 * POURQUOI LA SORTIE PASSE PAR UN FICHIER ET NON PAR LE PIPE — mesuré le 2026-08-07, et c'est la
 * preuve réelle qui l'a imposé CONTRE le raisonnement de l'audit, qui affirmait l'inverse.
 *
 *   pipe (stdout)             -> CP850 (codepage OEM console) : « é » = 0x82, « à » = 0x85
 *   pipe + `-f 65001`         -> INCHANGÉ, toujours CP850 (l'option ne vise que les fichiers)
 *   pipe + `-u`               -> INCHANGÉ
 *   `-o fichier`              -> CP1252
 *   `-o fichier` + `-u`       -> UTF-16LE avec BOM
 *   `-o fichier` + `-f 65001` -> UTF-8 avec BOM   <- le seul chemin explicitement Unicode
 *
 * Lu en UTF-8, le pipe rendait un U+FFFD par accent : « Adjonction d'activité » devenait
 * « Adjonction d'activit<>é » dans un JSON PARFAITEMENT VALIDE. L'agent recevait des libellés de
 * greffe corrompus sans aucune trace. Décoder le pipe en CP850 aurait « marché » sur ce poste, mais la
 * codepage OEM dépend de la machine : `-f 65001` est explicite et ne dépend d'aucune locale.
 *
 * Effet de bord assumé : le résultat touche brièvement le disque, dans le répertoire temporaire de
 * l'utilisateur. Le fichier est supprimé sur TOUS les chemins de sortie — `finish` est le seul point
 * de sortie, et c'est lui qui supprime.
 *
 * `shell: false` et arguments en TABLEAU : rien ne traverse un interpréteur de commandes.
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const OUTPUT_CODEPAGE = '65001'

/**
 * DEUX BINAIRES PORTENT LE NOM `sqlcmd`, et un seul connaît `-f`.
 *
 * DEFAUT VECU (conv-152, 2026-09-02) : le poste n'avait aucun sqlcmd. Une fois `go-sqlcmd`
 * installe (le portage moderne, distribue par Microsoft sous le nom `Microsoft.Sqlcmd`), CHAQUE
 * lecture echouait sur « Sqlcmd: 'f': Unknown Option » — l'option `-f 65001` n'existe QUE dans le
 * sqlcmd historique livre avec les outils ODBC. Le module etait ecrit pour cette seule variante.
 *
 * Retirer `-f` sans distinguer serait une regression : sur le sqlcmd HISTORIQUE, c'est le seul
 * chemin qui produise de l'Unicode explicite (cf. le tableau en tete de module), et sans lui les
 * accents reviennent en CP1252. On SONDE donc le binaire, une fois par chemin.
 *
 * Mesure du 2026-09-02 sur go-sqlcmd 1.10 : sans `-f`, `-o fichier` rend de l'UTF-8 SANS BOM, avec
 * les accents intacts (« Adjonction d'activité » relu exactement). L'option est donc inutile pour
 * cette variante, pas seulement tolerable.
 */
const supportF = new Map<string, boolean>()

export function sqlcmdSupporteOptionF(
  binaire: string,
  lanceur: typeof spawnSync = spawnSync
): boolean {
  const connu = supportF.get(binaire)
  if (connu !== undefined) return connu
  let supporte = true // en cas de doute on garde le comportement historique, jamais l'inverse
  try {
    const aide = lanceur(binaire, ['-?'], {
      encoding: 'utf8',
      windowsHide: true,
      shell: false,
      timeout: 5_000
    })
    const texte = `${aide.stdout ?? ''}${aide.stderr ?? ''}`
    // L'aide du sqlcmd historique liste « -f <codepage> ». go-sqlcmd ne mentionne jamais `-f`.
    if (texte.trim()) supporte = /(^|\s)-f\b/.test(texte)
  } catch {
    /* sonde impossible : on reste sur le comportement historique */
  }
  supportF.set(binaire, supporte)
  return supporte
}
/** Une lecture de paramétrage répond en moins d'une seconde ; au-delà, quelque chose déraille. */
const QUERY_TIMEOUT_SEC = 20
const PROCESS_TIMEOUT_MS = 30_000
/**
 * Plafond de sortie. Mesuré en OCTETS sur le fichier, donc exactement — et AVANT de le lire, si bien
 * qu'un résultat démesuré n'entre jamais en mémoire.
 */
const MAX_OUTPUT_BYTES = 400_000
/** Au-delà, un message d'erreur pollue le contexte du modèle sans rien lui apprendre de plus. */
const MAX_ERROR_DETAIL = 500

/** Accès au fichier de sortie, injectable pour tester sans toucher le disque. */
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

export interface SqlcmdDeps {
  spawnFn?: typeof spawn
  /** Chemin de sqlcmd. Absent = capacité non câblée. */
  sqlcmdPath?: string
  outputFile?: OutputFileAccess
  /** Chemin du fichier de sortie. Injectable pour rendre les tests déterministes. */
  outputPath?: string
}

export type SqlcmdOutcome =
  { ok: true; rows: Record<string, unknown>[] } | { ok: false; reason: string }

/**
 * Extrait les messages de SQL Server, OÙ QU'ILS SOIENT dans la sortie.
 *
 * Une erreur de COMPILATION arrive seule, en tête. Mais une erreur d'EXÉCUTION survient après que
 * SQL Server a déjà écrit une partie du JSON : le message est alors à la FIN. La version auditée ne
 * regardait que les 6 premières lignes, et comme `FOR JSON` replie la sortie tous les 2033
 * caractères, l'agent recevait « Requête refusée par SQL Server : [{"v":"AAAA… » — un refus sans
 * motif, plus 12 ko de JSON brut dans son contexte (4ᵉ audit du 2026-08-07).
 *
 * Le texte du message est sur la ligne SUIVANTE de l'en-tête `Msg …`, d'où la reprise par paires.
 */
export function extractSqlMessages(brut: string): string | undefined {
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
 * Trouve le début réel du JSON. On ne peut pas se fier au PREMIER crochet : un message
 * d'information de sqlcmd peut en contenir un, ce qui cassait le parsing (3ᵉ audit). On essaie donc
 * chaque début candidat et on garde le premier qui parse RÉELLEMENT.
 *
 * Recherche BORNÉE : la boucle est quadratique (chaque candidat déclenche un `JSON.parse` sur le
 * reste) et elle tourne dans le process principal d'Electron — une sortie riche en `{` gelait
 * l'interface plusieurs secondes. Le vrai début est de toute façon dans les premiers octets.
 */
function parseJsonRows(colle: string): {
  rows?: Record<string, unknown>[]
  candidats: number
} {
  let candidats = 0
  const zone = Math.min(colle.length, 2048)
  for (let i = 0; i < zone && candidats < 32; i += 1) {
    if (colle[i] !== '[' && colle[i] !== '{') continue
    candidats += 1
    try {
      const parsed: unknown = JSON.parse(colle.slice(i))
      return {
        rows: Array.isArray(parsed)
          ? (parsed as Record<string, unknown>[])
          : [parsed as Record<string, unknown>],
        candidats
      }
    } catch {
      // début candidat invalide : on tente le suivant
    }
  }
  return { candidats }
}

/**
 * Exécute un lot et rend les lignes de son `FOR JSON`. Un résultat VIDE est un succès à zéro ligne,
 * pas une erreur : `FOR JSON` ne produit rien quand il n'y a aucune ligne.
 *
 * `explain` permet à l'appelant d'enrichir un message d'erreur de SQL Server avec la marche à suivre,
 * sans que ce module ait à connaître le métier de l'appelant.
 */
export async function runSqlcmdJson(
  server: string,
  database: string,
  batch: string,
  deps: SqlcmdDeps = {},
  explain: (detail: string) => string = (d) => d
): Promise<SqlcmdOutcome> {
  if (!deps.sqlcmdPath) {
    return {
      ok: false,
      reason: 'Consultation SQL indisponible : sqlcmd n’est pas localisé sur ce poste.'
    }
  }
  const spawnFn = deps.spawnFn ?? spawn
  const fichier = deps.outputPath ?? join(tmpdir(), `autowin-sqlread-${randomUUID()}.json`)
  const sortie = deps.outputFile ?? REAL_OUTPUT_FILE

  return await new Promise<SqlcmdOutcome>((resolve) => {
    let stderr = ''
    let settled = false
    const timer: { handle?: ReturnType<typeof setTimeout> } = {}
    const finish = (outcome: SqlcmdOutcome): void => {
      if (settled) return
      settled = true
      if (timer.handle) clearTimeout(timer.handle)
      sortie.remove(fichier)
      resolve(outcome)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawnFn(
        deps.sqlcmdPath as string,
        [
          '-S',
          server,
          '-E', // authentification Windows intégrée : aucun secret ne transite
          '-d',
          database,
          // `-y 0` = largeur ILLIMITÉE, sans quoi sqlcmd tronque le JSON à 256 caractères. On ne peut
          // PAS y ajouter `-h -1` : sqlcmd refuse les deux ensemble (constaté en réel).
          '-y',
          '0',
          // CEINTURE contre le préprocesseur de sqlcmd, qui traite le lot ligne par ligne AVANT de
          // l'envoyer au moteur (2ᵉ audit) : `-X` désactive les commandes qui sortent de SQL (`:!!`
          // lance une commande OS), `-x` désactive la substitution `$(…)`. La bretelle est dans la
          // garde, qui refuse déjà `GO` et toute ligne commençant par `:`.
          '-X',
          '-x',
          // Sans `-b`, sqlcmd sort en code 0 MÊME sur « Invalid object name » : une requête cassée
          // était rendue comme « valide, aucune ligne » (3ᵉ audit).
          '-b',
          // Voir le commentaire en tête de module : `-o` + `-f 65001` est le SEUL chemin qui produise
          // de l'UTF-8. Sur le pipe, sqlcmd écrit la codepage OEM et les accents sont corrompus.
          '-f',
          OUTPUT_CODEPAGE,
          '-o',
          fichier,
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
      const octets = sortie.size(fichier)
      if (octets > MAX_OUTPUT_BYTES) {
        finish({
          ok: false,
          reason: `Résultat trop volumineux (${Math.round(octets / 1024)} ko) : il ne peut pas être rendu sans risque de fausser la donnée. Restreins les colonnes ou ajoute un filtre.`
        })
        return
      }
      let brut: string
      try {
        // `-f 65001` produit un BOM en tête : il n'appartient pas au contenu, et un JSON qui commence
        // par un BOM ne parse pas.
        brut = sortie
          .read(fichier)
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
      const messagesSql = extractSqlMessages(brut)
      // sqlcmd replie le JSON tous les 2033 caractères : on recolle avant de parser.
      const colle = brut.replace(/\r?\n/g, '')
      const { rows, candidats } = parseJsonRows(colle)

      // ORDRE DÉLIBÉRÉ. Une erreur d'exécution survient APRÈS que SQL Server a déjà écrit du JSON : il
      // peut donc y avoir à la fois du JSON parsable ET un message d'erreur. Le message gagne, car les
      // lignes déjà reçues sont un résultat PARTIEL qu'on ne doit pas faire passer pour complet.
      // Symétriquement, un résultat qui parse avec un code 0 n'est JAMAIS un refus : une valeur
      // contenant « Msg 208, Level 16 » juste après un pli ressemblait à une erreur (4ᵉ audit).
      if (code !== 0 || (messagesSql && !rows)) {
        const detail = messagesSql ?? stderr.trim()
        finish({
          ok: false,
          reason: `Requête refusée par SQL Server : ${explain(detail || `code ${code}`)}`
        })
        return
      }
      if (!rows && candidats === 0) {
        finish({ ok: true, rows: [] })
        return
      }
      if (!rows) {
        finish({
          ok: false,
          reason: `Réponse illisible de sqlcmd (JSON attendu) : ${colle.slice(0, 200)}`
        })
        return
      }
      finish({ ok: true, rows })
    })
  })
}
