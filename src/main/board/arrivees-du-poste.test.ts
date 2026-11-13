import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'

const donnees = vi.hoisted(() => ({ dossier: '' }))
vi.mock('electron', () => ({ app: { getPath: () => donnees.dossier } }))

import { arriveesDuPoste } from './arrivees-du-poste'

donnees.dossier = mkdtempSync(join(tmpdir(), 'arrivees-du-poste-'))
afterAll(() => rmSync(donnees.dossier, { recursive: true, force: true }))

describe('arriveesDuPoste — la lecture partagée du Board et des fiches', () => {
  it('dit de quel dépôt vient le journal de main, pour que la carte ne juge que les fils de ce dépôt', () => {
    const depot = join(donnees.dossier, 'depot-de-l-app')
    const arrivee = arriveesDuPoste(() => depot)
    expect(arrivee.depotDuJournal).toBe(depot)
    // La réponse du fil reste servie : seul le dépôt s'ajoute.
    expect(typeof arrivee.filApres).toBe('function')
    expect(arrivee('conv-1', 'tour-inconnu')).toBeUndefined()
  })
})
