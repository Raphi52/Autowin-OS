import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  creerDepotJetable,
  demonterOs,
  monterOsReel,
  type DepotJetable
} from './e2e-chaine.harness'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'

/**
 * LE DEFAUT MESURE (2026-08-21) — `e2e-chaine.test.ts` se SUICIDE d'une execution a l'autre.
 *
 * Sonde : la chaine rendait `orchestrate-end` en `red`, detail « Reprise du worktree impossible pour
 * run-9444fd1ca036-1 : copie durable absente ou incomplete. », et `cwdRecus` restait VIDE — aucune
 * phase d'execution ne partait. Lecture du disque : cinq etats d'orchestration NON TERMINAUX,
 * `conv-1` + la tache exacte du e2e, dormaient dans la racine de donnees PARTAGEE des tests
 * (`vitest.config.ts` fixe `APPDATA` a `<tmp>/autowin-tests-appdata`, chemin stable et volontaire).
 * Chaque execution du e2e en depose un ; la suivante le reprend et exige une copie durable dont le
 * depot temporaire a disparu depuis. Le produit a raison de refuser : c'est le HARNAIS qui laisse
 * derriere lui un etat que la prochaine execution herite.
 *
 * Ce test garde la CAUSE, pas le symptome : l'OS monte par le harnais ne doit voir AUCUN etat de run
 * etranger. L'entree qui doit le faire tomber si la correction etait fausse est ecrite ci-dessous :
 * un etat empoisonne, depose dans la racine PARTAGEE AVANT le montage. Une correction qui se
 * contenterait de nettoyer au demontage, d'avaler l'erreur de reprise, ou de rendre le refus non
 * bloquant laisserait ce poison visible — et ce test rouge.
 */
const TACHE = 'Remplace AVANT par APRES dans cible.txt, verifie, puis dis-le.'
const CONVERSATION = 'conv-1'
const RACINE_PARTAGEE = join(tmpdir(), 'autowin-tests-appdata')
const POISON = 'run-e2eisolation1-1'

class ProviderMuet implements ProviderAdapter {
  readonly id = 'e2e-chaine'
  readonly supportsExecution = true
  async auth(): Promise<boolean> {
    return true
  }
  // eslint-disable-next-line require-yield
  async *send(_m: Message[], _o: SendOptions = {}): AsyncGenerator<StreamChunk, SendResult, void> {
    return { text: 'VALIDE', provider: this.id, systemInjected: false }
  }
}

/** L'ENTREE QUI DOIT FAIRE TOMBER CE TEST si la correction etait fausse. */
function deposerLePoison(): string {
  const dossier = join(RACINE_PARTAGEE, 'autowin-os', 'run-state')
  mkdirSync(dossier, { recursive: true })
  const chemin = join(dossier, `${POISON}.json`)
  const maintenant = Date.now()
  writeFileSync(
    chemin,
    JSON.stringify({
      runId: POISON,
      task: TACHE,
      conversationId: CONVERSATION,
      turnId: '00000000-0000-4000-8000-000000000001',
      runtimeSnapshot: {
        roles: {
          orchestrator: { provider: 'e2e-chaine' },
          subagent: { provider: 'e2e-chaine' },
          judge: { provider: 'e2e-chaine' },
          scout: { provider: 'e2e-chaine' }
        },
        phaseFanOut: { scout: [], frame: [], terrain: [] },
        judgeFanOut: []
      },
      phaseOutputs: [{ phase: 'build', text: 'VALIDE' }],
      startedAt: maintenant,
      updatedAt: maintenant
    }),
    'utf8'
  )
  return chemin
}

describe('e2e — le harnais ne partage aucun etat de run avec les autres executions', () => {
  let jetable: DepotJetable | undefined
  let osCourant: Awaited<ReturnType<typeof monterOsReel>> | undefined
  let poison: string | undefined
  afterEach(async () => {
    await demonterOs(osCourant, jetable)
    if (poison) rmSync(poison, { force: true })
    jetable = undefined
    osCourant = undefined
    poison = undefined
  })

  it('un etat empoisonne de la racine PARTAGEE est invisible pour l OS monte par le harnais', async () => {
    poison = deposerLePoison()
    jetable = creerDepotJetable('cible.txt', 'AVANT\n')
    const os = await monterOsReel(jetable.depot, new ProviderMuet())
    osCourant = os

    // L'ASSERTION QUI PORTE LE DEFAUT : sans isolation, le poison est repris. Mesure du rouge
    // initial (2026-08-21) : `run-e2eisolation1-1` etait bien rendu ici.
    expect(os.resumableOrchestrations().map((etat) => etat.runId)).toEqual([])

    // La racine de donnees du montage est PROPRE a ce depot jetable, jamais la racine partagee.
    expect(process.env.APPDATA).not.toBe(RACINE_PARTAGEE)
    expect(process.env.APPDATA?.startsWith(jetable.racine)).toBe(true)
  }, 60000)
})
