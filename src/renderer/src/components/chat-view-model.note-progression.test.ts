import { describe, expect, it } from 'vitest'
import { reduceScopedLiveRuns, type ScopedLiveRun } from './chat-view-model'

/**
 * UNE NOTE DE PROGRESSION N'EST PAS DU TEXTE DE LIVRABLE.
 *
 * Le relais des battements d'outil (commit 14cf47c) produit « Bash en cours — 2 min 30 s » cote
 * provider, mais l'orchestrateur ne transmettait que `chunk.delta` : la note mourait la, et la carte
 * du fil restait muette pendant qu'un sous-agent travaillait 15 min. Constate le 2026-08-22 apres
 * cinq mesures, dont une avec 34 `tool_progress` emis et zero note affichee.
 *
 * La note prend donc son PROPRE champ. L'ajouter a `liveText` l'aurait melee au livrable, qui est
 * ensuite persiste et relu : une trace d'activite deviendrait un morceau de la reponse.
 */
const base = (): Record<string, ScopedLiveRun> => ({
  'conv-1': { convId: 'conv-1', task: 't', steps: [], status: 'running' }
})

describe('note de progression du run vivant', () => {
  it('se pose dans son propre champ, sans toucher au texte du livrable', () => {
    const apres = reduceScopedLiveRuns(base(), {
      type: 'note',
      convId: 'conv-1',
      note: 'Bash en cours — 2 min 30 s'
    })
    expect(apres['conv-1'].note).toBe('Bash en cours — 2 min 30 s')
    expect(apres['conv-1'].liveText).toBeUndefined()
  })

  it('REMPLACE la note precedente au lieu de l accumuler', () => {
    // Un battement toutes les 30 s pendant 15 min ferait 30 lignes empilees : on veut l'etat
    // COURANT, pas un journal.
    let etat = reduceScopedLiveRuns(base(), { type: 'note', convId: 'conv-1', note: 'Bash en cours — 1 min' })
    etat = reduceScopedLiveRuns(etat, { type: 'note', convId: 'conv-1', note: 'Bash en cours — 2 min' })
    expect(etat['conv-1'].note).toBe('Bash en cours — 2 min')
  })

  it('s efface quand la phase change : la note appartient a la phase qui travaille', () => {
    const avec = reduceScopedLiveRuns(base(), { type: 'note', convId: 'conv-1', note: 'Bash en cours — 1 min' })
    const apres = reduceScopedLiveRuns(avec, {
      type: 'phase',
      convId: 'conv-1',
      phase: { step: 'judge' }
    })
    expect(apres['conv-1'].note).toBeUndefined()
  })

  it('s efface quand l etape est enregistree : plus rien ne tourne', () => {
    const avec = reduceScopedLiveRuns(base(), { type: 'note', convId: 'conv-1', note: 'Bash en cours — 1 min' })
    const apres = reduceScopedLiveRuns(avec, { type: 'step', convId: 'conv-1', step: {} })
    expect(apres['conv-1'].note).toBeUndefined()
  })

  it('une note sur un run inconnu ne cree rien', () => {
    // Entree-refuteur : sinon un evenement en retard ressusciterait un run efface.
    expect(reduceScopedLiveRuns({}, { type: 'note', convId: 'conv-absent', note: 'x' })).toEqual({})
  })

  it('le texte du livrable continue de s accumuler normalement — non regresse', () => {
    let etat = reduceScopedLiveRuns(base(), { type: 'delta', convId: 'conv-1', delta: 'Voi' })
    etat = reduceScopedLiveRuns(etat, { type: 'note', convId: 'conv-1', note: 'Bash en cours — 1 min' })
    etat = reduceScopedLiveRuns(etat, { type: 'delta', convId: 'conv-1', delta: 'ci' })
    expect(etat['conv-1'].liveText).toBe('Voici')
  })
})
