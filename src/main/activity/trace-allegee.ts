import type { TraceEventV1, TracePayload } from './trace-event'

/**
 * LECTURES DU GRAPHE D'EXÉCUTION — la trace SANS ses contenus, et les contenus d'une étape à la demande.
 *
 * Le défaut, mesuré le 2026-10-10 : le graphe du chat relisait `os:causalTrace` chaque seconde pendant
 * un tour vivant, et ce canal renvoie la conversation ENTIÈRE, contenus compris. Sur `conv-72.jsonl`
 * (217 Mo, 4 562 événements), les charges pèsent 206 Mo — dont 183 Mo de prompts portés par les
 * événements `message`. Copier ce tableau vers l'écran coûtait 409 Mo sérialisés et ~640 ms ; sans les
 * contenus : 3,9 Mo et ~100 ms (aller-retour v8.serialize/deserialize, Node). `gels.jsonl` comptait 23
 * gels attribués à `ipc:os:causalTrace` du 1er au 10 octobre (jusqu'à 3 s chacun).
 *
 * Or le graphe n'AFFICHE aucun contenu dans son arbre : il ne lit les prompts, retours et raisonnements
 * qu'au clic sur une étape. Il reçoit donc la structure seule, puis les charges de l'étape ouverte.
 * Les lectures restent PURES : aucune n'écrit dans la trace (contrat `native-prompt-traces-readonly`).
 */

/**
 * Longueur gardée de l'extrait « UTILISATEUR: … » d'un message. Le sélecteur de tours en tire un libellé
 * de 80 caractères (`turnOption` → `extractHumanMessage(…, 80)`) : 2 000 caractères bruts laissent une
 * marge large aux espaces et aux balises `<message_utilisateur>` retirés avant la coupe.
 */
const EXTRAIT_DEMANDE_MAX = 2000

/** Plafonds d'une demande de charges : une étape absorbe quelques événements, jamais des milliers. */
const IDS_MAX = 500
const GENRES_MAX = 32

/**
 * Le DERNIER segment `UTILISATEUR:` d'un contenu composé (`ÉTAT DE L'APP:\n{json}\n\nUTILISATEUR: …`),
 * borné ; vide quand le contenu n'en porte pas.
 *
 * Même découpe que `extractHumanMessage` (segments séparés par une ligne vide, le dernier gagne) : le
 * libellé tiré de l'extrait est donc celui que le contenu entier aurait donné. Tout le reste — état de
 * l'app, consignes, historique — ne quitte pas le processus principal.
 */
export function extraitDemandeUtilisateur(contenu: string): string {
  const segments = contenu.split('\n\n')
  for (let rang = segments.length - 1; rang >= 0; rang -= 1) {
    if (/^\s*UTILISATEUR\s*:/.test(segments[rang]))
      return segments[rang].slice(0, EXTRAIT_DEMANDE_MAX)
  }
  return ''
}

/**
 * Longueur gardée de la CAUSE d'un échec. La carte d'un sous-agent en échec l'écrit sur une ligne
 * coupée (« checkpoint orchestration causalement invalide : … », 82 caractères sur conv-163) ; le
 * texte entier reste lisible au clic, par `chargesDesEvenements`.
 */
const EXTRAIT_CAUSE_MAX = 300

/** Genres qui portent la cause d'un échec — ceux que lit `failureCause` côté écran. */
const GENRES_DE_CAUSE = new Set(['error', 'model-response'])

/** Un appel d'outil en échec porte aussi une charge `error` : ce n'est pas la cause d'une étape. */
const TYPES_OUTIL = new Set(['tool-call', 'tool-result'])

function contenuAllege(event: TraceEventV1, charge: TracePayload): string {
  if (event.type === 'message') return extraitDemandeUtilisateur(charge.content)
  if (event.status === 'failed' && !TYPES_OUTIL.has(event.type) && GENRES_DE_CAUSE.has(charge.kind))
    return charge.content.slice(0, EXTRAIT_CAUSE_MAX)
  return ''
}

/**
 * La trace sans ses contenus : chaque charge garde son genre, son nom et son type, contenu vidé.
 * Deux exceptions bornées : un `message` garde l'extrait de la demande humaine (sélecteur de tours),
 * et une étape EN ÉCHEC garde l'extrait de sa cause (carte du sous-agent, constaté vide le 2026-10-10).
 */
export function allegerTracePourGraphe(events: readonly TraceEventV1[]): TraceEventV1[] {
  return events.map((event) => ({
    ...event,
    payloads: event.payloads.map((charge) => ({
      kind: charge.kind,
      ...(charge.name !== undefined ? { name: charge.name } : {}),
      ...(charge.mediaType !== undefined ? { mediaType: charge.mediaType } : {}),
      content: contenuAllege(event, charge)
    }))
  }))
}

/** Valide une liste de chaînes reçue de l'écran : un tableau borné de chaînes non vides, sinon rien. */
export function listeDeChaines(valeur: unknown, max: number, champ: string): string[] {
  if (!Array.isArray(valeur)) throw new Error(`${champ} doit être une liste`)
  if (valeur.length > max) throw new Error(`${champ} dépasse ${max} entrées`)
  return valeur.map((element) => {
    if (typeof element !== 'string' || element.trim() === '') {
      throw new Error(`${champ} contient une entrée invalide`)
    }
    return element
  })
}

/**
 * Les charges ENTIÈRES des événements nommés, limitées aux genres demandés. Un genre non demandé
 * (contenu d'outil, état de l'app) ne sort jamais : le graphe s'interdit de les montrer, inutile de
 * les copier vers l'écran.
 */
export function chargesDesEvenements(
  events: readonly TraceEventV1[],
  idsBruts: unknown,
  genresBruts: unknown
): Record<string, TracePayload[]> {
  const ids = new Set(listeDeChaines(idsBruts, IDS_MAX, 'eventIds'))
  const genres = new Set(listeDeChaines(genresBruts, GENRES_MAX, 'kinds'))
  const charges: Record<string, TracePayload[]> = {}
  for (const event of events) {
    if (!ids.has(event.id)) continue
    charges[event.id] = event.payloads
      .filter((charge) => genres.has(charge.kind))
      .map((charge) => ({ ...charge }))
  }
  return charges
}
