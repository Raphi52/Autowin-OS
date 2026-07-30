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
 *  - un candidat va dans `inbox/`, JAMAIS dans `knowledge/` : la promotion reste HUMAINE. Le serveur
 *    l'impose, ce module ne fait que l'annoncer honnêtement à l'agent ;
 *  - ce n'est PAS relu au tour suivant. L'index se reconstruit par générations, donc un fait retenu
 *    aujourd'hui devient trouvable plus tard. C'est la différence de mécanique avec claude.exe, et elle
 *    doit être DITE au modèle plutôt que découverte.
 *
 * Ce module est PUR côté décision (validation, forme du candidat) ; l'appel réseau est injectable.
 */

import { SECRET_TOKEN_SHAPES } from './activity/trace-redact'

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
const VALEUR_A_FORME_DE_SECRET = String.raw`["']?(?=[A-Za-z0-9_./+=-]{16,})(?=[A-Za-z0-9_./+=-]*[a-z])(?=[A-Za-z0-9_./+=-]*[0-9])`

/** `aws_secret_access_key=…` : le mot-clé n'est collé ni au début du mot, ni au `=`. */
const SNAKE_CASE_SECRET = new RegExp(
  String.raw`[A-Za-z0-9]_(?:secret|token|password|passwd|api_?key)[a-z0-9_]*\s*[:=]\s*` + VALEUR_A_FORME_DE_SECRET
)
/** `token=…` : mot-clé nu, mais la VALEUR doit ressembler à un secret, pas à une phrase. */
const KEYED_SECRET = new RegExp(
  String.raw`\b(?:api[_-]?key|token|secret|password|passwd)\s*[:=]\s*` + VALEUR_A_FORME_DE_SECRET
)

/**
 * Décrit le secret repéré localement, ou `undefined`. Complète les gardes existants sans les dupliquer.
 *
 * Les formes de jetons viennent de `SECRET_TOKEN_SHAPES` (trace-redact.ts), déjà écrit et testé. On
 * n'importe QUE cette moitié : la moitié « mot-clé = valeur » du motif de rédaction accepte n'importe
 * quelle valeur, ce qui est sans risque pour rédiger mais refuserait ici « le champ token: obligatoire ».
 * Pour ce cas on garde donc un motif local qui exige une valeur À FORME de secret.
 */
export function likelySecretShape(text: string): string | undefined {
  if (SECRET_TOKEN_SHAPES.test(text)) return 'un jeton ou une clé'
  if (SNAKE_CASE_SECRET.test(text) || KEYED_SECRET.test(text)) return 'un secret nommé par sa clé'
  return undefined
}

/**
 * Tronque en respectant une frontière de phrase puis de mot, et DIT que c'est tronqué.
 *
 * Une coupe brute au caractère 4 000 peut tomber juste après une négation (« … ne doit PAS être fait »)
 * et faire dire au candidat l'INVERSE du fait voulu — silencieusement, alors que le contrat exige un fait
 * « autoporté, relisible dans 3 mois ». Défaut relevé par l'audit du 2026-07-30.
 */
export function truncateFact(body: string, max = REMEMBER_BODY_MAX): { body: string; truncated: boolean } {
  if (body.length <= max) return { body, truncated: false }
  // La marque est BUDGÉTÉE : sans ça le résultat dépassait la borne qu'il est censé faire respecter.
  const MARK = ' […tronqué]'
  // Sous la longueur de la marque, la marque elle-même dépasserait la borne : coupe nue.
  if (max <= MARK.length) return { body: body.slice(0, max), truncated: true }
  const window = body.slice(0, max - MARK.length)
  const sentence = Math.max(window.lastIndexOf('. '), window.lastIndexOf('! '), window.lastIndexOf('? '))
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
    expected: 'file:<chemin ABSOLU existant côté serveur> — pour un fichier de dépôt, préférer git:<chemin>@<sha>'
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
  if (!title) return { allowed: false, reason: 'titre manquant — un fait sans titre est introuvable' }
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

  const rawType = text(args.type).toLowerCase()
  const type = (REMEMBER_TYPES as readonly string[]).includes(rawType)
    ? (rawType as RememberType)
    : undefined
  if (!type) {
    return {
      allowed: false,
      reason: `type invalide — attendu l'un de : ${REMEMBER_TYPES.join(', ')}`
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

  return { allowed: true, title, body, type, scope, source, tags, confidence, truncated: anythingCut }
}

export interface RememberOutcome {
  /** Le candidat a été DÉPOSÉ. Ne dit pas qu'il est promu : la promotion est humaine. */
  stored: boolean
  /** Ce qui s'est passé, à afficher tel quel. */
  detail: string
  /** Nom du fichier candidat, quand le serveur le rend. */
  note?: string
  /**
   * L'état du dépôt est INDÉTERMINÉ (abort, réponse illisible) : ni succès, ni refus.
   * Le distinguer d'un refus est ce qui empêche un agent de retenter et de créer un doublon — or le
   * serveur ne dédoublonne PAS contre `inbox/` (voir le commentaire du 409).
   */
  unknown?: boolean
}

/**
 * IDEMPOTENCE CÔTÉ CLIENT — parce que le serveur n'en offre pas sur ce cas.
 *
 * Le garde anti-doublon du serveur compare au savoir CANONIQUE indexé (`retriever.query`, seuil
 * `NEAR_DUP_DENSE = 0.82`). Or `inbox/` n'est PAS indexé : deux dépôts du MÊME fait renvoient donc deux
 * fois 200 et créent deux fichiers. Observé le 2026-07-30 (deux POST identiques → deux candidats), et
 * corroboré par deux fiches quasi jumelles déposées à 09:47 et 09:48 le même jour.
 * On garde donc l'empreinte de ce qui a déjà été déposé DANS CETTE SESSION.
 */
const depositedThisSession = new Map<string, string>()
const SESSION_MEMO_MAX = 200

/** Vide la mémoire de dépôt. Existe pour que rien ne fuite d'un test à l'autre. */
export function forgetSessionDeposits(): void {
  depositedThisSession.clear()
}

function fingerprint(title: string, body: string): string {
  return `${title.toLowerCase()} ${body.toLowerCase()}`
}

export interface RememberDeps {
  origin?: string
  token?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  authorAgent?: string
  model?: string
  /**
   * Où retenir ce qui a déjà été déposé. Injectable pour ne pas cacher un état global : la production
   * partage la mémoire du module, un test fournit la sienne et reste isolé.
   */
  deposited?: Map<string, string>
}

/**
 * Dépose le candidat sur `POST /ingest`. Ne throw JAMAIS : un échec d'écriture est un résultat à
 * afficher, pas une exception qui casse le tour.
 */
export async function rememberFact(
  args: Record<string, unknown>,
  deps: RememberDeps = {}
): Promise<RememberOutcome & { allowed: boolean; reason?: string }> {
  const decision = decideRemember(args)
  if (!decision.allowed) {
    return { allowed: false, reason: decision.reason, stored: false, detail: decision.reason }
  }
  const token = deps.token ?? ''
  if (!token) {
    return {
      allowed: true,
      stored: false,
      detail: 'jeton du Brain absent — rien n’a été écrit (définir AMITEL_BRAIN_TOKEN)'
    }
  }
  const deposited = deps.deposited ?? depositedThisSession
  const alreadyHere = deposited.get(fingerprint(decision.title, decision.body))
  if (alreadyHere) {
    return {
      allowed: true,
      stored: false,
      note: alreadyHere,
      detail: `déjà déposé dans cette session (${alreadyHere}) — rien de nouveau, et c’est voulu : le Brain ne dédoublonne pas la boîte de réception`
    }
  }
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
    const payload = (await response.json().catch(() => ({}))) as {
      /** Succès : le serveur rend un CONTEXTE SIGNÉ dont `context` porte le chemin de la note. */
      context?: string
      /** 409 : le Brain sait déjà — refus délibéré, pas une erreur. */
      status?: string
      error?: string
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
    // SUCCÈS : le serveur répond 200 avec un contexte SIGNÉ (`{service, protocol, context, signature}`),
    // PAS un `{ok:true}`. Défaut trouvé par un essai LIVE : ma première version exigeait `ok === true` et
    // aurait donc annoncé « refusé » sur CHAQUE succès. Aucune lecture de code ne l'avait montré.
    if (response.ok && typeof payload.context === 'string' && payload.context) {
      const note = payload.context.split(/[\\/]/).pop() ?? payload.context
      if (deposited.size >= SESSION_MEMO_MAX) {
        deposited.delete(deposited.keys().next().value as string)
      }
      deposited.set(fingerprint(decision.title, decision.body), note)
      return {
        allowed: true,
        stored: true,
        note,
        detail:
          'retenu comme CANDIDAT dans la boîte de réception du Brain — un humain le promeut, et il ne sera relisible qu’après réindexation' +
          (decision.truncated
            ? ' ⚠️ quelque chose dépassait la limite et a été TRONQUÉ (fait, titre ou étiquette) : relis le candidat avant de compter dessus'
            : '')
      }
    }
    // 200 SANS contexte lisible (corps tronqué, proxy, réponse non-JSON) : le serveur a peut-être écrit.
    // L'annoncer « refusé » était un mensonge dans les deux sens — et poussait à retenter, donc à doubler.
    if (response.ok) {
      return {
        allowed: true,
        stored: false,
        unknown: true,
        detail:
          'réponse du Brain illisible malgré un statut 200 — état du dépôt INCONNU. Ne retente pas à l’aveugle : vérifie avec brain_query plus tard'
      }
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
