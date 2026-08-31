/**
 * Un groupe d'actions a-t-il quelque chose a montrer DANS Workflows ?
 *
 * Constate en usage reel (2026-07-29) : sur « 1 action terminee · 1 action en cours — edit_file ·
 * verify », cliquer le bloc n'affichait RIEN. Cause : le bloc renvoie vers Workflows, mais seule une
 * ORCHESTRATION y produit une carte (`liveRunCardRef` n'est attache qu'aux runs). Les commandes
 * locales livrees le meme jour — `edit_file`, `verify`, `brain_query` — ne creent aucun run : le
 * scroll visait donc un element inexistant.
 *
 * Un bouton qui promet ce qu'il ne peut pas tenir est pire qu'un bloc inerte : l'utilisateur clique,
 * rien ne bouge, et il ne sait pas si c'est casse ou si c'est lui. D'ou cette decision explicite —
 * s'il n'y a pas de run, le detail doit s'afficher SUR PLACE, pas ailleurs.
 */

import { sansSequencesAnsi } from '../../../shared/ansi'

/** Commandes qui produisent un run consultable dans Workflows. */
const RUN_PRODUCING = new Set(['orchestrate'])

export interface ActionLike {
  name: string
  ok?: boolean
  interrupted?: boolean
  data?: unknown
  /**
   * CE QUI A ETE DEMANDE. Retour du 2026-08-31 : « je sais meme pas quelle file a ete lu ». Le
   * resultat seul ne dit pas la CIBLE — un `read_file` rend un contenu, pas le chemin ; un
   * `find_in_files` rend des correspondances, pas le motif. Les arguments sont donc la premiere
   * ligne du deplie.
   */
  args?: unknown
}

/** Vrai si AU MOINS une action du groupe a produit (ou produit) un run consultable. */
export function hasConsultableRun(actions: readonly ActionLike[]): boolean {
  return actions.some((action) => {
    if (RUN_PRODUCING.has(action.name)) return true
    // Repli robuste : une action qui porte une reference de run est consultable, quel que soit son nom.
    const data = action.data
    if (!data || typeof data !== 'object') return false
    const reference = data as { runPath?: unknown; runId?: unknown }
    return typeof reference.runPath === 'string' || typeof reference.runId === 'string'
  })
}

/** Detail lisible d'une action LOCALE, a montrer dans le fil faute de run. */
export interface LocalActionDetail {
  name: string
  /** Diff d'une edition, sortie d'une verification, ou raison d'un refus. */
  text: string
  ok: boolean
}

/** Au-dela, on ne lit plus : on noie. Mesure reelle sur une sortie de suite complete : 187 000 car. */
const MAX_DETAIL_CHARS = 3_000

/**
 * Lignes qui PORTENT l'echec. Tout le reste d'une sortie de suite — les tests verts, les compteurs
 * de duree, les journaux d'etape — enterre le signal sous des milliers de lignes.
 */
const LIGNE_UTILE =
  /(^|\s)(FAIL|×|✗|AssertionError|TypeError|RangeError|ReferenceError|SyntaxError|Error:|Expected|Received|\d+\s+failed)/u

/** Une ligne de SUCCES ne dit rien d'un echec : elle n'a rien a faire dans le resume. */
const LIGNE_VERTE = /(^|\s)(✓|OK\s|passed\b|TOUS VERTS)/u

/**
 * Resume lisible d'une sortie brute.
 *
 * Retour utilisateur du 2026-08-19 : « c'est pas super clair a comprendre pour moi ». La cause etait
 * bien affichee, mais noyee dans 3000 caracteres de sortie vitest coloree. Montrer trop equivaut a
 * ne rien montrer.
 *
 * On garde la PREMIERE ligne — c'est la cause, telle que la commande l'annonce — puis les seules
 * lignes qui portent un echec, dedupliquees. Si rien ne ressort, on retombe sur le texte borne :
 * mieux vaut du brut que du vide.
 */
function resumeLisible(brut: string): string {
  const lignes = sansSequencesAnsi(brut)
    .split('\n')
    .map((ligne) => ligne.replace(/\s+$/u, ''))
    .filter((ligne) => ligne.trim().length > 0)
  if (lignes.length === 0) return ''
  const retenues = [lignes[0]]
  for (const ligne of lignes.slice(1)) {
    if (LIGNE_VERTE.test(ligne) || !LIGNE_UTILE.test(ligne)) continue
    const propre = ligne.trim()
    if (!retenues.some((deja) => deja.trim() === propre)) retenues.push(propre)
    if (retenues.length >= 7) break
  }
  const texte = retenues.join('\n')
  return texte.length > MAX_DETAIL_CHARS ? `${texte.slice(0, MAX_DETAIL_CHARS)}…` : texte
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined
}

/** Le corps d'un fait peut etre long : on le borne comme toute autre sortie. */
const MAX_CORPS_CHARS = 1_200

/**
 * Rend lisible ce qu'un depot de memoire a retenu, s'il y en a un. Rien de tel dans `data` →
 * `undefined`, et les autres extracteurs gardent la main.
 */
function resumeMemoire(data: Record<string, unknown>): string | undefined {
  const fait = asRecord(data.fact)
  const detail = typeof data.detail === 'string' ? data.detail.trim() : ''
  const note = typeof data.note === 'string' ? data.note.trim() : ''
  if (!fait && !detail && !note) return undefined
  const lire = (cle: string): string => {
    const valeur = fait?.[cle]
    return typeof valeur === 'string' ? valeur.trim() : ''
  }
  const titre = lire('title')
  const corps = lire('body')
  const etiquettes = Array.isArray(fait?.tags)
    ? (fait.tags as unknown[]).filter((t): t is string => typeof t === 'string')
    : []
  const classement = [lire('type'), lire('scope'), lire('confidence'), ...etiquettes].filter(
    Boolean
  )
  const lignes = [
    titre,
    corps.length > MAX_CORPS_CHARS ? `${corps.slice(0, MAX_CORPS_CHARS)}…` : corps,
    classement.length ? classement.join(' · ') : '',
    // Le sort du depot : ecrit, ou non — et pourquoi. C'est ce qui distingue « retenu » de « perdu ».
    detail,
    note
  ].filter(Boolean)
  const texte = lignes.join('\n')
  return texte.trim() ? texte : undefined
}

/**
 * Extrait ce qu'il y a d'utile a LIRE dans le resultat d'une commande locale. Rien d'exploitable →
 * l'action est ignoree plutot que rendue comme une ligne vide.
 */
export function localActionDetails(actions: readonly ActionLike[]): LocalActionDetail[] {
  const details: LocalActionDetail[] = []
  for (const action of actions) {
    const detail = localActionDetail(action)
    if (detail) details.push(detail)
  }
  return details
}

/**
 * Detail lisible d'UNE action, ou `undefined` s'il n'y a rien a montrer.
 *
 * Extrait de `localActionDetails` (dont il est desormais le corps) parce que le fil deplie
 * maintenant CHAQUE etape separement : la liste agregee ne dit pas a QUELLE action appartient
 * chaque entree — elle SAUTE les actions sans detail, donc ses index ne s'alignent plus sur ceux
 * des etages. Deplier l'etape 2 avec le detail de l'etape 1 serait un mensonge d'interface.
 */
export function localActionDetail(action: ActionLike): LocalActionDetail | undefined {
  {
    /**
     * `data` n'est PAS toujours un objet. Un `edit_file` en echec rend une CHAINE — verifie dans les
     * messages reels (conv-1308, conv-1326) : « Le bureau edit_file a ete conserve : publication
     * automatique incomplete ». `asRecord` rendait `undefined` et l'action etait SAUTEE : la cause
     * etait la, entiere, et se faisait jeter parce que le lecteur ne connaissait qu'une forme.
     *
     * On borne : les sorties reelles montent a 187 000 caracteres (une suite de tests complete).
     */
    if (typeof action.data === 'string') {
      const brut = action.data.trim()
      if (!brut) return undefined
      const texte = resumeLisible(brut)
      if (!texte) return undefined
      return { name: action.name, text: texte, ok: action.ok !== false }
    }
    const data = asRecord(action.data)
    if (!data) return undefined
    const ok = action.ok !== false && data.allowed !== false
    // Un refus explique POURQUOI : c'est l'information la plus utile du lot.
    const reason = typeof data.reason === 'string' ? data.reason : undefined
    const diff = typeof data.diff === 'string' ? data.diff : undefined
    const output = typeof data.output === 'string' ? data.output : undefined
    const exitCode = typeof data.exitCode === 'number' ? data.exitCode : undefined
    const knowledge = typeof data.knowledge === 'string' ? data.knowledge : undefined
    /**
     * La CAUSE d'un echec. Une commande qui echoue rend `{ ok: false, error: <message> }`
     * (`commands.ts:1120`), et ce champ n'etait lu par personne : faute de texte, l'action etait
     * IGNOREE. Vecu le 2026-08-18 — « 1 action avec erreur — graphify » dans le fil, et rien d'autre.
     * Un echec sans sa raison n'apprend rien ; c'est precisement le moment ou l'utilisateur en a le
     * plus besoin. Place APRES `reason`, qui reste prioritaire : un refus explique deja pourquoi.
     */
    const error =
      typeof data.error === 'string' && data.error.trim() ? data.error.trim() : undefined
    /**
     * Une vérification qui PASSE n'a rien à raconter : son verdict est « exit 0 », et le reste est
     * la sortie de l'outil — souvent des milliers de lignes de bruit (avertissements git, worktrees
     * préparés) tronquées à leur queue la moins parlante. On ne montre donc la sortie que lorsqu'elle
     * sert : quand ça a ÉCHOUÉ. Constaté en usage : un pavé de 68 000 caractères sous un « exit 0 ».
     */
    /**
     * Ce qu'un `remember` a REELLEMENT retenu. `rememberFact` rend `{ stored, detail, fact:{…} }`
     * (src/main/brain-remember.ts:531-544) : aucun de ces champs n'etait lu ici, donc un remember
     * REUSSI n'avait ni `reason`, ni `error`, ni `output` — il etait SAUTE, et le clic sur « 1 action
     * terminee » ne depliait rien. Un refus, lui, portait `reason` et s'affichait deja : le trou etait
     * specifique au succes, precisement le cas ou l'utilisateur veut relire ce qui a ete memorise.
     */
    const memoire = resumeMemoire(data)
    const succeeded = ok && exitCode === 0
    const corps =
      reason ??
      error ??
      memoire ??
      diff ??
      (output !== undefined || exitCode !== undefined
        ? [exitCode !== undefined ? `exit ${exitCode}` : '', succeeded ? '' : (output ?? '')]
            .filter(Boolean)
            .join('\n')
        : undefined) ??
      knowledge ??
      /**
       * REPLI GENERIQUE — toute etape intermediaire doit etre depliable.
       *
       * Constate le 2026-08-31 : « 1 action terminee — find_in_files » sans aucun chevron. Cause :
       * la liste ci-dessus est une liste BLANCHE de champs connus (`reason`, `diff`, `output`…), et
       * `find_in_files` rend `{ trouve, correspondances }` — aucun de ces noms. Une lecture reussie
       * n'avait donc RIEN a montrer, alors que son resultat est justement ce que l'utilisateur veut
       * relire. Meme trou pour `read_file`, `list_files`, `conversation_read`, `sql_query`.
       *
       * On rend donc lisible ce qui RESTE du resultat, quel que soit le nom des champs. Les cles de
       * controle (statut, references de run, champs deja rendus au-dessus) sont exclues : sans ca,
       * un `{ ok: true }` produirait un deplie vide qui ne dit rien.
       */
      resumeGenerique(data)
    // La CIBLE demandee : sans elle, « find_in_files » ne dit pas QUOI a ete cherche, ni dans quel
    // fichier. C'est litteralement la demande — « je sais meme pas quelle file a ete lu ».
    const entete = resumeArguments(action.args)
    const text = [entete, corps?.trim()].filter(Boolean).join('\n')
    if (!text.trim()) return undefined
    return { name: action.name, text: text.trim(), ok }
  }
}

/**
 * Cles qui ne racontent RIEN a un lecteur : soit du statut (`ok`, `allowed`), soit deja rendues par
 * un extracteur dedie plus haut. Les laisser passer remplirait le deplie de bruit.
 */
const CLES_DE_CONTROLE = new Set([
  'ok',
  'allowed',
  'stored',
  'error',
  'reason',
  'diff',
  'output',
  'exitCode',
  'knowledge',
  'fact',
  'detail',
  'note',
  'runId',
  'runPath'
])

/** Au-dela, une liste de correspondances cesse d'etre lisible : on annonce le reste en une ligne. */
const MAX_ENTREES_LISTE = 20

function valeurLisible(valeur: unknown): string | undefined {
  if (valeur === null || valeur === undefined) return undefined
  if (typeof valeur === 'string') return valeur.trim() || undefined
  if (typeof valeur === 'number' || typeof valeur === 'boolean') return String(valeur)
  if (Array.isArray(valeur)) {
    if (valeur.length === 0) return undefined
    const entrees = valeur
      .slice(0, MAX_ENTREES_LISTE)
      .map((item) => (typeof item === 'string' ? item : JSON.stringify(item)))
    const reste = valeur.length - entrees.length
    return entrees.join('\n') + (reste > 0 ? `\n… ${reste} de plus` : '')
  }
  const json = JSON.stringify(valeur)
  return json && json !== '{}' ? json : undefined
}

/** Rend lisible le RESULTAT d'une commande dont aucun champ n'est connu du lecteur. */
export function resumeGenerique(data: Record<string, unknown>): string | undefined {
  const lignes: string[] = []
  for (const [cle, valeur] of Object.entries(data)) {
    if (CLES_DE_CONTROLE.has(cle)) continue
    const rendu = valeurLisible(valeur)
    if (!rendu) continue
    lignes.push(rendu.includes('\n') ? `${cle} :\n${rendu}` : `${cle} : ${rendu}`)
  }
  const texte = lignes.join('\n')
  if (!texte.trim()) return undefined
  return texte.length > MAX_DETAIL_CHARS ? `${texte.slice(0, MAX_DETAIL_CHARS)}…` : texte
}

/** Une ligne d'arguments longue noie l'entete : on la borne court, c'est un rappel, pas un dump. */
const MAX_ARG_CHARS = 200

/** Ce qui a ete DEMANDE — chemin lu, motif cherche, cible — en une ligne d'entete du deplie. */
export function resumeArguments(args: unknown): string | undefined {
  const record = asRecord(args)
  if (!record) return undefined
  const morceaux: string[] = []
  for (const [cle, valeur] of Object.entries(record)) {
    if (valeur === null || valeur === undefined || valeur === '') continue
    const rendu =
      typeof valeur === 'string' || typeof valeur === 'number' || typeof valeur === 'boolean'
        ? String(valeur)
        : JSON.stringify(valeur)
    if (!rendu) continue
    morceaux.push(
      `${cle}=${rendu.length > MAX_ARG_CHARS ? `${rendu.slice(0, MAX_ARG_CHARS)}…` : rendu}`
    )
  }
  return morceaux.length ? `→ ${morceaux.join(' · ')}` : undefined
}
