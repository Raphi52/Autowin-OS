/**
 * SE SOUVENIR — la commande `remember`, et la seule régression mécanique face à claude.exe.
 *
 * claude.exe a une mémoire que le modèle ÉCRIT : il édite des fiches dans un dossier, et elles sont
 * relues au tour suivant. Autowin avait coupé la LECTURE automatique de ces fiches
 * (`autoMemoryDirectory: ''` dans `providers/claude.ts`) parce qu'elles pesaient 552 Ko à chaque appel
 * — soit ~9 200 tokens. La lecture à la demande, elle, existait déjà (`brain_query`).
 * Restait donc un seul trou : le modèle ne pouvait RIEN écrire. « Retiens ça » était impossible.
 *
 * DESTINATION : le Brain partagé, pas un dossier local — choix de l'utilisateur. Conséquences assumées :
 *  - ce qu'on retient sert à TOUTE la boîte, et remplit un corpus Autowin qui ne pesait que 0,19 % de
 *    l'index (15 342 chunks, dont 99 % de doc RIG — mesuré le 2026-07-29) ;
 *  - un candidat va d'abord dans `inbox/`, JAMAIS directement dans `knowledge/` : une promotion séparée
 *    peut ensuite être décidée par l'humain ou par la politique causale `OutcomeLearningSupervisor`. Le serveur
 *    l'impose, ce module ne fait que l'annoncer honnêtement à l'agent ;
 *  - ce n'est PAS relu au tour suivant. L'index se reconstruit par générations, donc un fait retenu
 *    aujourd'hui devient trouvable plus tard. C'est la différence de mécanique avec claude.exe, et elle
 *    doit être DITE au modèle plutôt que découverte.
 *
 * Ce module est PUR côté décision (validation, forme du candidat) ; l'appel réseau est injectable.
 */

import { SECRET_SHAPES_SOURCE } from './activity/trace-redact'
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { readSignedBrainPayload, verifySignedBrainPayload } from './brain-protocol'
import { memoryWorkspaceIdentity } from './session-memory-echo'

/** Types acceptés par le garde du Brain (`brain_propose.ALLOWED_TYPES`). Liste FERMÉE. */
export const REMEMBER_TYPES = ['lesson', 'decision', 'preference', 'domain'] as const
export type RememberType = (typeof REMEMBER_TYPES)[number]

/**
 * Schémas de source vérifiables (`brain_propose.ALLOWED_SOURCE_SCHEMES`). Un fait sans source traçable
 * est refusé par le serveur : autant le dire ici, sinon l'agent ne comprend pas le refus.
 */
export const REMEMBER_SOURCE_SCHEMES = [
  'session',
  'file',
  'url',
  'git',
  'email',
  'ticket',
  'meeting'
] as const

export const REMEMBER_TITLE_MAX = 200
export const REMEMBER_BODY_MAX = 4_000
export const REMEMBER_SCOPE_MAX = 120
export const REMEMBER_TAG_MAX = 40

/**
 * COMPLÉMENT au garde du serveur, pas son doublon.
 *
 * Le garde distant (`brain_propose.SECRET_PATTERNS`) borne ses mots-clés par `\b`. Or `_` est un
 * caractère de mot : `aws_secret_access_key=…` ne matche donc PAS `\bsecret\b`, et une clé d'accès nue
 * ne matche aucun motif. Vérifié en lisant le serveur vivant le 2026-07-30, après qu'un essai live ait
 * fait ACCEPTER un corps contenant `AKIAIOSFODNN7EXAMPLE`.
 *
 * On ne corrige pas le serveur (service partagé, hors périmètre) : on refuse localement les formes qu'il
 * laisse passer. Déposer un secret dans un corpus lu par TOUTE la boîte est irréversible en pratique —
 * c'est exactement le cas où une profondeur de défense se justifie.
 */
/**
 * Nom de clé en snake_case — le SEUL cas qu'aucun des deux gardes existants ne voit : le serveur borne
 * par `\b` et `SECRET_VALUE` exige que le mot-clé soit COLLÉ au `=`, or `aws_secret_access_key=…` place
 * `_access_key` entre les deux.
 *
 * La VALEUR doit ressembler à un secret, pas à un identifiant : ≥16 caractères, avec une minuscule ET un
 * chiffre. Sans cette exigence, des faits techniques parfaitement légitimes étaient refusés —
 * `csrf_token_header: X-CSRF-Token`, `db_password_env: RIG_DB_PASSWORD`, `refresh_token_ttl = 3600000000`
 * (faux positifs relevés par l'audit du 2026-07-30 ; un faux refus bloque une mémoire valide, ce qui coûte
 * plus cher que l'inverse ici puisqu'un second garde tourne derrière).
 * Pas de drapeau `i` : les lookaheads distingueraient sinon plus la casse.
 */
/** Formes de jetons, en SENSIBLE à la casse : `SK-10023847` est une référence article, pas un `sk-`. */
const TOKEN_SHAPES = new RegExp(SECRET_SHAPES_SOURCE)

/**
 * Repère un `<clé> = <valeur>` dont la CLÉ évoque un secret. Insensible à la casse — la forme canonique
 * est justement la variable d'environnement en MAJUSCULES (`AWS_SECRET_ACCESS_KEY=…`), et une version
 * sensible à la casse la laissait passer : trou mesuré le 2026-07-30 sur le module réel.
 * Le préfixe et le suffixe du nom sont libres : `aws_secret_access_key` comme `secret_key` en début de
 * chaîne doivent mordre.
 */
const KEYED_CANDIDATE =
  /(?:^|[^A-Za-z0-9])[A-Za-z0-9_.-]*(?:secret|token|password|passwd|api[_-]?key)[A-Za-z0-9_.-]*\s*[:=]\s*["']?([^\s"',]+)/gi

/**
 * La valeur ressemble-t-elle à un SECRET, ou à une donnée technique légitime ?
 *
 * Séparée de la détection de la clé pour deux raisons : la casse de la clé et celle de la valeur ne
 * s'arbitrent pas ensemble (un seul drapeau `i` pour toute une expression, c'est l'un ou l'autre), et
 * cette liste d'exclusions est un JUGEMENT qui mérite d'être lu.
 *
 * Chaque exclusion vient d'un faux refus RÉEL relevé par l'audit du 2026-07-30 — et un faux refus est le
 * sens coûteux ici : il bloque une mémoire valide alors qu'un second garde tourne derrière.
 */
export function valueLooksLikeSecret(value: string): boolean {
  // Trop court pour être un secret utile : « X-CSRF-Token », « 3600000000 ».
  if (value.length < 16) return false
  // Un CHEMIN ou une URL n'est pas un secret : « /api/v2/oauth/token/refresh »,
  // « /var/lib/rig/session2/token.json », « C:\… », « https://… ».
  if (/^(\.{0,2}[\\/]|~[\\/]|[A-Za-z]:[\\/])/.test(value) || value.includes('://')) return false
  // Un secret réel mélange les casses ET les chiffres. Un identifiant ne le fait pas :
  // « RIG_DB_PASSWORD » (pas de minuscule), « exemple0non0valide » (pas de majuscule).
  return /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value)
}

/**
 * Décrit le secret repéré localement, ou `undefined`. Complète les gardes existants sans les dupliquer :
 * les formes de jetons viennent de `trace-redact.ts`, déjà écrit et testé.
 *
 * Ce qui reste LOCAL est le cas « mot-clé = valeur », parce que la moitié correspondante du motif de
 * rédaction accepte n'importe quelle valeur : sans danger pour rédiger, inacceptable pour un accept/refus
 * (elle refuserait « le champ token: obligatoire »).
 */
export function likelySecretShape(text: string): string | undefined {
  if (TOKEN_SHAPES.test(text)) return 'un jeton ou une clé'
  for (const match of text.matchAll(KEYED_CANDIDATE)) {
    if (valueLooksLikeSecret(match[1] ?? '')) return 'un secret nommé par sa clé'
  }
  return undefined
}

/**
 * Tronque en respectant une frontière de phrase puis de mot, et DIT que c'est tronqué.
 *
 * Une coupe brute au caractère 4 000 peut tomber juste après une négation (« … ne doit PAS être fait »)
 * et faire dire au candidat l'INVERSE du fait voulu — silencieusement, alors que le contrat exige un fait
 * « autoporté, relisible dans 3 mois ». Défaut relevé par l'audit du 2026-07-30.
 */
export function truncateFact(
  body: string,
  max = REMEMBER_BODY_MAX
): { body: string; truncated: boolean } {
  if (body.length <= max) return { body, truncated: false }
  // La marque est BUDGÉTÉE : sans ça le résultat dépassait la borne qu'il est censé faire respecter.
  const MARK = ' […tronqué]'
  // Sous la longueur de la marque, la marque elle-même dépasserait la borne : coupe nue.
  if (max <= MARK.length) return { body: body.slice(0, max), truncated: true }
  const window = body.slice(0, max - MARK.length)
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? ')
  )
  // Le seuil de moitié n'est PAS un réglage arbitraire : une fin de phrase située très tôt ferait jeter
  // l'essentiel du fait. Au-delà de la moitié on coupe proprement à la phrase, sinon au dernier mot.
  const cut = sentence > window.length * 0.5 ? sentence + 1 : window.lastIndexOf(' ')
  const kept = (cut > 0 ? window.slice(0, cut) : window).trimEnd()
  return { body: `${kept}${MARK}`, truncated: true }
}

/**
 * FORME de chaque locator, alignée sur la validation RÉELLE du Brain (`brain_propose._valid_source`).
 *
 * Découvert par un essai LIVE, pas par lecture : le serveur ne vérifie pas un préfixe, il vérifie que le
 * locator est VÉRIFIABLE. `file:` exige un fichier qui existe CÔTÉ SERVEUR (chemin absolu, le service
 * tourne depuis la racine du Brain) — un chemin relatif de dépôt est donc refusé. Pour un fait de code,
 * la bonne forme est `git:<chemin>@<sha>`.
 *
 * Devancer ces règles ici sert à une chose : que le REFUS enseigne la forme attendue au lieu de faire
 * deviner l'agent après un aller-retour réseau.
 */
const LOCATOR_RULES: Array<{
  scheme: (typeof REMEMBER_SOURCE_SCHEMES)[number]
  test: (locator: string) => boolean
  expected: string
}> = [
  {
    scheme: 'git',
    // Ancrée aux DEUX bouts (sans `^`, un locator multiligne ne validait que sa dernière ligne) — mais
    // `.` et NON `\S` : mon premier ancrage interdisait l'espace, donc refusait
    // `git:C:/Amitel/Autowin OS/src/x.ts@sha`. Le dépôt de cette machine porte un espace dans son nom :
    // le resserrement avait transformé le cas le plus courant en faux refus (audit du 2026-07-30).
    test: (l) => /^.+@[0-9a-fA-F]{7,64}$/.test(l),
    expected: 'git:<chemin>@<sha> (ex. git:src/main/x.ts@9218eaf)'
  },
  {
    scheme: 'url',
    test: (l) => /^https?:\/\/[^\s/]+/.test(l),
    expected: 'url:https://…'
  },
  {
    scheme: 'ticket',
    test: (l) => /^[A-Z][A-Z0-9]{1,15}-\d{1,12}$/.test(l),
    expected: 'ticket:ABC-123 (préfixe en MAJUSCULES)'
  },
  {
    scheme: 'session',
    test: (l) => /^[A-Za-z0-9][A-Za-z0-9._:-]{5,127}$/.test(l),
    expected: 'session:<identifiant de 6 caractères au moins>'
  },
  {
    scheme: 'email',
    test: (l) => /^<?[^<>\s@]+@[^<>\s@]+>?$/.test(l),
    expected: 'email:qui@exemple.fr'
  },
  {
    scheme: 'meeting',
    // Ancrée en FIN aussi : `meeting:2026-07-30 <n'importe quoi>` passait alors que la forme annoncée au
    // modèle est stricte. La validité CALENDAIRE, elle, reste au serveur — dit dans `expected`.
    test: (l) => /^\d{4}-\d{2}-\d{2}$/.test(l),
    expected: 'meeting:AAAA-MM-JJ (date exacte ; sa validité calendaire est vérifiée côté serveur)'
  },
  {
    // Le serveur exige un fichier EXISTANT depuis SA racine : on ne peut pas le verifier d'ici, mais on
    // peut refuser tout de suite un chemin relatif, qui echouera a coup sur.
    scheme: 'file',
    test: (l) => /^([A-Za-z]:[\\/]|[\\/]{1,2}|~)/.test(l),
    expected:
      'file:<chemin ABSOLU existant côté serveur> — pour un fichier de dépôt, préférer git:<chemin>@<sha>'
  }
]

/** Décrit le problème du locator, ou `undefined` s'il est conforme. */
export function sourceLocatorProblem(source: string): string | undefined {
  // Un chemin SANS préfixe : lecteur Windows (`C:\…`, lu comme le schéma « c »), UNC en antislashes, UNC
  // en slashes (`//ged2/rig/…`, l'écriture de la GED ici). Testé AVANT le deux-points, car une UNC n'en
  // contient aucun et retombait donc dans le message générique — le contraire de ce que ce garde annonce.
  // Cas d'autant plus probable que `file:` réclame précisément ce format en argument.
  if (/^([A-Za-z]:[\\/]|\\\\|\/\/)/.test(source)) {
    return 'préfixe manquant devant un chemin — écris file:<ce chemin>, ou mieux git:<chemin>@<sha> pour un fichier de dépôt'
  }
  const separator = source.indexOf(':')
  if (separator <= 0) {
    return `source non traçable — préfixe attendu : ${REMEMBER_SOURCE_SCHEMES.map((s) => `${s}:`).join(' ')}`
  }
  const scheme = source.slice(0, separator).toLowerCase()
  const locator = source.slice(separator + 1).trim()
  const rule = LOCATOR_RULES.find((candidate) => candidate.scheme === scheme)
  if (!rule) {
    return `schéma « ${scheme} » inconnu — attendu : ${REMEMBER_SOURCE_SCHEMES.join(', ')}`
  }
  if (!locator) return `locator vide après « ${scheme}: » — attendu ${rule.expected}`
  if (!rule.test(locator)) return `locator non vérifiable — attendu ${rule.expected}`
  return undefined
}

export type RememberDecision =
  | {
      allowed: true
      title: string
      body: string
      type: RememberType
      scope: string
      source: string
      tags: string[]
      confidence: 'low' | 'medium' | 'high'
      /** Le fait dépassait la borne : à DIRE, sinon le candidat ment par omission. */
      truncated: boolean
    }
  | { allowed: false; reason: string }

function text(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : ''
}

/**
 * Valide une demande « retiens ça » AVANT tout appel réseau.
 *
 * On refuse tôt et en DISANT pourquoi : un candidat rejeté en silence ferait croire à une mémoire
 * écrite alors que rien ne l'a été — le même défaut que le coût jeté et la carte de livraison jetée.
 * La validation de fond (secrets, données personnelles, confinement du chemin) reste au serveur : on ne
 * la duplique pas, on ne peut que la devancer sur la forme.
 */
export function decideRemember(args: Record<string, unknown>): RememberDecision {
  const rawTitle = text(args.title)
  const title = rawTitle.slice(0, REMEMBER_TITLE_MAX)
  // `??` ne bascule pas sur `body` quand `fact` est une chaîne VIDE : `{fact:'', body:'…'}` était refusé
  // « le fait est vide » alors qu'un contenu existait. On prend le premier NON VIDE.
  const rawBody = text(args.fact) || text(args.body)
  const { body, truncated } = truncateFact(rawBody)
  if (!title)
    return { allowed: false, reason: 'titre manquant — un fait sans titre est introuvable' }
  if (!body) return { allowed: false, reason: 'rien à retenir : le fait est vide' }

  // Profondeur de défense : ce que le garde distant laisse passer. Un secret déposé dans un corpus
  // partagé ne se reprend pas.
  const secret = likelySecretShape(`${title}\n${rawBody}`)
  if (secret) {
    return {
      allowed: false,
      reason: `refusé localement : le fait semble contenir ${secret} — un corpus partagé n’est pas un coffre. Retiens le FAIT, pas la valeur`
    }
  }

  if (
    (args.learningOutcome === 'success' || args.learningOutcome === 'failure') &&
    /(?:ignore|oublie|contourne).{0,40}(?:instruction|prompt|règle)|(?:system|developer)\s+prompt|<\/?(?:script|tool_call)|\btu\s+es\s+(?:maintenant|désormais)\b|\[(?:BEGIN|END)\s+AMITEL\s+BRAIN/iu.test(
      rawBody
    )
  ) {
    return {
      allowed: false,
      reason:
        'leçon refusée — directive adressée au futur modèle détectée dans une donnée non fiable'
    }
  }

  if (args.learningOutcome === 'failure') {
    const completeFailure = [
      /\bTentative\s*:/iu,
      /\bSymptôme\s*:/iu,
      /\bCause\s*\((?:prouvée|hypothèse)\)\s*:/iu,
      /\bProchaine stratégie\s*:/iu
    ].every((pattern) => pattern.test(rawBody))
    if (!completeFailure) {
      return {
        allowed: false,
        reason:
          'leçon d’échec incomplète — distinguer Tentative, Symptôme, Cause (prouvée|hypothèse) et Prochaine stratégie'
      }
    }
  }

  const rawType = text(args.type).toLowerCase()
  const type = (REMEMBER_TYPES as readonly string[]).includes(rawType)
    ? (rawType as RememberType)
    : undefined
  if (!type) {
    /*
     * UN REFUS QUI NE DIT PAS CE QU'IL A RECU SE REPRODUIT — mesure deux fois, le 2026-08-20
     * (conv-1086, valeur `cause-racine`) puis le 2026-08-26. Le motif ne nommait jamais la valeur
     * recue, et un champ ABSENT rendait exactement le meme libelle qu'un champ FAUX (`text(undefined)`
     * donne `''`, qui tombe hors de l'enumeration). Deux causes, un message, aucun indice.
     *
     * Le modele LIT ce motif : il repart en resultat d'outil (`commands.ts`). Le rendre actionnable
     * est donc un vrai correctif, pas du confort d'affichage. On ne touche pas a `REMEMBER_TYPES` :
     * le vocabulaire est un contrat externe, l'elargir deplacerait le refus cote serveur.
     */
    const attendus = `attendu l'un de : ${REMEMBER_TYPES.join(', ')}`
    return {
      allowed: false,
      reason: rawType
        ? `type invalide — recu « ${rawType} », ${attendus}`
        : `type manquant — ${attendus}`
    }
  }

  const source = text(args.source)
  const sourceProblem = sourceLocatorProblem(source)
  if (sourceProblem) return { allowed: false, reason: sourceProblem }

  // Bornées comme `title`/`body` le sont déjà : sans plafond, `scope` ou un seul tag pouvaient porter un
  // texte arbitrairement long jusqu'au corps de la requête.
  const scope = text(args.scope).slice(0, REMEMBER_SCOPE_MAX)
  if (!scope) {
    return { allowed: false, reason: 'portée manquante — le projet concerné, ou « global »' }
  }

  const rawConfidence = text(args.confidence).toLowerCase()
  const confidence =
    rawConfidence === 'low' || rawConfidence === 'high' ? rawConfidence : ('medium' as const)

  const rawTags = Array.isArray(args.tags) ? args.tags : []
  const tags = rawTags
    .map((tag) => text(tag).slice(0, REMEMBER_TAG_MAX))
    .filter(Boolean)
    .slice(0, 8)

  // Le titre et les tags étaient coupés en SILENCE — le défaut même que `truncated` existe pour tuer.
  // Toute amputation compte, d'où qu'elle vienne.
  const anythingCut =
    truncated ||
    rawTitle.length > REMEMBER_TITLE_MAX ||
    text(args.scope).length > REMEMBER_SCOPE_MAX ||
    rawTags.some((tag) => text(tag).length > REMEMBER_TAG_MAX) ||
    // Les étiquettes au-delà de la 8ᵉ étaient jetées en silence : « toute amputation compte » les inclut.
    rawTags.filter((tag) => text(tag)).length > 8

  return {
    allowed: true,
    title,
    body,
    type,
    scope,
    source,
    tags,
    confidence,
    truncated: anythingCut
  }
}

export interface RememberOutcome {
  /** Le candidat a été DÉPOSÉ. Ne dit pas qu'il est promu : la promotion est une étape séparée. */
  stored: boolean
  /** Ce qui s'est passé, à afficher tel quel. */
  detail: string
  /** Nom du fichier candidat, quand le serveur le rend. */
  note?: string
  /** Identité relative signée, utilisable par une promotion no-clobber sans reconstruire un chemin. */
  candidateId?: string
  /**
   * L'état du dépôt est INDÉTERMINÉ (abort, réponse illisible) : ni succès, ni refus.
   * Le distinguer d'un refus est ce qui empêche un agent de retenter et de créer un doublon — or le
   * serveur ne dédoublonne PAS contre `inbox/` (voir le commentaire du 409).
   */
  unknown?: boolean
  /**
   * Ce qui a réellement été validé et envoyé. Présent dès que la demande est recevable, même si le dépôt
   * a échoué : c'est ce qui permet de retenir le fait DANS le fil quand le Brain ne répond pas.
   */
  fact?: {
    title: string
    body: string
    type: RememberType
    scope: string
    source: string
    tags: string[]
    confidence: 'low' | 'medium' | 'high'
    truncated: boolean
  }
}

/**
 * IDEMPOTENCE CÔTÉ CLIENT — parce que le serveur n'en offre pas sur ce cas.
 *
 * Le garde anti-doublon du serveur compare au savoir CANONIQUE indexé (`retriever.query`, seuil
 * `NEAR_DUP_DENSE = 0.82`). Or `inbox/` n'est PAS indexé : deux dépôts du MÊME fait renvoient donc deux
 * fois 200 et créent deux fichiers. Observé le 2026-07-30 (deux POST identiques → deux candidats), et
 * corroboré par deux fiches quasi jumelles déposées à 09:47 et 09:48 le même jour.
 * On garde donc durablement l'empreinte de ce qui a déjà été déposé, sans fusionner deux scopes ou deux
 * workspaces. Une portée `global` forme volontairement un seul namespace partagé.
 */
const depositedThisSession = new Map<string, string>()
const SESSION_MEMO_MAX = 200
const UNKNOWN_DEPOSIT = '[etat-inconnu]'
let depositStorePath: string | undefined
type DepositOutcome = RememberOutcome & { allowed: boolean }
const pendingByLedger = new WeakMap<Map<string, string>, Map<string, Promise<DepositOutcome>>>()

/** Vide la mémoire de dépôt. Existe pour que rien ne fuite d'un test à l'autre. */
export function forgetSessionDeposits(): void {
  depositedThisSession.clear()
  persistDepositLedger()
}

function persistDepositLedger(): void {
  if (!depositStorePath) return
  const temp = `${depositStorePath}.${process.pid}.${Date.now()}.tmp`
  try {
    mkdirSync(dirname(depositStorePath), { recursive: true })
    writeFileSync(
      temp,
      JSON.stringify({ version: 2, deposits: [...depositedThisSession.entries()] }),
      { encoding: 'utf8', mode: 0o600 }
    )
    renameSync(temp, depositStorePath)
  } catch {
    try {
      unlinkSync(temp)
    } catch {
      // La memoire du processus courant reste active si le disque est indisponible.
    }
  }
}

/** Active le ledger durable anti-doublon, ou le desactive sans effacer le fichier. */
export function configureRememberDepositStore(path?: string): void {
  depositStorePath = path?.trim() || undefined
  depositedThisSession.clear()
  if (!depositStorePath || !existsSync(depositStorePath)) return
  try {
    const parsed = JSON.parse(readFileSync(depositStorePath, 'utf8')) as {
      version?: unknown
      deposits?: unknown
    }
    if ((parsed.version !== 1 && parsed.version !== 2) || !Array.isArray(parsed.deposits)) return
    // Les clés v1 ne portaient ni scope ni workspace. Les réutiliser pourrait bloquer un dépôt légitime
    // dans n'importe quel projet : migration fail-closed, le premier dépôt v2 réécrit le ledger.
    if (parsed.version === 1) return
    for (const entry of parsed.deposits.slice(-SESSION_MEMO_MAX)) {
      if (!Array.isArray(entry) || entry.length !== 2) continue
      const [key, note] = entry
      if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) continue
      if (typeof note !== 'string' || !note.trim()) continue
      depositedThisSession.set(key, note.trim().slice(0, 500))
    }
  } catch {
    depositedThisSession.clear()
  }
}

function durableFingerprint(
  decision: Extract<RememberDecision, { allowed: true }>,
  workspace?: string
): string {
  const scope = decision.scope.trim().toLowerCase()
  const workspaceIdentity =
    scope === 'global' ? 'global' : memoryWorkspaceIdentity(workspace) || 'workspace-unavailable'
  const material = `v2\0${scope}\0${workspaceIdentity}\0${decision.title.toLowerCase()}\0${decision.body.toLowerCase()}`
  return createHash('sha256').update(material, 'utf8').digest('hex')
}

function recordDepositState(
  deposited: Map<string, string>,
  decision: Extract<RememberDecision, { allowed: true }>,
  note: string,
  workspace?: string
): void {
  if (deposited.size >= SESSION_MEMO_MAX) {
    deposited.delete(deposited.keys().next().value as string)
  }
  deposited.set(durableFingerprint(decision, workspace), note)
  if (deposited === depositedThisSession) persistDepositLedger()
}

export interface RememberDeps {
  origin?: string
  token?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  authorAgent?: string
  model?: string
  /** Workspace qui produit le candidat ; participe à l'idempotence sans être envoyé au Brain. */
  workspace?: string
  /**
   * Où retenir ce qui a déjà été déposé. Injectable pour ne pas cacher un état global : la production
   * partage la mémoire du module, un test fournit la sienne et reste isolé.
   */
  deposited?: Map<string, string>
}

/**
 * LA PORTÉE NE SE DEVINE PAS : LE PROJET LA CONNAÎT.
 *
 * Mesuré le 2026-09-02 (conv-142) : un `remember` légitime a été REFUSÉ « portée manquante », rien
 * n'a été écrit, et le modèle avait déjà annoncé le dépôt. La valeur qui a fait passer le second
 * essai — `autowin-os` — est exactement le `name` du `package.json` du dépôt : l'app la tenait de
 * source sûre pendant qu'on demandait au modèle de la deviner. La prose du prompt détaillait les
 * quatre `type` et les sept formes de `source`, et ne disait RIEN de `scope` (voir
 * `chat-pilotage-prompt.vocabulaire-memoire.test.ts`).
 *
 * On COPIE donc la portée d'une source tracée au lieu de l'inventer : `package.json` du workspace,
 * sinon le nom du dossier. `global` reste un choix DÉLIBÉRÉ du modèle — jamais un défaut, car
 * élargir la portée d'un fait à toute la boîte ne se fait pas par omission.
 * Si aucun workspace n'est connu, on garde le refus : mieux vaut refuser que ranger un fait sous une
 * portée inventée.
 */
export function projectScopeFromWorkspace(workspace?: string): string {
  const root = workspace?.trim()
  if (!root) return ''
  const slug = (value: string): string =>
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, REMEMBER_SCOPE_MAX)
  try {
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
      name?: unknown
    }
    const named = typeof manifest.name === 'string' ? slug(manifest.name) : ''
    if (named) return named
  } catch {
    // Pas de manifeste lisible (dossier hors Node, JSON cassé) : le nom du dossier reste tracable.
  }
  return slug(basename(resolve(root)))
}

/**
 * Dépose le candidat sur `POST /ingest`. Ne throw JAMAIS : un échec d'écriture est un résultat à
 * afficher, pas une exception qui casse le tour.
 */
export async function rememberFact(
  args: Record<string, unknown>,
  deps: RememberDeps = {}
): Promise<RememberOutcome & { allowed: boolean; reason?: string }> {
  // La portée absente est REMPLIE depuis le projet, pas refusée : voir `projectScopeFromWorkspace`.
  const scopeGiven = typeof args.scope === 'string' && args.scope.trim().length > 0
  const decision = decideRemember(
    scopeGiven ? args : { ...args, scope: projectScopeFromWorkspace(deps.workspace) }
  )
  if (!decision.allowed) {
    /*
     * UN REFUS DOIT DIRE QU'IL N'A RIEN ECRIT — conv-142, 2026-09-02. Le compte-rendu ne portait que
     * le motif (« portee manquante — … »). Or l'agent avait deja ecrit « je depose la lecon » : lire
     * un motif de forme ne lui a pas dit que l'effet annonce n'avait PAS eu lieu, et l'utilisateur a
     * du le constater lui-meme. Les refus du transport le disaient deja (« jeton du Brain absent —
     * rien n'a ete ecrit ») ; les refus de VALIDATION, non.
     */
    const detail = `rien n’a été retenu — ${decision.reason}`
    return { allowed: false, reason: decision.reason, stored: false, detail }
  }
  // fix-ok: refactorisation assumée, pas un correctif aveugle — cause MESURÉE et citée dans le RUN de la
  // session (CausalHypothesis, cycle 4). L'appelant alimentait l'écho avec `a.fact ?? a.body`, les
  // arguments BRUTS : `{fact:'', body:'le vrai fait'}` déposait au Brain et échoait une chaîne vide, que
  // l'écho rejette en silence. On fait donc remonter ce qui a été RÉELLEMENT validé.
  const outcome = await depositCandidate(decision, deps)
  return {
    ...outcome,
    allowed: true,
    fact: {
      title: decision.title,
      body: decision.body,
      type: decision.type,
      scope: decision.scope,
      source: decision.source,
      tags: decision.tags,
      confidence: decision.confidence,
      truncated: decision.truncated
    }
  }
}

async function depositCandidate(
  decision: Extract<RememberDecision, { allowed: true }>,
  deps: RememberDeps
): Promise<RememberOutcome & { allowed: boolean }> {
  const token = deps.token ?? ''
  if (!token) {
    return {
      allowed: true,
      stored: false,
      detail: 'jeton du Brain absent — rien n’a été écrit (définir AMITEL_BRAIN_TOKEN)'
    }
  }
  const deposited = deps.deposited ?? depositedThisSession
  const key = durableFingerprint(decision, deps.workspace)
  const alreadyHere = deposited.get(key)
  if (alreadyHere) {
    if (alreadyHere === UNKNOWN_DEPOSIT) {
      return {
        allowed: true,
        stored: false,
        unknown: true,
        detail: "depot precedent d'etat INCONNU - retry automatique bloque pour eviter un doublon"
      }
    }
    return {
      allowed: true,
      stored: false,
      note: alreadyHere,
      detail: `déjà déposé dans cette session (${alreadyHere}) — rien de nouveau, et c’est voulu : le Brain ne dédoublonne pas la boîte de réception`
    }
  }
  let pending = pendingByLedger.get(deposited)
  if (!pending) {
    pending = new Map()
    pendingByLedger.set(deposited, pending)
  }
  const current = pending.get(key)
  if (current) {
    const joined = await current
    if (!joined.stored) return joined
    return {
      allowed: true,
      stored: false,
      note: joined.note,
      detail: `deja depose par l'appel concurrent (${joined.note ?? 'candidat'}) - aucun second appel reseau`
    }
  }
  const operation = performDepositCandidate(decision, deps, deposited)
  pending.set(key, operation)
  try {
    return await operation
  } finally {
    pending.delete(key)
  }
}

async function performDepositCandidate(
  decision: Extract<RememberDecision, { allowed: true }>,
  deps: RememberDeps,
  deposited: Map<string, string>
): Promise<DepositOutcome> {
  const token = deps.token ?? ''
  const origin = deps.origin ?? 'http://127.0.0.1:8765'
  const doFetch = deps.fetchFn ?? fetch
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), deps.timeoutMs ?? 2_000) // sleep-ok: borne d'abort d'un fetch, pas un sleep de polling
  try {
    const response = await doFetch(`${origin}/ingest`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        title: decision.title,
        body: decision.body,
        type: decision.type,
        scope: decision.scope,
        source: decision.source,
        tags: decision.tags,
        confidence: decision.confidence,
        author_agent: deps.authorAgent ?? 'autowin-os',
        model: deps.model ?? 'autowin'
      })
    })
    const payload = (await readSignedBrainPayload(response).catch(() => ({}))) as {
      /** Succès : le serveur rend un CONTEXTE SIGNÉ dont `context` porte le chemin de la note. */
      context?: string
      /** 409 : le Brain sait déjà — refus délibéré, pas une erreur. */
      status?: string
      error?: string
      service?: unknown
      protocol?: unknown
      signature?: unknown
    }
    /**
     * QUASI-DOUBLON — garde anti-bruit du Brain. Ce n'est PAS un échec : c'est le Brain qui dit « je le
     * sais déjà ». Le distinguer d'une erreur évite de faire croire à une panne.
     *
     * PORTÉE EXACTE, lue dans le serveur vivant le 2026-07-30 (`brain_server._handle_ingest`) : la
     * comparaison se fait contre le savoir CANONIQUE INDEXÉ, au seuil `NEAR_DUP_DENSE = 0.82`. `inbox/`
     * n'étant pas indexé, ce garde ne voit PAS les candidats en attente — d'où l'idempotence de session
     * ci-dessus. Ce chemin reste donc actif, mais il ne couvre que le doublon d'un savoir déjà promu.
     */
    if (response.status === 409 || payload.status === 'near-duplicate') {
      return {
        allowed: true,
        stored: false,
        detail: 'déjà connu du Brain (quasi-doublon) — rien n’a été ajouté, et c’est voulu'
      }
    }
    // SUCCÈS : le serveur répond 200 avec une enveloppe signée, PAS un `{ok:true}`.
    if (response.ok) {
      let verifiedContext: string
      try {
        verifiedContext = verifySignedBrainPayload(payload, token).context
      } catch {
        recordDepositState(deposited, decision, UNKNOWN_DEPOSIT, deps.workspace)
        return {
          allowed: true,
          stored: false,
          unknown: true,
          detail:
            'reponse Brain illisible ou d integrite invalide apres statut 200 - etat du depot INCONNU, ne retente pas a l aveugle'
        }
      }
      if (!verifiedContext) {
        recordDepositState(deposited, decision, UNKNOWN_DEPOSIT, deps.workspace)
        return {
          allowed: true,
          stored: false,
          unknown: true,
          detail:
            'reponse Brain vide apres statut 200 - etat du depot INCONNU, ne retente pas a l aveugle'
        }
      }
      const note = verifiedContext.split(/[\\/]/).pop() ?? verifiedContext
      const candidateId = signedInboxCandidateId(verifiedContext)
      recordDepositState(deposited, decision, note, deps.workspace)
      return {
        allowed: true,
        stored: true,
        note,
        ...(candidateId ? { candidateId } : {}),
        detail:
          'retenu comme CANDIDAT dans la boîte de réception du Brain — un humain le promeut, et il ne sera relisible qu’après réindexation' +
          (decision.truncated
            ? ' ⚠️ quelque chose dépassait la limite et a été TRONQUÉ (fait, titre ou étiquette) : relis le candidat avant de compter dessus'
            : '')
      }
    }
    /*
     * UNE ROUTE ABSENTE N'EST PAS UN REFUS. Mesure conv-9 (2026-08-31) : un depot est ressorti
     * « refusé par le Brain : not found ». Ce texte affirme que le Brain a EXAMINE le fait et l'a
     * ecarte ; un 404 dit exactement l'inverse — la route de depot n'existe pas sur ce serveur, donc
     * personne n'a rien lu. Le lecteur cherche alors ce qui cloche dans SON fait (type ? source ?
     * taille ?) au lieu de regarder le serveur, et il peut reecrire le fait dix fois sans rien
     * changer. Les deux causes se separent ici ; le motif d'un vrai refus reste rendu VERBATIM.
     */
    if (response.status === 404 || response.status === 501)
      return {
        allowed: true,
        stored: false,
        detail:
          `dépôt IMPOSSIBLE : la route de dépôt du Brain est absente de ce serveur (HTTP ${response.status}) — ` +
          'le fait n’a pas été examiné, rien n’a été refusé ; c’est le serveur qu’il faut corriger, pas le fait'
      }
    // Le motif du refus vient du serveur : on le rend TEL QUEL, sans le reformuler en succès.
    return {
      allowed: true,
      stored: false,
      detail: `refusé par le Brain : ${payload.error ?? `HTTP ${response.status}`}`
    }
  } catch (error) {
    // Un ABORT n'est PAS un « injoignable » : la requête a pu atteindre le serveur, qui a pu écrire le
    // candidat avant de répondre trop tard. Affirmer l'absence de contact pousse à retenter — et comme
    // `inbox/` n'est pas dédoublonné, ce retry crée un vrai doublon.
    // Sur l'ÉTAT réel du signal, jamais sur le texte du message : `read ECONNABORTED` contient « abort »
    // et se faisait classer « délai dépassé », dissuadant un retry pourtant légitime (audit 2026-07-30).
    const aborted = controller.signal.aborted
    if (aborted) {
      recordDepositState(deposited, decision, UNKNOWN_DEPOSIT, deps.workspace)
      return {
        allowed: true,
        stored: false,
        unknown: true,
        detail: `délai dépassé (${deps.timeoutMs ?? 2_000} ms) — état du dépôt INCONNU, le Brain a peut-être écrit. Ne retente pas à l’aveugle`
      }
    }
    return {
      allowed: true,
      stored: false,
      detail: `Brain injoignable : ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}

function signedInboxCandidateId(context: string): string | undefined {
  const parts = context.replace(/\\/gu, '/').split('/').filter(Boolean)
  const inbox = parts.lastIndexOf('inbox')
  if (inbox < 0 || inbox !== parts.length - 2) return undefined
  const basename = parts.at(-1)
  if (!basename || basename === '.' || basename === '..' || basename.includes('\0'))
    return undefined
  return `inbox/${basename}`
}
