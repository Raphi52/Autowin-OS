import { exactKeys, positiveInteger, record } from '../../shared/compute-fabric'

/**
 * Contrats PURS du gateway d'outils local — etape 2 de l'ordre d'implementation
 * (`docs/compute-fabric/README.md:182` : ToolSpec, ToolCall, ToolResult, continuation, ledger).
 *
 * Ce module DECIDE de l'admissibilite et n'EXECUTE rien. La separation n'est pas cosmetique : si les
 * contrats savaient executer, ils SERAIENT la frontiere de securite, et un test unitaire cesserait de
 * prouver quoi que ce soit sur elle. Ici tout est fonction pure + un ledger en memoire, donc chaque
 * refus est falsifiable par un test, sans processus, sans fichier, sans reseau.
 *
 * ---
 * CORRIGE APRES QUATRE AUDITS EXTERNES SUCCESSIFS (10, puis 4, puis 4, puis 2 majeurs, tous prouves
 * par execution). La lecon TRANSVERSALE, qui a mis trois cycles a etre comprise : corriger
 * l'INSTANCE citee par l'audit laisse la CLASSE ouverte. Trois fois de suite, une garde a ete
 * renforcee sur le champ nomme par le rapport et laissee absente sur son jumeau — grant puis lease,
 * lease et grant puis continuation, `contractual` puis les huit `deny` directs. D'ou les remedes
 * STRUCTURELS ci-dessous (scellement a l'emission, parseur pour TOUT objet d'autorite, test
 * parametre sur toutes les surfaces) plutot que des correctifs ponctuels.
 *
 * Les six lecons qui ont change la CONCEPTION, et pas seulement des lignes :
 *
 * 1. Une garde qui se declenche sur le NOM d'un champ est une denylist deguisee. La v1 ne validait
 *    les chemins que pour les cles matchant /path|file|dir/ : `{cwd:'C:\\Windows'}` passait, alors
 *    que l'invariant 7 nomme `cwd` verbatim. Desormais chaque outil declare un SCHEMA FERME de ses
 *    arguments (cles autorisees + role de chacune) et toute cle inconnue est REFUSEE. On ne devine
 *    plus ce qui est un chemin : l'outil le declare.
 * 2. Mesurer `JSON.stringify(x)` mesure une PROJECTION, pas la donnee. Un `toJSON` faisait tenir
 *    200 Ko dans 26 octets mesures. Desormais on re-parse et on RETOURNE la valeur re-parsee : la
 *    sortie du parseur EST la donnee mesuree.
 * 3. Une frontiere ne laisse pas remonter l'exception de l'appelant. Un getter hostile faisait
 *    traverser SON message, un cycle un `TypeError` natif. Tout sort maintenant en
 *    `ToolContractError` a code stable, et l'appelant peut distinguer refus de politique et bug.
 * 4. Un champ present dans un type n'est pas une autorite. `grantId` et `conversationId` existaient
 *    sans etre jamais confrontes : un ledger admettait 20 appels de 20 conversations differentes,
 *    donc la borne « par conversation » etait « par instance de ledger ». Le ledger est desormais
 *    LIE a sa conversation a la construction.
 * 5. Un champ OPTIONNEL dans une frontiere de securite est une porte, et un TYPE verifie n'est pas une
 *    VALEUR verifiee. `expiresAt`, `maxCalls` et `manifestDigest` optionnels se contournaient par
 *    simple omission ; `maxCalls` controle par `typeof` acceptait `NaN` et `Infinity`, dont toute
 *    comparaison `>=` est fausse — le quota redevenait illimite. Tous obligatoires, tous verifies en
 *    valeur.
 * 6. Un parseur doit etre IDEMPOTENT et son produit IMMUABLE. `parseToolContinuation` laissait tomber
 *    `event`/`complete`, donc sa sortie n'etait pas une entree valide : impossible de re-valider aux
 *    frontieres internes, et l'objet entrait BRUT dans `admitToolCall`. Et le tableau `scopes` du
 *    grant aliasait celui de l'appelant : on validait puis on laissait muter. Sorties gelees, copiees.
 *
 * Les bornes viennent de `README.md:177` ; les refus encodent les invariants `README.md:131-144`.
 */

/**
 * POLITIQUE D'ADMISSION — decision utilisateur du 2026-08-11 : « supprime les toutes, donne tous les
 * droits, je verrai apres si je veux restreindre ».
 *
 * `permissive` (DEFAUT, par cette decision) : aucune restriction. Table d'outils OUVERTE (y compris
 * shell libre), schema d'arguments non applique, formes de chemin non verifiees, lease / grant /
 * continuation non exiges, bornes du ledger non appliquees.
 *
 * `strict` : tout ce que quatre audits externes ont construit — table fermee, schema d'arguments
 * ferme, allowlist de forme sur les chemins, autorites parsees et exigees, bornes du frame.
 *
 * POURQUOI UN INTERRUPTEUR ET NON UNE SUPPRESSION : la demande disait « je verrai apres si je veux
 * restreindre ». Supprimer le code retirerait justement cette possibilite ; un interrupteur donne la
 * meme liberte immediate ET garde le retour arriere. Basculer `mode` sur `'strict'` restaure
 * l'integralite des gardes, sans rien reecrire.
 *
 * CE QUE LE MODE PERMISSIF OUVRE, mesure par les audits (pour que le choix reste eclaire, pas pour
 * le discuter) : un shell libre atteignable via `process.*`, l'ecrasement d'un fichier sans
 * precondition SHA-256, un chemin absolu ou un traversal accepte, un quota illimite.
 */
export const TOOL_POLICY: { mode: 'permissive' | 'strict' } = { mode: 'permissive' }

const strict = (): boolean => TOOL_POLICY.mode === 'strict'

/** Erreur de CONTRAT (refus de politique), distincte d'un bug interne — cf. `FabricStateCorruptionError`. */
export class ToolContractError extends Error {
  readonly code = 'TOOL_CONTRACT_DENIED'
  constructor(message: string) {
    super(message)
    this.name = 'ToolContractError'
  }
}

/**
 * DECLARATION de fonction, pas une const flechee : TypeScript n'exploite le type `never` pour
 * RETRECIR un type qu'a partir d'une declaration (ou d'une const explicitement annotee). En const
 * flechee, `if (typeof v !== 'string') deny(...)` ne retirait pas `unknown` de `v` — 7 erreurs de
 * typage sur une frontiere de securite, alors que les tests passaient a l'execution.
 */
function deny(message: string): never {
  throw new ToolContractError(scellerMessage(message))
}

/**
 * DERNIER RIDEAU sur tout message de refus, applique dans `deny` LUI-MEME.
 *
 * Cycle 4 : l'assainissement du cycle 3 ne vivait que dans `contractual()`, donc il ne couvrait QUE
 * le refus de cle inconnue — l'instance que l'audit avait citee. Les ~8 `deny()` directs qui
 * interpolaient une valeur de l'appelant (statut de resultat, mode de lease, scope, callId, nom
 * d'outil) sortaient intacts : un `status` hostile produisait un message de 348 caracteres portant
 * ESC et sauts de ligne bruts. Meme motif que les cycles precedents, une fois de plus.
 *
 * Le remede est STRUCTUREL, pas ponctuel : on scelle a l'EMISSION. Un nouveau site de refus est
 * couvert par construction, sans que son auteur ait a y penser. En complement, les messages ne
 * doivent interpoler que des valeurs DEJA validees contre un ensemble ferme (un nom de champ du
 * schema, un scope de l'allowlist) — jamais une valeur brute de l'appelant.
 */
/**
 * Construit la classe de caracteres a partir des CODES plutot que de les ecrire dans un litteral :
 * `no-control-regex` interdit a juste titre les caracteres de controle dans une regex litterale, et un
 * `eslint-disable` sur cette ligne ne survit pas au reformatage automatique (constate : le commentaire
 * s'est retrouve detache de sa ligne, et le lint est passe rouge). Construire evite la regle sans la
 * museler, et le code dit CE QU'IL FAIT au lieu de porter des octets illisibles.
 */
const CARACTERES_DE_CONTROLE = new RegExp(
  `[${Array.from({ length: 32 }, (_, i) => `\\u${i.toString(16).padStart(4, '0')}`).join('')}\\u007f]`,
  'g'
)

function scellerMessage(message: string): string {
  const propre = message.replace(CARACTERES_DE_CONTROLE, ' ').replace(/\s+/g, ' ').trim()
  return propre.length > 120 ? `${propre.slice(0, 117)}...` : propre
}

/**
 * ASSAINIT un message avant de le laisser SORTIR. Execute un validateur du module PARTAGE (qui jette
 * un `Error` nu) puis re-emet son refus en `ToolContractError` — sans ce sas, « tout refus porte un
 * code stable » etait faux la ou ca comptait le plus : le refus de cle hors schema.
 *
 * fix-ok: cycle 3 — la correction du cycle 2 avait REINTRODUIT le defaut qu'elle corrigeait.
 * `exactKeys` cite la CLE fournie par l'appelant dans son message, et `contractual` la recopiait
 * verbatim : retours a la ligne, sequences ANSI et faux message systeme credible traversaient la
 * frontiere, jusqu'a 4 KiB.
 *
 * On COUPE la donnee de l'appelant au lieu de la filtrer : les validateurs partages la placent apres
 * le « : », et AUCUN filtrage de caracteres ne neutralise un texte purement alphanumerique comme
 * « ERREUR SYSTEME acces accorde » — le seul traitement sur lequel on puisse raisonner est de ne pas
 * la reemettre. Arbitrage assume : on perd la cle dans le message ; la diagnosticabilite se recupere
 * en journalisant les arguments (bornes a 4 KiB) COTE APPELANT, ou l'attaquant ne choisit pas
 * l'affichage. Une frontiere ne renvoie pas ce qu'on lui a donne.
 */
function sanitize(message: string): string {
  return scellerMessage(message.split(':')[0])
}

function contractual<T>(fn: () => T): T {
  try {
    return fn()
  } catch (e) {
    return deny(sanitize(e instanceof Error ? e.message : 'refus de contrat'))
  }
}

/** `record` du module partage, mais dont le refus porte le code stable du module. */
function asRecord(input: unknown, label: string): Record<string, unknown> {
  return contractual(() => record(input, label))
}

/** Bornes initiales du frame — `README.md:177`. Toute modification est une decision d'architecture. */
export const TOOL_BOUNDS = {
  maxInFlightPerConversation: 1,
  maxCallsPerTurn: 8,
  maxCallsPerConversation: 20,
  maxArgsBytes: 4 * 1024,
  maxResultBytes: 64 * 1024,
  maxBudgetMs: 30_000
} as const

const SCOPES = ['read', 'mutate', 'process'] as const
export type ToolScope = (typeof SCOPES)[number]

/** Role d'un argument. `path` subit la validation de forme ; `text` est une chaine bornee. */
type ArgRole = 'path' | 'text'

interface ToolTableEntry {
  scopes: readonly ToolScope[]
  /** SCHEMA FERME des arguments : toute cle absente d'ici est refusee (lecon 1). */
  args: Readonly<Record<string, ArgRole>>
  /**
   * Cles OBLIGATOIRES. Cycle 2 : fermer les cles inconnues n'exigeait RIEN — `workspace.patch`
   * passait sans `sha256`, donc la mutation optimiste etait admissible SANS sa precondition
   * (`README.md:173` exige « grant, approbation et SHA-256 de precondition »). Une allowlist qui
   * n'exige rien autorise l'ecrasement aveugle.
   */
  required: readonly string[]
  tasks?: readonly string[]
}

/**
 * Table FERMEE des outils. `Object.create(null)` volontairement : sur un objet litteral,
 * `TOOL_TABLE['__proto__']` renvoie une valeur truthy et la table n'etait fail-closed que par
 * accident (un TypeError en aval). L'acces passe en plus par `Object.hasOwn`.
 *
 * ⚠️ Le CONTENU de cette table (et notamment la presence de `process.run-task` borne aux quatre
 * taches) materialise la branche (b) de l'arbitrage consigne dans le RUN — « borner » plutot que
 * « amender l'invariant 4 ». Sous la branche (a), cette table devrait etre rouverte. Ce n'est donc
 * PAS un choix neutre : il est declare ici pour qu'il ne soit pas pris en silence.
 */
const TOOL_TABLE: Record<string, ToolTableEntry> = Object.assign(Object.create(null), {
  'app.get_state.v1': { scopes: ['read'], args: {}, required: [] },
  'workspace.read': { scopes: ['read'], args: { path: 'path' }, required: ['path'] },
  'workspace.search': {
    scopes: ['read'],
    args: { path: 'path', query: 'text' },
    required: ['path', 'query']
  },
  'workspace.patch': {
    scopes: ['mutate'],
    args: { path: 'path', sha256: 'text' },
    required: ['path', 'sha256']
  },
  'process.run-task': {
    scopes: ['process'],
    args: {},
    required: [],
    tasks: ['test', 'lint', 'typecheck', 'build']
  }
})

/** Entree JOKER du mode permissif : tous les scopes, aucun argument impose, aucune tache imposee. */
const ENTREE_OUVERTE: ToolTableEntry = Object.freeze({
  scopes: SCOPES,
  args: Object.freeze({}),
  required: Object.freeze([])
})

function tableEntry(name: string): ToolTableEntry {
  if (!Object.hasOwn(TOOL_TABLE, name)) {
    // Mode permissif : la table n'est plus une allowlist, tout nom passe.
    if (!strict()) return ENTREE_OUVERTE
    deny('outil hors table locale')
  }
  return TOOL_TABLE[name]
}

export interface ToolSpec {
  name: string
  scopes: readonly ToolScope[]
  task?: string
}

export interface ToolCall {
  conversationId: string
  turnId: string
  callId: string
  tool: string
  args: Record<string, string>
  leaseId: string
  grantId?: string
}

export interface ToolResult {
  callId: string
  status: 'ok' | 'error' | 'denied'
  payload: string
}

/**
 * Evenement terminal validant qu'un appel peut etre admis — invariant 9 (`README.md:141`).
 *
 * ⚠️ RESERVE HONNETE, a lire avant de croire l'invariant 9 tenu : la COMPLETUDE est ici **declaree
 * par l'appelant** (`complete: true`), elle n'est pas MESUREE. Un contrat pur ne peut pas verifier
 * qu'un flux a ete recu en entier — il faudrait un compteur de sequence ou un digest produit par
 * l'emetteur, qui n'existe pas encore. Donc l'invariant 9 est **partiellement** tenu : la FORME de
 * l'evenement terminal est verifiee (type + liage callId + digest), sa completude est prise sur
 * parole. Ne pas compter ce contrat comme couvrant l'invariant 9 dans un bilan.
 */
export interface ToolContinuation {
  callId: string
  /**
   * `event` et `complete` sont CONSERVES dans la sortie pour que le parseur soit IDEMPOTENT : sa
   * sortie doit etre une entree valide. La premiere version les laissait tomber, donc re-parser une
   * continuation deja parsee la faisait refuser (« evenement non terminal ») — un parseur dont la
   * sortie n'est pas re-parsable interdit de re-valider aux frontieres internes, ce qui est
   * precisement la discipline qu'on veut. Le defaut s'est manifeste sur 10 tests d'un coup.
   */
  event: 'requires_action'
  complete: true
  manifestDigest: string
}

export interface WorkspaceLeaseRef {
  id: string
  mode: 'read' | 'write'
  /**
   * OBLIGATOIRE. `README.md:155` liste « expiration et budget » comme composants du lease. Le cycle 2
   * l'a rendu obligatoire sur le GRANT en ecrivant « un champ optionnel dans une frontiere de
   * securite est une porte » — et a laisse la porte JUMELLE ouverte ici : un lease sans expiration
   * etait eternel. Corriger l'instance citee par l'audit ne ferme pas la classe.
   */
  expiresAt: string
}

/**
 * Liaison exigee par `README.md:158-167`. Les champs sont presents MEME si leur emetteur n'existe
 * pas encore : un type qui ne peut pas exprimer « revoque / expire / quota epuise / digest change »
 * fige un modele plus faible que le contrat de reference.
 */
export interface LocalToolGrantRef {
  id: string
  leaseId: string
  conversationId: string
  manifestDigest: string
  scopes: readonly ToolScope[]
  /**
   * OBLIGATOIRES (cycle 2). Les rendre optionnels creait un fail-open par omission : un grant sans
   * `expiresAt` ni `maxCalls` etait eternel et illimite, alors que `README.md:164` les liste comme
   * COMPOSANTS du liage. Un champ optionnel dans une frontiere de securite est une porte.
   */
  expiresAt: string
  maxCalls: number
  /** 4e cause d'invalidation de `README.md:167` — elle etait tout simplement inexprimable. */
  revoked?: boolean
}

/**
 * PARSEURS des objets d'AUTORITE. Cycle 3 : `ToolSpec`/`ToolCall`/`ToolResult`/`ToolContinuation`
 * avaient chacun leur parseur, mais le lease et le grant — les deux objets qui PORTENT l'autorite —
 * entraient bruts. Consequences MESUREES : un `scopes` en CHAINE faisait de `.includes()` un test de
 * sous-chaine (donc « read-mutate-process » satisfaisait n'importe quel scope), un `scopes` absent
 * faisait fuir un `TypeError` natif, et un lease sans expiration etait eternel.
 *
 * La lecon de fond du cycle 3 : corriger l'INSTANCE citee par l'audit laisse la CLASSE ouverte.
 * Tout ce qui entre est parse, sans exception.
 */
export function parseWorkspaceLease(input: unknown): WorkspaceLeaseRef {
  const raw = asRecord(input, 'WorkspaceLease')
  contractual(() => exactKeys(raw, ['id', 'mode', 'expiresAt'], 'WorkspaceLease'))
  const id = requireId(raw.id, 'lease.id')
  if (raw.mode !== 'read' && raw.mode !== 'write') deny('lease.mode hors contrat')
  const expiresAt = requireId(raw.expiresAt, 'lease.expiresAt')
  assertIsoUtc(expiresAt, 'lease.expiresAt')
  // GELE : le produit d'un parseur d'autorite doit etre immuable, sinon on valide puis on laisse
  // muter (« validation-puis-mutation »).
  return Object.freeze({ id, mode: raw.mode, expiresAt })
}

export function parseLocalToolGrant(input: unknown): LocalToolGrantRef {
  const raw = asRecord(input, 'LocalToolGrant')
  contractual(() =>
    exactKeys(
      raw,
      [
        'id',
        'leaseId',
        'conversationId',
        'manifestDigest',
        'scopes',
        'expiresAt',
        'maxCalls',
        'revoked'
      ],
      'LocalToolGrant'
    )
  )
  const scopes = raw.scopes
  // Une CHAINE possede `.includes` : sans ce refus, le controle de scope devenait une recherche de
  // sous-chaine. Le type doit etre verifie, pas suppose depuis la presence d'une methode.
  if (!Array.isArray(scopes) || !scopes.length) deny('grant.scopes: tableau non vide attendu')
  for (const scope of scopes) {
    if (!SCOPES.includes(scope as ToolScope)) deny('grant.scopes porte un scope inconnu')
  }
  const expiresAt = requireId(raw.expiresAt, 'grant.expiresAt')
  assertIsoUtc(expiresAt, 'grant.expiresAt')
  // VALEUR, pas type : `NaN` et `Infinity` sont `typeof 'number'`, et toute comparaison `>= NaN` est
  // fausse — le quota redevenait illimite. `positiveInteger` du module partage fait exactement ca.
  const maxCalls = contractual(() => positiveInteger(raw.maxCalls, 'grant.maxCalls'))
  if (raw.revoked !== undefined && typeof raw.revoked !== 'boolean')
    deny('grant.revoked hors contrat')
  return Object.freeze({
    id: requireId(raw.id, 'grant.id'),
    leaseId: requireId(raw.leaseId, 'grant.leaseId'),
    conversationId: requireId(raw.conversationId, 'grant.conversationId'),
    manifestDigest: requireId(raw.manifestDigest, 'grant.manifestDigest'),
    // COPIE gelee, pas l'alias : tous les autres champs etaient recopies, celui-la partageait la
    // reference de l'appelant — donc l'autorite restait mutable APRES validation.
    scopes: Object.freeze([...scopes] as ToolScope[]),
    expiresAt,
    maxCalls,
    ...(raw.revoked === undefined ? {} : { revoked: raw.revoked as boolean })
  })
}

/** Identifiant : refuse l'espace au lieu de conserver une valeur non trimee (piege d'appariement). */
function requireId(value: unknown, champ: string): string {
  if (typeof value !== 'string' || !value.length) deny(`${champ} manquant`)
  const brut = value as string
  if (brut !== brut.trim() || /\s/.test(brut)) deny(`${champ} invalide (espaces)`)
  return brut
}

/**
 * Forme CANONIQUE ISO-8601 en UTC, exigee. `Date.parse` est laxiste : il accepte `'2999'`,
 * `'Sat,01Jan2999'`, et surtout une date SANS fuseau — interpretee alors en heure LOCALE. Mesure du
 * cycle 4 : `'2026-08-11T00:00:00'` decalait la duree de vie de l'autorite de la valeur du fuseau
 * (jusqu'a ~14 h), donc la MEME chaine expirait ici et restait vivante ailleurs. Une autorite dont la
 * validite depend du fuseau de la machine n'est pas une autorite.
 */
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

function assertIsoUtc(value: string, quoi: string): number {
  if (!ISO_UTC.test(value)) deny(`${quoi} doit etre une date ISO-8601 UTC (suffixe Z)`)
  const t = Date.parse(value)
  if (Number.isNaN(t)) deny(`${quoi} porte une date invalide`)
  return t
}

function expired(iso: string, quoi: string): void {
  if (assertIsoUtc(iso, quoi) <= Date.now()) deny(`${quoi} expire`)
}

/**
 * Valide un ToolSpec contre la table fermee.
 *
 * Les scopes declares doivent correspondre EXACTEMENT a ceux de la table : accepter un sous-ensemble
 * ouvrait un fail-open latent — declarer `['read']` sur un outil `['read','mutate']` rendait l'appel
 * « non eleve », donc admissible sur un lease read SANS grant. Aucun test ne l'attrapait parce
 * qu'aucun outil ne portait deux scopes ; le trou attendait le premier.
 */
export function parseToolSpec(input: unknown): ToolSpec {
  const raw = asRecord(input, 'ToolSpec')
  const name = requireId(raw.name, 'nom d outil')
  const entry = tableEntry(name)

  const scopes = Array.isArray(raw.scopes) ? raw.scopes : deny('scopes manquants')
  if (!scopes.length) deny('scopes manquants')
  for (const scope of scopes) {
    if (!SCOPES.includes(scope as ToolScope)) deny('scope inconnu')
    if (strict() && !entry.scopes.includes(scope as ToolScope)) {
      deny(`scope ${String(scope)} non autorise pour ${name}`)
    }
  }
  if (strict()) {
    for (const attendu of entry.scopes) {
      if (!scopes.includes(attendu)) deny(`scopes ne correspondent pas a la table pour ${name}`)
    }
  }

  let task: string | undefined
  if (entry.tasks && strict()) {
    // Obligatoire : `README.md:174` exige un argv construit localement A PARTIR de ce nom. Un spec
    // de processus sans tache laisse l'argv indetermine en aval — c'est la porte du shell libre.
    if (typeof raw.task !== 'string') deny(`tache manquante pour ${name}`)
    task = raw.task as string
    if (!entry.tasks.includes(task)) deny('tache non listee')
  } else if (entry.tasks) {
    // Mode permissif : la tache n'est plus contrainte a la table locale.
    task = typeof raw.task === 'string' ? raw.task : undefined
  } else if (raw.task !== undefined && strict()) {
    deny('cet outil ne prend pas de tache')
  } else if (typeof raw.task === 'string') {
    task = raw.task
  }

  return { name, scopes: scopes as ToolScope[], ...(task === undefined ? {} : { task }) }
}

const SEGMENT_AUTORISE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/
const NOMS_RESERVES = new Set([
  'CON',
  'PRN',
  'AUX',
  'NUL',
  ...Array.from({ length: 9 }, (_, i) => `COM${i + 1}`),
  ...Array.from({ length: 9 }, (_, i) => `LPT${i + 1}`)
])

/**
 * ALLOWLIST de forme. La v1 rejetait trois formes connues (absolu, UNC, `..`) et acceptait tout le
 * reste : chemin relatif au volume (`C:sansslash`, donc changement de volume que `README.md:156`
 * interdit), flux ADS, octet nul, point/espace finaux (Windows les strippe, donc le chemin verifie
 * n'est pas le chemin ouvert), noms reserves DOS, `%2e%2e`, noms 8.3, homoglyphes. Une denylist ne
 * peut pas gagner cette course : on n'accepte plus qu'une forme STRICTE.
 *
 * On refuse AVANT toute resolution — resoudre puis verifier laisserait la resolution suivre un lien
 * sortant (invariant 7).
 */
function assertRelativeContainedPath(value: string, champ: string): void {
  if (!value.length) deny(`${champ}: chemin vide`)
  if (value.length > 512) deny(`${champ}: chemin trop long`)
  if (/^\\\\|^\/\//.test(value)) deny(`${champ}: chemin absolu (UNC) refuse`)
  if (/^[A-Za-z]:/.test(value) || /^[\\/]/.test(value)) deny(`${champ}: chemin absolu refuse`)
  if (value.includes(':')) deny(`${champ}: deux-points refuse (flux ADS / volume)`)
  if (/[%~]/.test(value)) deny(`${champ}: encodage ou nom court refuse`)

  const segments = value.split(/[\\/]/)
  for (const segment of segments) {
    if (!segment.length) deny(`${champ}: segment vide`)
    if (segment === '.' || segment === '..') deny(`${champ}: traversal refuse`)
    if (!SEGMENT_AUTORISE.test(segment)) deny(`${champ}: segment non canonique`)
    if (segment.endsWith('.') || segment.endsWith(' ')) deny(`${champ}: point ou espace final`)
    if (NOMS_RESERVES.has(segment.split('.')[0].toUpperCase())) {
      deny(`${champ}: nom reserve DOS`)
    }
  }
}

/**
 * Canonicalise `args` de facon HOSTILE-SAFE : la serialisation d'une entree fournie par un tiers peut
 * jeter (cycle, BigInt) ou executer du code (getter). On encapsule, on re-parse, et on retourne la
 * valeur RE-PARSEE — c'est elle qui a ete mesuree (lecons 2 et 3).
 */
function canonicalArgs(input: unknown): Record<string, unknown> {
  const brut = input === undefined || input === null ? {} : input
  if (typeof brut !== 'object' || Array.isArray(brut)) deny('arguments hors contrat')
  let serialise: string
  try {
    serialise = JSON.stringify(brut)
  } catch {
    // Le message de l'appelant ne traverse PAS la frontiere.
    return deny('arguments non serialisables')
  }
  if (typeof serialise !== 'string') return deny('arguments non serialisables')
  if (Buffer.byteLength(serialise, 'utf8') > TOOL_BOUNDS.maxArgsBytes) {
    deny('arguments trop volumineux')
  }
  let reparse: unknown
  try {
    reparse = JSON.parse(serialise)
  } catch {
    return deny('arguments non serialisables')
  }
  // La garde porte sur la valeur MESUREE, pas sur l'entree : `new Date()` ou `new String('')`
  // produisaient une sortie non-objet qui traversait la verification faite en amont.
  if (!reparse || typeof reparse !== 'object' || Array.isArray(reparse)) {
    return deny('arguments hors contrat')
  }
  return reparse as Record<string, unknown>
}

/** Valide un ToolCall : identifiants, outil dans la table, schema FERME des arguments. */
export function parseToolCall(input: unknown): ToolCall {
  const raw = asRecord(input, 'ToolCall')
  const conversationId = requireId(raw.conversationId, 'conversationId')
  const turnId = requireId(raw.turnId, 'turnId')
  const callId = requireId(raw.callId, 'callId')
  const tool = requireId(raw.tool, 'tool')
  const leaseId = requireId(raw.leaseId, 'leaseId')
  const entry = tableEntry(tool)

  const args = canonicalArgs(raw.args)
  // Fail-closed sur la FORME : toute cle hors schema est refusee. `exactKeys` est le validateur DEJA
  // present dans `shared/compute-fabric` — pas une reimplementation. Il jette un `Error` NU : on
  // l'encapsule, sinon le refus le plus sensible du module (cle inconnue) sortirait sans code stable
  // et l'appelant ne pourrait pas le distinguer d'un bug interne.
  if (strict()) contractual(() => exactKeys(args, Object.keys(entry.args), `arguments de ${tool}`))

  const valides: Record<string, string> = {}
  if (!strict()) {
    // Mode permissif : aucun schema impose, aucune forme de chemin verifiee. On recopie ce qui est
    // textuel et on laisse passer le reste tel quel a l'appelant.
    for (const [cle, valeur] of Object.entries(args)) {
      if (typeof valeur === 'string') valides[cle] = valeur
      else valides[cle] = JSON.stringify(valeur) ?? ''
    }
    const grantIdOuvert = typeof raw.grantId === 'string' ? raw.grantId : undefined
    return {
      conversationId,
      turnId,
      callId,
      tool,
      args: valides,
      leaseId,
      ...(grantIdOuvert === undefined ? {} : { grantId: grantIdOuvert })
    }
  }
  // `Object.hasOwn` et non `=== undefined` : `args['constructor']` n'est jamais `undefined`, donc la
  // garde aurait ete MUETTE si un outil declarait une telle cle. Meme raison que pour `TOOL_TABLE`.
  for (const cle of entry.required) {
    if (!Object.hasOwn(args, cle)) deny(`${cle}: argument requis manquant pour ${tool}`)
  }
  for (const [cle, role] of Object.entries(entry.args)) {
    if (!Object.hasOwn(args, cle)) continue
    const valeur = args[cle]
    if (valeur === undefined) continue
    if (typeof valeur !== 'string') deny(`${cle}: valeur non textuelle refusee`)
    if (role === 'path') assertRelativeContainedPath(valeur, cle)
    else if (valeur.length > 1024) deny(`${cle}: valeur trop longue`)
    valides[cle] = valeur
  }

  const grantId = raw.grantId === undefined ? undefined : requireId(raw.grantId, 'grantId')
  return {
    conversationId,
    turnId,
    callId,
    tool,
    args: valides,
    leaseId,
    ...(grantId === undefined ? {} : { grantId })
  }
}

/**
 * Valide un ToolResult. Invariant 10 : « validation, taille, redaction et exposition minimale ».
 * ⚠️ Deux des quatre termes seulement sont tenus ici — taille et statut. La REDACTION et l'exposition
 * minimale restent A FAIRE (etape d'execution) : dire « invariant 10 » sans cette reserve ferait
 * croire la frontiere fermee la ou elle ne l'est pas.
 */
export function parseToolResult(input: unknown): ToolResult {
  const raw = asRecord(input, 'ToolResult')
  const callId = requireId(raw.callId, 'callId')
  const status = raw.status
  if (status !== 'ok' && status !== 'error' && status !== 'denied') {
    deny('statut hors contrat')
  }
  if (typeof raw.payload !== 'string') deny('payload hors contrat (chaine attendue)')
  const payload = raw.payload as string
  if (Buffer.byteLength(payload, 'utf8') > TOOL_BOUNDS.maxResultBytes) {
    deny('resultat trop volumineux')
  }
  return { callId, status, payload }
}

/**
 * Invariant 9 (`README.md:141`) : un appel n'est execute qu'apres reception COMPLETE et validation
 * d'un evenement terminal `requires_action`. Sans ce contrat, rien ne bornait QUAND un appel devient
 * admissible — c'etait le cinquieme contrat manquant de l'etape 2.
 */
export function parseToolContinuation(input: unknown): ToolContinuation {
  const raw = asRecord(input, 'ToolContinuation')
  const callId = requireId(raw.callId, 'callId')
  if (raw.event !== 'requires_action') deny('evenement non terminal')
  if (raw.complete !== true) deny('evenement terminal incomplet')
  // OBLIGATOIRE : optionnel, il se contournait par simple omission du champ.
  const manifestDigest = requireId(raw.manifestDigest, 'manifestDigest')
  return Object.freeze({
    callId,
    event: 'requires_action' as const,
    complete: true as const,
    manifestDigest
  })
}

export interface ToolLedger {
  readonly conversationId: string
  settle(call: ToolCall): void
  chargeMs(ms: number): void
  readonly spentMs: number
  /** Interne au ledger, appele uniquement par `admitToolCall` APRES tous les controles d'autorite. */
  admit(call: ToolCall, grantId?: string): void
  grantUses(grantId: string): number
}

/**
 * Ledger en MEMOIRE des bornes d'UNE conversation — liee a la construction. La v1 n'en portait
 * aucune : un seul ledger admettait 20 appels de 20 conversations differentes, donc la borne
 * « par conversation » etait « par instance de ledger ». En memoire volontairement : ces bornes
 * protegent un TOUR en cours, pas un historique ; les persister inviterait a raisonner sur un quota
 * dont plus rien ne garantit la fraicheur.
 */
export function createToolLedger(conversationId: string): ToolLedger {
  const conv = requireId(conversationId, 'conversationId du ledger')
  const seen = new Set<string>()
  const inFlight = new Set<string>()
  const perTurn = new Map<string, number>()
  const perGrant = new Map<string, number>()
  let perConversation = 0
  let spentMs = 0

  return {
    conversationId: conv,
    get spentMs() {
      return spentMs
    },
    grantUses(grantId: string): number {
      return perGrant.get(grantId) ?? 0
    },
    chargeMs(ms: number): void {
      spentMs += Math.max(0, ms)
    },
    admit(call: ToolCall, grantId?: string): void {
      if (call.conversationId !== conv) deny('appel hors de la conversation du ledger')
      if (seen.has(call.callId)) deny('rejeu du callId')
      if (spentMs >= TOOL_BOUNDS.maxBudgetMs) deny('budget cumule epuise')
      if (inFlight.size >= TOOL_BOUNDS.maxInFlightPerConversation) {
        deny('appel deja en vol pour cette conversation')
      }
      if (perConversation >= TOOL_BOUNDS.maxCallsPerConversation) {
        deny('plafond d appels par conversation atteint')
      }
      if ((perTurn.get(call.turnId) ?? 0) >= TOOL_BOUNDS.maxCallsPerTurn) {
        deny('plafond d appels par tour atteint')
      }
      // Aucune mutation avant ce point : un appel REFUSE ne consomme aucun quota.
      seen.add(call.callId)
      inFlight.add(call.callId)
      perTurn.set(call.turnId, (perTurn.get(call.turnId) ?? 0) + 1)
      perConversation += 1
      if (grantId) perGrant.set(grantId, (perGrant.get(grantId) ?? 0) + 1)
    },
    settle(call: ToolCall): void {
      inFlight.delete(call.callId)
    }
  }
}

export interface AdmissionContext {
  lease: WorkspaceLeaseRef
  grant?: LocalToolGrantRef
  ledger: ToolLedger
  /** Invariant 9 (partiellement — cf. reserve sur `ToolContinuation`) : sans evenement terminal, rien. */
  continuation?: ToolContinuation
  /** Digest du manifeste courant. EXIGE : optionnel, il se contournait par omission. */
  manifestDigest?: string
}

/**
 * Porte d'admission. Invariant 8 : lecture et mutation sont des scopes SEPARES — un lease `read` ne
 * porte ni mutation ni processus, MEME muni d'un grant. Le grant AJOUTE un droit a un lease `write` ;
 * il n'en cree jamais un.
 *
 * Ordre volontaire : tout ce qui est refus d'AUTORITE passe AVANT `ledger.admit`, pour qu'un appel
 * refuse ne consomme aucun quota.
 */
export function admitToolCall(call: ToolCall, spec: ToolSpec, ctx: AdmissionContext): ToolCall {
  if (!strict()) {
    // Mode permissif : ni continuation, ni lease, ni grant, ni bornes. Tout est admis. Les compteurs
    // du ledger restent tenus (ils servent l'observabilite), mais ils ne refusent plus rien.
    try {
      ctx.ledger.admit(call, ctx.grant?.id)
    } catch {
      /* les bornes ne refusent plus en mode permissif */
    }
    return call
  }
  // Rien n'entre sans parseur — y compris ce que l'appelant croit deja valide.
  const lease = parseWorkspaceLease(ctx.lease)
  const grant = ctx.grant === undefined ? undefined : parseLocalToolGrant(ctx.grant)
  if (call.tool !== spec.name) deny('spec et appel desaccordes')
  if (call.leaseId !== lease.id) deny('lease desaccorde')
  if (call.conversationId !== ctx.ledger.conversationId) {
    deny('appel hors de la conversation du ledger')
  }

  // La continuation est le TROISIEME objet d'autorite du contexte. Le cycle 3 a ferme le lease et le
  // grant en les re-parsant, et a laisse celui-ci entrer BRUT : une continuation forgee a la main
  // (`{event:'delta', complete:false}`) etait ADMISE, donc l'invariant 9 se contournait. Et le
  // harnais de test ne pouvait STRUCTURELLEMENT pas produire cette entree, puisque son helper passait
  // toujours par le parseur — un angle mort du test, pas seulement du code.
  if (ctx.continuation === undefined) deny('continuation absente, evenement terminal non valide')
  const continuation = parseToolContinuation(ctx.continuation)
  if (continuation.callId !== call.callId) deny('continuation liee a un autre callId')
  // Le digest courant est EXIGE : le rendre conditionnel laissait le controle se contourner en
  // omettant le champ, des deux cotes (continuation ET contexte).
  if (!ctx.manifestDigest) deny('manifestDigest du contexte absent')
  if (continuation.manifestDigest !== ctx.manifestDigest) {
    deny('continuation emise sous un autre manifestDigest')
  }

  expired(lease.expiresAt, 'lease')

  const eleve = spec.scopes.some((scope) => scope === 'mutate' || scope === 'process')
  if (eleve) {
    if (lease.mode !== 'write') deny('lease en lecture seule — mutation refusee')
    const accorde = grant ?? deny('grant requis pour mutation ou processus')
    if (call.grantId !== undefined && call.grantId !== accorde.id) deny('grantId desaccorde')
    if (accorde.leaseId !== lease.id) deny('grant non lie a ce lease')
    if (accorde.conversationId !== call.conversationId) {
      deny('grant emis pour une autre conversation')
    }
    if (accorde.revoked === true) deny('grant revoque')
    if (accorde.manifestDigest !== ctx.manifestDigest) {
      deny('grant emis sous un autre manifestDigest')
    }
    expired(accorde.expiresAt, 'grant')
    if (ctx.ledger.grantUses(accorde.id) >= accorde.maxCalls) deny('quota du grant epuise')
    for (const scope of spec.scopes) {
      if (!accorde.scopes.includes(scope)) deny(`scope ${scope} absent du grant`)
    }
  }

  // Le quota du grant ne se consomme que sur le chemin ELEVE : un simple `workspace.read` le
  // consommait, donc un droit de mutation s'epuisait sur des lectures.
  ctx.ledger.admit(call, eleve ? grant?.id : undefined)
  return call
}
