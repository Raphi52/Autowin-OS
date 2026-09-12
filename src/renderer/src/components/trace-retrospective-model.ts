/**
 * Forme MINIMALE de ce que le panneau lit dans un evenement de trace. Volontairement locale et non
 * importee de `src/main` : la configuration de typage du rendu n'inclut pas le processus principal,
 * et le panneau n'a besoin que de ces champs-la. Elle reste compatible avec `TraceEventV1`.
 */
export interface TraceEventLu {
  turnId: string
  timestamp: string
  sequence: number
  type: string
  status: string
  actor?: { id?: string; kind?: string; label?: string }
  payloads?: ReadonlyArray<{ kind: string; content: string; name?: string }>
}

/**
 * Rétrospective LISIBLE d'une conversation : le raisonnement et les actions d'un tour vivaient
 * déjà sur le disque (causal-trace/*.jsonl) mais n'étaient consultables NULLE PART dans l'app —
 * le bloc « Actions » du fil n'en garde qu'un résumé, et seulement pour les tours récents.
 * Ce modèle relit la trace et la replie en tours, pour l'onglet « Trace » du panneau de droite.
 */
export interface TraceActionLigne {
  /** Nom de l'outil appelé, tel qu'enregistré (`Bash`, `Read`, `orchestrate`…). */
  nom: string
  /** Première ligne utile de l'appel — le chemin, la commande, la cible. Peut être vide. */
  detail: string
  statut: string
  horodatage: string
}

export interface TraceTour {
  turnId: string
  /** Horodatage du PREMIER événement du tour — l'ordre d'affichage s'y appuie. */
  debut: string
  /** Message utilisateur qui a ouvert le tour, s'il a été tracé. */
  demande: string
  raisonnement: string[]
  actions: TraceActionLigne[]
}

const MAX_DETAIL = 160

function premiereLigne(contenu: string): string {
  const ligne = contenu
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l !== '')
  return (ligne ?? '').slice(0, MAX_DETAIL)
}

/**
 * `tool-call` porte l'appel soit en texte, soit en JSON `{"name":…,"args":…}` selon l'émetteur.
 * On lit les deux plutôt que d'en imposer un : une trace déjà écrite ne se réécrit pas.
 */
function lireAppel(payloadContenu: string, repli: string): { nom: string; detail: string } {
  try {
    const brut: unknown = JSON.parse(payloadContenu)
    if (brut && typeof brut === 'object') {
      const objet = brut as Record<string, unknown>
      const nom = typeof objet.name === 'string' ? objet.name : repli
      const args = objet.args ?? objet.input
      const detail =
        typeof args === 'string'
          ? premiereLigne(args)
          : args && typeof args === 'object'
            ? premiereLigne(
                Object.values(args as Record<string, unknown>)
                  .filter((v) => typeof v === 'string' || typeof v === 'number')
                  .map(String)
                  .join(' · ')
              )
            : ''
      return { nom, detail }
    }
  } catch {
    /* pas du JSON : c'est du texte brut, traité ci-dessous */
  }
  return { nom: repli, detail: premiereLigne(payloadContenu) }
}

/**
 * Replie les événements bruts en tours affichables. Les tours sont rendus du plus RÉCENT au plus
 * ancien : dans un panneau on cherche ce qui vient de se passer, pas le début de la conversation.
 */
export function construireRetrospective(events: readonly TraceEventLu[]): TraceTour[] {
  const parTour = new Map<string, TraceTour>()

  const tourDe = (event: TraceEventLu): TraceTour => {
    const existant = parTour.get(event.turnId)
    if (existant) return existant
    const neuf: TraceTour = {
      turnId: event.turnId,
      debut: event.timestamp,
      demande: '',
      raisonnement: [],
      actions: []
    }
    parTour.set(event.turnId, neuf)
    return neuf
  }

  for (const event of [...events].sort((a, b) => a.sequence - b.sequence)) {
    if (!event?.turnId) continue
    const tour = tourDe(event)

    if (event.type === 'message' && event.actor?.kind === 'human' && !tour.demande) {
      const contenu = event.payloads?.find((p) => p.kind === 'user-message')?.content
      if (contenu) tour.demande = premiereLigne(contenu)
    }

    // Le raisonnement du modele est lui-meme ecrit en `decision` (reasoning-trace.ts) : filtrer sur
    // le TYPE le supprimait entierement de l'onglet. Le discriminant est l'ACTEUR — un recu
    // d'autorite (« orchestrate - mutation oui, risque sensitive, decision allow ») vient de
    // `autowin-authority`, acteur `system`, alors que la pensee vient d'un acteur `agent`.
    const recuDAutorite = event.type === 'decision' && event.actor?.kind === 'system'
    if (!recuDAutorite) {
      for (const payload of event.payloads ?? []) {
        if (payload.kind === 'reasoning' && payload.content.trim())
          tour.raisonnement.push(payload.content.trim())
      }
    }

    if (event.type === 'tool-call') {
      const payload = event.payloads?.find((p) => p.kind === 'tool-call')
      const { nom, detail } = lireAppel(payload?.content ?? '', payload?.name ?? event.actor?.label ?? 'outil')
      tour.actions.push({ nom, detail, statut: event.status, horodatage: event.timestamp })
    }
  }

  return [...parTour.values()]
    .filter((tour) => tour.raisonnement.length > 0 || tour.actions.length > 0)
    .sort((a, b) => (a.debut < b.debut ? 1 : a.debut > b.debut ? -1 : 0))
}
