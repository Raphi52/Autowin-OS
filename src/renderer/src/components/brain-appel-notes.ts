import type { BrainTrace } from '../../../main/activity/brain-trace-spool'

export interface NoteAppel {
  path: string
  /** Proximité avec la demande (0 à 1), quand le Brain l'a mesurée. */
  proximite?: number
}

/**
 * Ce que l'agent a VRAIMENT reçu, et ce que le Brain a trouvé sans que ce soit transmis.
 *
 * Le Brain marque « retenues » les notes qu'il renvoie ; ce n'est pas ce qui part vers l'agent.
 * Les notes proches du tour ne gardent que les 3 premières assez proches et pas déjà montrées
 * dans le fil (`brain-titres-du-tour.ts`) : afficher toutes les « retenues » à côté de
 * « 0 caractère transmis » laissait croire que 7 notes avaient été envoyées.
 */
export function repartirNotesAppel(trace: BrainTrace): {
  transmises: NoteAppel[]
  ecartees: NoteAppel[]
} {
  const retenues = trace.navigation?.candidates.filter((c) => c.retained) ?? []
  const normaliser = (path: string): string => path.split('\\').join('/')
  const versNote = (c: (typeof retenues)[number]): NoteAppel => ({
    path: normaliser(c.path),
    proximite: c.denseCos
  })
  if (trace.notes) {
    const servies = new Set(trace.notes.map(normaliser))
    const parChemin = new Map(retenues.map((c) => [normaliser(c.path), c]))
    return {
      transmises: trace.notes.map((path) => {
        const c = parChemin.get(normaliser(path))
        return c ? versNote(c) : { path }
      }),
      ecartees: retenues.filter((c) => !servies.has(normaliser(c.path))).map(versNote)
    }
  }
  if (trace.injectedChars > 0) return { transmises: retenues.map(versNote), ecartees: [] }
  return { transmises: [], ecartees: retenues.map(versNote) }
}
