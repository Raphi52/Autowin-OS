import { readdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { convRunsRoot } from './runs/conv-runs'

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

async function lancer(rootTask: string, convId = 'conv-reprise'): Promise<string | undefined> {
  const { os, calls } = osDouble()
  await new AppCommandBus(os, () => {}).exec(
    'orchestrate',
    { task: CIBLE, phase: 'build', rootTask },
    convId
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

  /*
   * LES RELANCES REELLEMENT TAPEES (saisies-utilisateur.jsonl, releve du 2026-10-14) : « reprend »
   * 90 fois, « go » 28, « reprendre » 9, « vazy » 9, « finis » 5, « lance le » / « relance le » /
   * « lancer terrain. » 3 chacun. Seuls « go » et « vas-y » etaient reconnus : 30 RUN.md portaient
   * l'objectif « reprend » et 23 « lancer terrain. », sans la cible du pilote — et le dossier
   * « reprend-… » faisait rouvrir un run ouvert d'un autre sujet (`reuseOrCreateConvRun` apparie
   * sur le texte de la tache).
   */
  for (const relance of [
    'reprend',
    'reprendre',
    'Reprends.',
    'reprend pardon',
    'vazy',
    'continue',
    'ok',
    'oui',
    'finis',
    'lance le',
    'relance le',
    'lancer terrain.',
    'lancer frame.',
    'lancer la phase suivante.',
    'Reprendre le travail arrêté — corriger la cause nommée ci-dessus, puis relancer la même demande.'
  ]) {
    it(`la relance « ${relance} » garde la cible du pilote`, async () => {
      const envoye = await lancer(relance)

      expect(envoye).toContain(CIBLE)
      expect(envoye).not.toBe(relance)
    })
  }

  it('« reprend » : RUN.md porte la cible, le dossier ne s’appelle plus « reprend-<horodatage> »', async () => {
    // Conversation propre a ce test : son dossier ne contient que le run qu'il vient de creer.
    const convId = `conv-reprise-runmd-${process.pid}-${Date.now().toString(36)}`
    const dossierConv = join(convRunsRoot(), convId)
    try {
      await lancer('reprend', convId)

      const workspaces = readdirSync(dossierConv)
      expect(workspaces).toHaveLength(1)
      expect(workspaces[0]).not.toMatch(/^reprend-[a-z0-9]+-workspace$/)
      const md = readFileSync(join(dossierConv, workspaces[0], 'RUN.md'), 'utf8')
      const besoin = md.match(/## Besoin\s*\n([\s\S]*?)\n\s*\*\*Critere de succes/i)?.[1] ?? ''
      expect(besoin).toContain(CIBLE)
    } finally {
      rmSync(dossierConv, { recursive: true, force: true })
    }
  })

  for (const nomme of [
    'reprends le découpage de src/main/index.ts : extrais runPilotChat vers src/main/chat/run-pilot-chat.ts',
    'lance le terrain sur le contrôleur arena-audit et prépare le test qui doit sortir rouge',
    'relance le service du brain, puis vérifie que /query et /ingest répondent à nouveau.',
    'ok pardon reprend : ajouter /ingest à la source hermes-brain puis réinstaller',
    'continue d’attendre et donne-moi les résultats des 4 répliques'
  ]) {
    it(`une relance qui NOMME son objet reste intacte : « ${nomme.slice(0, 40)}… »`, async () => {
      expect(await lancer(nomme)).toBe(nomme)
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
