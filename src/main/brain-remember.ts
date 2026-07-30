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
    test: (l) => /.+@[0-9a-fA-F]{7,64}$/.test(l),
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
    test: (l) => /^\d{4}-\d{2}-\d{2}/.test(l),
    expected: 'meeting:AAAA-MM-JJ'
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
  const title = text(args.title).slice(0, REMEMBER_TITLE_MAX)
  const body = text(args.fact ?? args.body).slice(0, REMEMBER_BODY_MAX)
  if (!title) return { allowed: false, reason: 'titre manquant — un fait sans titre est introuvable' }
  if (!body) return { allowed: false, reason: 'rien à retenir : le fait est vide' }

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

  const scope = text(args.scope)
  if (!scope) {
    return { allowed: false, reason: 'portée manquante — le projet concerné, ou « global »' }
  }

  const rawConfidence = text(args.confidence).toLowerCase()
  const confidence =
    rawConfidence === 'low' || rawConfidence === 'high' ? rawConfidence : ('medium' as const)

  const rawTags = Array.isArray(args.tags) ? args.tags : []
  const tags = rawTags.map((tag) => text(tag)).filter(Boolean).slice(0, 8)

  return { allowed: true, title, body, type, scope, source, tags, confidence }
}

export interface RememberOutcome {
  /** Le candidat a été DÉPOSÉ. Ne dit pas qu'il est promu : la promotion est humaine. */
  stored: boolean
  /** Ce qui s'est passé, à afficher tel quel. */
  detail: string
  /** Nom du fichier candidat, quand le serveur le rend. */
  note?: string
}

export interface RememberDeps {
  origin?: string
  token?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
  authorAgent?: string
  model?: string
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
     * QUASI-DOUBLON — garde anti-bruit du Brain (seuil de similarité 0,82). Ce n'est PAS un échec :
     * c'est le Brain qui dit « je le sais déjà ». Le distinguer d'une erreur évite de faire croire à
     * une panne, et évite qu'un agent réessaie en boucle.
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
      return {
        allowed: true,
        stored: true,
        note: payload.context.split(/[\\/]/).pop() ?? payload.context,
        detail:
          'retenu comme CANDIDAT dans la boîte de réception du Brain — un humain le promeut, et il ne sera relisible qu’après réindexation'
      }
    }
    // Le motif du refus vient du serveur : on le rend TEL QUEL, sans le reformuler en succès.
    return {
      allowed: true,
      stored: false,
      detail: `refusé par le Brain : ${payload.error ?? `HTTP ${response.status}`}`
    }
  } catch (error) {
    return {
      allowed: true,
      stored: false,
      detail: `Brain injoignable : ${error instanceof Error ? error.message : String(error)}`
    }
  } finally {
    clearTimeout(timer)
  }
}
