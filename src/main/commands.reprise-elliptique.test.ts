import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'

/**
 * UNE REPRISE ELLIPTIQUE NE DOIT PAS FAIRE PERDRE LA CIBLE.
 *
 * DEFAUT MESURE, present dans main jusqu'au 2026-08-26 : `authoritativeTask` valait
 * `suppliedRootTask ?? delegatedTask`. Quand l'utilisateur relance par « vas-y » ou « fais un truc
 * parfait », le prompt racine EST cette phrase vague — et la cible contextualisee produite par le
 * pilote etait purement JETEE. L'orchestrateur partait donc reparer la phrase elle-meme au lieu du
 * sujet discute juste avant (cas d'origine : conv-1265).
 *
 * LE CORRECTIF NE RETIRE RIEN : le prompt racine reste l'autorite, on lui AJOUTE la cible
 * contextualisee. Un faux positif coute donc une ligne de contexte en trop, jamais une cible
 * perdue — le seul sens dans lequel se tromper soit acceptable.
 *
 * Recupere du bureau `autowin/recovery/run-489427ba0379-1` (2026-08-18), qui portait la version la
 * plus complete de deux tentatives. Ses tests ne pouvaient pas etre repris tels quels : leur fichier
 * importait `rangerDansDossier`, une fonction d'un chantier voisin jamais publie.
 */
function osDouble(): {
  os: ConstructorParameters<typeof AppCommandBus>[0]
  calls: { lastTask?: string }
} {
  const calls: { lastTask?: string } = {}
  const os = {
    executionWorkspace: process.cwd(),
    conversations: {
      get: () => undefined,
      list: () => [],
      attachRun: () => undefined
    },
    registry: { ids: () => ['claude'] },
    roles: { all: () => ({}), getBinding: () => ({ provider: 'claude' }) },
    runsWithGate: () => [],
    budget: () => ({ spent: 0 }),
    runTask: async (task: string) => {
      calls.lastTask = task
      return { ok: true }
    }
  }
  return { os: os as never, calls }
}

const CIBLE = 'Preserver la cible contextualisee quand une reprise utilisateur est elliptique.'

async function lancer(rootTask: string): Promise<string | undefined> {
  const { os, calls } = osDouble()
  await new AppCommandBus(os, () => {}).exec(
    'orchestrate',
    { task: CIBLE, phase: 'build', rootTask },
    'conv-reprise'
  )
  return calls.lastTask
}

describe('reprise elliptique — la cible contextualisée survit', () => {
  for (const vague of [
    'fais un truc parfait',
    'vas-y',
    'finis ca une bonne fois pour toutes',
    "fais ce qu'il faut pour que ca fasse ca la prochaine fois"
  ]) {
    it(`« ${vague} » transporte la cible au lieu de l’écraser`, async () => {
      const envoye = await lancer(vague)

      expect(envoye).toContain(vague)
      expect(envoye).toContain(CIBLE)
      expect(envoye).not.toBe(vague)
    })
  }

  it('un objectif NOMMÉ reste intact — le contexte ne s’y invite pas', async () => {
    // L'entree qui doit faire echouer une detection trop large : si la regex mordait ici, tout
    // prompt racine se verrait accoler la cible du modele, et l'autorite du prompt utilisateur
    // serait diluee a chaque tour.
    const nomme = 'corrige la fuite de memoire du planificateur'
    const envoye = await lancer(nomme)

    expect(envoye).toBe(nomme)
  })
})
