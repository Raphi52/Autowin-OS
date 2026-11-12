/**
 * L'état poussé au modèle du chat NOMME les clés du coffre — triées, et rien d'autre.
 *
 * Sans ce champ, l'agent ignore qu'une clé est servie et la réclame dans le fil, ou refuse faute de
 * droit. Avec une valeur, le secret partirait dans le prompt à chaque tour.
 * Entrée qui rend ces tests rouges : retirer `clesDuCoffrePourLePrompt()` de `snapshotForPrompt`, ou y
 * laisser passer `longueur` ou une valeur.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Coffre } from '../app/coffre-cles'

const coffreDeTest = vi.hoisted(() => ({ courant: undefined as Coffre | undefined }))

vi.mock('../app/coffre-cles', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../app/coffre-cles')>()
  return { ...reel, listerCles: () => coffreDeTest.courant!.listerCles() }
})

import { creerCoffre } from '../app/coffre-cles'
import { AppCommandBus } from './commands'

const os = {
  executionWorkspace: process.cwd(),
  conversations: { listResumes: () => [] },
  registry: { ids: () => ['claude'] },
  roles: { all: () => ({}), getBinding: () => undefined },
  runsWithGate: async () => [],
  budget: () => ({ pricedSpendUsd: 0 }),
  getWorktreeActivity: () => [],
  travauxNonPubliesBornes: () => []
} as unknown as ConstructorParameters<typeof AppCommandBus>[0]

const VALEURS = {
  ZED_TOKEN: 'valeur-zed-0123456789',
  MISTRAL_API_KEY: 'valeur-mistral-0123456789',
  GITHUB_PAT: 'valeur-github-0123456789'
}

let dossier: string

function coffreAvec(cles: Record<string, string>): Coffre {
  const coffre = creerCoffre({
    chemin: () => join(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (texte) => Buffer.from(texte, 'utf8'),
      decryptString: (donnees) => donnees.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  for (const [nom, valeur] of Object.entries(cles)) coffre.ajouterCle(nom, valeur)
  return coffre
}

beforeEach(() => {
  dossier = mkdtempSync(join(tmpdir(), 'autowin-coffre-etat-'))
})

afterEach(() => {
  coffreDeTest.courant = undefined
  rmSync(dossier, { recursive: true, force: true })
})

describe('état poussé au modèle — clés du coffre', () => {
  it('nomme les clés, triées, et ne contient aucune valeur ni longueur', async () => {
    coffreDeTest.courant = coffreAvec(VALEURS)
    const etat = await new AppCommandBus(os, () => undefined).snapshotForPrompt()
    expect(etat.clesDuCoffre).toEqual(['GITHUB_PAT', 'MISTRAL_API_KEY', 'ZED_TOKEN'])
    const serialise = JSON.stringify(etat)
    for (const valeur of Object.values(VALEURS)) expect(serialise).not.toContain(valeur)
    expect(serialise).not.toContain('longueur')
  })

  it('absent quand le coffre est vide : aucun caractère payé pour rien', async () => {
    coffreDeTest.courant = coffreAvec({})
    const etat = await new AppCommandBus(os, () => undefined).snapshotForPrompt()
    expect('clesDuCoffre' in etat).toBe(false)
  })
})
