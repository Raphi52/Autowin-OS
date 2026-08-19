/**
 * DÉRIVE DE ROUTE — juger le flux d'un sous-agent PENDANT qu'il travaille.
 *
 * L'orchestrateur reçoit déjà, chunk par chunk, tout ce que ses sous-agents produisent : chaque
 * chemin d'exécution passe par `onDelta?.('exec', c.delta)`. Mais il ne fait que le RELAYER à
 * l'interface. Le seul garde qui trippe réellement — `createStreamWatchdog` dans
 * `providers/watchdog.ts`, câblé chez claude/codex/kimi — ne regarde que l'INACTIVITÉ et le temps
 * total : un agent qui écrit abondamment en tournant en rond ne le déclenche jamais. Le transport
 * existait, l'évaluation manquait.
 *
 * Ce module est cette évaluation, et il est volontairement PUR : pas d'horloge, pas de provider, pas
 * d'Electron, aucune E/S. On lui donne des deltas, il rend un constat. C'est ce qui permet de le
 * tester exhaustivement sans lancer un run à 20 $ — le défaut mesuré (conv-1302 : douze
 * orchestrations sur la même demande, aucune livrée) est exactement le genre de chose qu'on ne peut
 * pas se permettre de reproduire pour vérifier son détecteur.
 *
 * CE QU'IL N'EST PAS : un juge. Il ne dit jamais « la route est mauvaise », seulement « voilà un
 * signal MESURABLE qui mérite qu'on se pose la question ». Trancher (continuer, scouter, changer de
 * route) demande de comprendre l'objectif, et cela reste le travail d'un modèle — appelé UNE fois,
 * au trip, jamais en continu. Un détecteur qui déciderait seul de la destination serait une
 * heuristique déguisée en jugement.
 */

/** Ce qui a été OBSERVÉ. Chaque valeur se compte dans le texte — aucune n'est une impression. */
export type DriftSignal =
  /** La même erreur, normalisée, revue trop de fois : réessayer n'est plus de la malchance. */
  | 'erreur-repetee'
  /** Le même appel d'outil relancé à l'identique : la boucle est dans le comportement, pas la sortie. */
  | 'boucle-outil'
  /** L'agent DIT lui-même qu'il ne comprend pas / que ça ne marche toujours pas. */
  | 'doute-declare'
  /** Beaucoup de sortie, aucun marqueur de progrès : du texte, pas du travail. */
  | 'aucun-progres'

export interface DriftTrip {
  signal: DriftSignal
  /** Motif lisible, destiné à l'humain ET au prompt d'arbitrage. Porte le COMPTE, pas un adjectif. */
  detail: string
  /** L'extrait fautif, borné. Sans lui, l'arbitre devrait redemander le flux entier. */
  extrait: string
}

export interface RouteDriftOptions {
  /** Occurrences d'une même erreur normalisée avant de tripper. */
  seuilErreur?: number
  /** Occurrences d'une même signature d'outil avant de tripper. */
  seuilOutil?: number
  /** Caractères de sortie tolérés sans AUCUN marqueur de progrès. */
  volumeSansProgres?: number
}

export interface RouteDriftDetector {
  /**
   * Absorbe un delta. Rend le trip la PREMIÈRE fois qu'un seuil est franchi, puis `undefined` —
   * le trip est un événement, pas un état qu'on republierait à chaque chunk suivant.
   */
  beat(delta: string): DriftTrip | undefined
  /** Le trip déjà survenu, pour qui arrive après. */
  tripped(): DriftTrip | undefined
}

const DEFAULTS: Required<RouteDriftOptions> = {
  seuilErreur: 3,
  seuilOutil: 3,
  volumeSansProgres: 6000
}

/** Borne l'extrait remis à l'arbitre : un flux entier ferait exploser le prompt de décision. */
const EXTRAIT_MAX = 240

/**
 * Réduit une ligne à sa FORME. Sans cela, « ligne 41 » et « ligne 87 » de la même erreur comptent
 * pour deux, et une boucle parfaitement stable passe sous le seuil pour toujours.
 */
export function normaliserLigne(ligne: string): string {
  return ligne
    .toLowerCase()
    .replace(/[a-z]:[\\/][^\s"']+/g, '<chemin>')
    .replace(/[\\/][^\s"']*[\\/][^\s"']+/g, '<chemin>')
    .replace(/0x[0-9a-f]+/g, '<hex>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
}

const ERREUR =
  /\b(error|erreur|exception|failed|échec|echec|fail(ed)?:|traceback|assertionerror)\b/i

/**
 * Une invocation d'outil telle qu'elle apparaît dans un flux d'agent CLI. Les trois providers
 * l'écrivent différemment ; on reconnaît la forme commune « verbe(cible) » ou « ● Outil(cible) ».
 */
const OUTIL = /(?:^|[\s●•*>-])\s*([A-Z][A-Za-z]{2,15})\(([^)]{0,120})\)/

/**
 * Marqueurs de PROGRÈS. Volontairement des effets, pas des intentions : « je vais écrire » n'est pas
 * un progrès, un fichier écrit en est un. C'est ce qui distingue le signal du bavardage.
 */
const PROGRES =
  /\b(wrote|written|écrit|created|créé|modified|modifié|patch(ed)?|committed|passed|réussi|ok\b|\d+ (passed|tests?)|exit code 0)\b/i

export function createRouteDriftDetector(options: RouteDriftOptions = {}): RouteDriftDetector {
  const { seuilErreur, seuilOutil, volumeSansProgres } = { ...DEFAULTS, ...options }
  /** Reste de delta n'ayant pas encore fini sa ligne : les chunks coupent au milieu des mots. */
  let tampon = ''
  const erreurs = new Map<string, { n: number; brut: string }>()
  const outils = new Map<string, { n: number; brut: string }>()
  let depuisProgres = 0
  let trip: DriftTrip | undefined

  const borner = (texte: string): string =>
    texte.length <= EXTRAIT_MAX ? texte : `${texte.slice(0, EXTRAIT_MAX)}…`

  const examiner = (ligne: string): DriftTrip | undefined => {
    const propre = ligne.trim()
    if (!propre) return undefined

    if (PROGRES.test(propre)) depuisProgres = 0

    if (ERREUR.test(propre)) {
      const cle = normaliserLigne(propre)
      const vu = erreurs.get(cle)
      const n = (vu?.n ?? 0) + 1
      erreurs.set(cle, { n, brut: vu?.brut ?? propre })
      if (n >= seuilErreur) {
        return {
          signal: 'erreur-repetee',
          detail: `la même erreur est revenue ${n} fois`,
          extrait: borner(vu?.brut ?? propre)
        }
      }
    }

    const outil = OUTIL.exec(propre)
    if (outil) {
      const cle = normaliserLigne(`${outil[1]}(${outil[2]})`)
      const vu = outils.get(cle)
      const n = (vu?.n ?? 0) + 1
      outils.set(cle, { n, brut: vu?.brut ?? propre })
      if (n >= seuilOutil) {
        return {
          signal: 'boucle-outil',
          detail: `le même appel d'outil a été relancé ${n} fois à l'identique`,
          extrait: borner(vu?.brut ?? propre)
        }
      }
    }

    if (exprimeUnDoute(propre)) {
      return {
        signal: 'doute-declare',
        detail: "l'agent déclare lui-même être bloqué",
        extrait: borner(propre)
      }
    }
    return undefined
  }

  return {
    beat(delta: string): DriftTrip | undefined {
      if (trip || !delta) return undefined
      depuisProgres += delta.length
      tampon += delta
      const morceaux = tampon.split('\n')
      // Le dernier morceau n'est pas terminé par un saut de ligne : il attend la suite.
      tampon = morceaux.pop() ?? ''
      for (const ligne of morceaux) {
        const constat = examiner(ligne)
        if (constat) {
          trip = constat
          return trip
        }
      }
      if (depuisProgres >= volumeSansProgres) {
        trip = {
          signal: 'aucun-progres',
          detail: `${depuisProgres} caractères produits sans aucun marqueur de progrès`,
          extrait: borner(morceaux[morceaux.length - 1] ?? tampon)
        }
        return trip
      }
      return undefined
    },
    tripped: () => trip
  }
}

/**
 * L'agent qui se déclare bloqué est le signal le moins cher et le plus fiable qu'on ait : il vient
 * de la seule instance qui sait ce qu'elle essayait de faire. Les formes sont listées, pas devinées
 * par sentiment — une expression absente d'ici ne trippe pas, ce qui est préférable à un détecteur
 * qui se déclenche sur « je ne suis pas sûr du nom de ce fichier ».
 */
export function exprimeUnDoute(ligne: string): boolean {
  return [
    /je ne comprends pas pourquoi/i,
    /toujours la même erreur/i,
    /(ça|cela) ne (fonctionne|marche) toujours pas/i,
    /je (suis|semble) bloqué/i,
    /je tourne en rond/i,
    /i (still )?(don't|do not) understand why/i,
    /same error (again|as before)/i,
    /still (failing|fails|broken|not working)/i,
    /i'?m stuck/i
  ].some((forme) => forme.test(ligne))
}

/**
 * La question posée à l'arbitre au moment du trip — et UNIQUEMENT à ce moment. Elle porte le constat
 * mesuré, pas une conclusion : dire à un modèle « la route est mauvaise » lui fait confirmer une
 * prémisse qu'il n'a pas vérifiée. Le droit de répondre « continuer » est explicite, sinon un modèle
 * serviable bifurque toujours et la phase ne finit jamais.
 */
export function briefArbitrage(trip: DriftTrip, phase: string, objectif: string): string {
  return [
    `Tu arbitres une DÉRIVE DE ROUTE détectée pendant la phase \`${phase}\`.`,
    ``,
    `Objectif du run : ${objectif}`,
    ``,
    `Constat mesuré (pas un jugement) : ${trip.detail}.`,
    `Extrait : ${trip.extrait}`,
    ``,
    `Ce constat ne prouve PAS que la route est mauvaise — un agent peut légitimement buter trois`,
    `fois sur la même erreur avant de la résoudre. Tranche sur ce que tu vois.`,
    ``,
    `Réponds par UNE seule ligne, rien d'autre :`,
    `  ROUTE: continuer        — l'agent va s'en sortir, on ne l'interrompt pas`,
    `  ROUTE: scout            — il faut chercher une autre approche avant de continuer`,
    `  ROUTE: <phase>          — il faut repartir d'une autre phase du pipeline`,
    `  ROUTE: fin              — plus rien d'utile à jouer sur cette demande`
  ].join('\n')
}

/** Ce que l'arbitre a tranché. `continuer` = on n'interrompt rien, et c'est une réponse normale. */
export type RouteVerdict =
  { kind: 'continuer' } | { kind: 'phase'; phase: string } | { kind: 'stop' } | undefined

/**
 * Lit la décision. Cherchée sur une ligne à elle : un arbitre qui raconte son raisonnement en
 * mentionnant « route » au fil du texte ne pilote pas. Absent = `continuer`, DÉLIBÉRÉMENT — une
 * réponse illisible ne doit jamais avoir pour effet d'avorter le travail en cours.
 */
export function readRouteVerdict(texte: string): RouteVerdict {
  const ligne = texte
    .split('\n')
    .reverse()
    .find((l) => /^\s*ROUTE\s*:/i.test(l))
  if (!ligne) return { kind: 'continuer' }
  const valeur = ligne
    .replace(/^\s*ROUTE\s*:/i, '')
    .trim()
    .toLowerCase()
  if (!valeur || /^continuer?$/.test(valeur)) return { kind: 'continuer' }
  if (/^(fin|stop|aucune?|rien)$/.test(valeur)) return { kind: 'stop' }
  return { kind: 'phase', phase: valeur }
}

/**
 * LA SUPERVISION MI-PHASE elle-même — ce qui rend l'interruption possible sans toucher au transport.
 *
 * Elle s'intercale entre le provider et `onDelta` : chaque chunk continue d'aller à l'interface
 * exactement comme avant, ET passe au détecteur. Au trip, elle avorte l'appel en cours via son propre
 * `AbortController`, chaîné au signal d'annulation de l'utilisateur : une annulation humaine reste
 * prioritaire, et l'avortement pour dérive ne se confond pas avec elle (`avortePourDerive`).
 *
 * Elle garde le texte DÉJÀ produit. Sans lui, avorter jetterait le travail de l'agent et la phase
 * repartirait de zéro — on aurait remplacé un run qui s'entête par un run qui oublie.
 */
export interface MidPhaseSupervision {
  /** À passer au provider à la place du `onDelta` d'origine. */
  onDelta: (delta: string) => void
  /** À passer comme `signal` de l'appel. Avorte sur dérive OU sur annulation utilisateur. */
  signal: AbortSignal
  /** Vrai si c'est NOUS qui avons avorté, et non l'utilisateur. Distingue les deux dans le `catch`. */
  avortePourDerive: () => boolean
  trip: () => DriftTrip | undefined
  /** Le texte produit avant l'avortement. Jamais jeté. */
  texte: () => string
  dispose: () => void
}

export function createMidPhaseSupervision(opts: {
  /** Le relais d'origine — il continue de recevoir TOUT, dérive ou pas. */
  forward?: (delta: string) => void
  /** L'annulation utilisateur, si le run en porte une. */
  signal?: AbortSignal
  detector?: RouteDriftDetector
  options?: RouteDriftOptions
}): MidPhaseSupervision {
  const detector = opts.detector ?? createRouteDriftDetector(opts.options)
  const controller = new AbortController()
  let derive = false
  let texte = ''
  const relayer = (): void => controller.abort()
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort()
    else opts.signal.addEventListener('abort', relayer, { once: true })
  }
  return {
    onDelta(delta: string): void {
      texte += delta
      // Le relais d'abord : l'utilisateur doit voir le chunk même si c'est celui qui trippe.
      opts.forward?.(delta)
      if (derive) return
      if (detector.beat(delta)) {
        derive = true
        controller.abort()
      }
    },
    signal: controller.signal,
    avortePourDerive: () => derive,
    trip: () => detector.tripped(),
    texte: () => texte,
    dispose(): void {
      opts.signal?.removeEventListener('abort', relayer)
    }
  }
}
