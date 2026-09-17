/**
 * Les actions faites par les utilisateurs d'un greffe — DÉCOUVERTE puis LECTURE.
 *
 * POURQUOI CE MODULE. Le chef de greffe veut voir ce que ses utilisateurs ont fait. Cette trace vit
 * dans la base du greffe, mais AUCUN nom de table n'est connu de ce dépôt : le produit RIG n'y est
 * pas (vérifié : `grep -rln greffe src/` ne remonte que les modules d'accès SQL). Deviner un nom
 * produirait un écran vide ; on DEMANDE donc à la base ce qu'elle contient (INFORMATION_SCHEMA),
 * puis on lit la table trouvée.
 *
 * Tout passe par `runSqlRead` : catalogue des greffes exploités, garde lecture seule, transaction
 * annulée, bornes. Ce module ne construit que des requêtes — il n'ouvre aucun accès nouveau.
 */

/** Une ligne d'INFORMATION_SCHEMA.COLUMNS, telle que la requête de découverte la renvoie. */
export interface LigneColonne {
  /** Schéma. */
  s: string
  /** Table. */
  t: string
  /** Colonne. */
  c: string
}

export interface SourceActions {
  schema: string
  table: string
  colonneUtilisateur: string
  colonneDate: string
  /** Absente quand la table ne nomme pas l'action : on affichera la table comme libellé. */
  colonneAction?: string
}

/** Un identifiant SQL simple, et rien d'autre : c'est ce qui rend l'interpolation sûre. */
const IDENTIFIANT = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * Requête FIXE : jamais influencée par l'utilisateur, et limitée aux noms de tables qui ressemblent
 * à un journal. Un seul SELECT, aucun point-virgule — la garde de lecture seule l'accepte telle
 * quelle (couvert par un test).
 */
export const REQUETE_TABLES_AUDIT = [
  'SELECT TABLE_SCHEMA AS s, TABLE_NAME AS t, COLUMN_NAME AS c',
  'FROM INFORMATION_SCHEMA.COLUMNS',
  "WHERE TABLE_NAME LIKE '%AUDIT%' OR TABLE_NAME LIKE '%TRACE%'",
  "OR TABLE_NAME LIKE '%JOURNAL%' OR TABLE_NAME LIKE '%HISTO%' OR TABLE_NAME LIKE '%LOG%'",
  'FOR JSON PATH'
].join(' ')

const MOTS_UTILISATEUR = ['UTILISATEUR', 'USER', 'UTIL', 'OPERATEUR', 'AGENT', 'LOGIN', 'MATRICULE']
const MOTS_DATE = ['DATE', 'DTE', 'HORO', 'STAMP', 'HEURE']
/**
 * fix-ok: sur la vraie base `RIG_DEV` (mesuré le 2026-09-17, sqlcmd code 0), la table retenue est
 * `dbo.AUDIT` et la colonne qui dit SUR QUOI porte l'action s'appelle `AUDIT_TABLE`. Aucun mot de
 * cette liste ne la reconnaissait : le widget affichait un libellé vide pour 100 % des lignes.
 * `TABLE` est donc un mot d'action légitime dans une table de trace — c'est l'objet modifié.
 */
const MOTS_ACTION = ['ACTION', 'LIBELLE', 'OPERATION', 'EVENEMENT', 'MESSAGE', 'TYPE', 'TABLE']

/** Plus le nom est explicite, plus la table est probablement LA trace métier attendue. */
const PRIORITE = ['AUDIT', 'TRACE', 'JOURNAL', 'HISTO', 'LOG']

const contient = (nom: string, mots: string[]): boolean =>
  mots.some((mot) => nom.toUpperCase().includes(mot))

const rang = (table: string): number => {
  const index = PRIORITE.findIndex((mot) => table.toUpperCase().includes(mot))
  return index === -1 ? PRIORITE.length : index
}

/**
 * La meilleure table candidate, ou `null` si aucune ne trace d'utilisateur.
 *
 * Une table de journal PUREMENT technique (date + message, sans qui) ne répond pas à la question
 * posée : on préfère le dire plutôt qu'afficher une liste qui ne parle de personne.
 */
export function choisirTableAudit(lignes: readonly LigneColonne[]): SourceActions | null {
  const parTable = new Map<string, LigneColonne[]>()
  for (const ligne of lignes) {
    if (!ligne?.t || !ligne?.c) continue
    const cle = `${ligne.s ?? 'dbo'}.${ligne.t}`
    parTable.set(cle, [...(parTable.get(cle) ?? []), ligne])
  }

  const candidates: SourceActions[] = []
  for (const colonnes of parTable.values()) {
    const utilisateur = colonnes.find((col) => contient(col.c, MOTS_UTILISATEUR))
    const date = colonnes.find((col) => contient(col.c, MOTS_DATE))
    if (!utilisateur || !date) continue
    // Un identifiant ne se lit pas : sur `dbo.AUDIT`, `AUDIT_ID_TABLE` précède alphabétiquement
    // `AUDIT_TABLE` et serait retenu le premier — le chef de greffe verrait des numéros au lieu
    // du nom de l'objet modifié. On écarte donc les colonnes de clé.
    const action = colonnes.find(
      (col) =>
        col !== utilisateur &&
        col !== date &&
        !/(^|_)ID(_|$)/i.test(col.c) &&
        contient(col.c, MOTS_ACTION)
    )
    candidates.push({
      schema: utilisateur.s ?? 'dbo',
      table: utilisateur.t,
      colonneUtilisateur: utilisateur.c,
      colonneDate: date.c,
      ...(action ? { colonneAction: action.c } : {})
    })
  }

  candidates.sort((a, b) => rang(a.table) - rang(b.table) || a.table.localeCompare(b.table))
  return candidates[0] ?? null
}

const crochets = (nom: string): string => {
  if (!IDENTIFIANT.test(nom)) {
    throw new Error(`Nom SQL refusé : « ${nom} » n'est pas un identifiant simple.`)
  }
  return `[${nom}]`
}

/** La lecture elle-même : les N dernières actions, du plus récent au plus ancien. */
export function construireRequeteActions(source: SourceActions, limite: number): string {
  const n = Math.min(500, Math.max(1, Math.trunc(limite)))
  const colonnes = [
    `${crochets(source.colonneUtilisateur)} AS utilisateur`,
    `${crochets(source.colonneDate)} AS quand`,
    source.colonneAction ? `${crochets(source.colonneAction)} AS action` : `'' AS action`
  ].join(', ')
  return [
    `SELECT TOP ${n} ${colonnes}`,
    `FROM ${crochets(source.schema)}.${crochets(source.table)}`,
    `ORDER BY ${crochets(source.colonneDate)} DESC`,
    'FOR JSON PATH'
  ].join(' ')
}

/** Une action telle que le widget l'affiche. */
export interface ActionUtilisateur {
  utilisateur: string
  /** Horodatage brut de la base : le rendu décide du format. */
  quand: string
  action: string
}

export type ResultatActions =
  | { ok: true; greffe: string; source: SourceActions; actions: ActionUtilisateur[] }
  | { ok: false; raison: string }

type LecteurSql = (args: { server: string; database: string; query: string }) => Promise<
  | {
      ok: true
      rows: Record<string, unknown>[]
      rowCount: number
      truncated: boolean
      summary: string
    }
  | { ok: false; reason: string }
>

const texte = (valeur: unknown): string =>
  valeur === null || valeur === undefined ? '' : String(valeur)

/**
 * Les dernières actions des utilisateurs d'un greffe : on découvre la table, puis on la lit.
 *
 * Aucun repli silencieux — quand la base ne trace personne, on le DIT. Un widget vide qui ne dit pas
 * pourquoi ferait croire au chef de greffe que ses utilisateurs n'ont rien fait.
 */
export async function lireActionsGreffe(
  cible: { server: string; database: string },
  limite: number,
  deps: { runSqlRead: LecteurSql }
): Promise<ResultatActions> {
  const decouverte = await deps.runSqlRead({ ...cible, query: REQUETE_TABLES_AUDIT })
  if (!decouverte.ok) return { ok: false, raison: decouverte.reason }

  const source = choisirTableAudit(decouverte.rows as unknown as LigneColonne[])
  if (!source) {
    return {
      ok: false,
      raison: `Aucune table de trace avec un utilisateur et une date dans ${cible.database}.`
    }
  }

  const lecture = await deps.runSqlRead({
    ...cible,
    query: construireRequeteActions(source, limite)
  })
  if (!lecture.ok) return { ok: false, raison: lecture.reason }

  return {
    ok: true,
    greffe: cible.database,
    source,
    actions: lecture.rows.map((ligne) => ({
      utilisateur: texte(ligne.utilisateur),
      quand: texte(ligne.quand),
      action: texte(ligne.action) || source.table
    }))
  }
}
