import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { CostAggregator } from '../dashboards/cost'
import { reservesMineuresAuFrein } from '../juge/objections-juge'
import { reservesLivreesAuFrein } from './boucle-reparation'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from '../providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { RoleModelConfig } from '../profil/roles'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * CAS RÉEL, run build-racine-unique-copies-relecture-mw814u5m (09/11/2026).
 *
 * Trois verdicts de suite à 80/100, chacun avec des MINEUR différents du précédent (un commentaire
 * qui porte l'historique, une fixture trop retouchée, un compte rendu qui se contredit). Le build
 * les corrigeait, le juge en relevait d'autres ; au 3e refus, le frein « le même refus est revenu
 * 3 fois de suite » a clos le run en rouge et le travail n'est pas entré dans le dépôt.
 *
 * Les verdicts ci-dessous sont des extraits des verdicts réels de ce run.
 */
const MINEUR_1 =
  'le commentaire `// fix-ok:` de `worktree-run-state.ts`, ligne 404, porte une mesure du run ; garder la cause, retirer la mesure.'
const MINEUR_2 =
  'fixture annoncée « copie fidèle » mais retouchée : `etatVersion1Reel` remplace `repoId` et `turnId`.'
const MINEUR_3 =
  "l'étape 1 garde des affirmations que l'étape 2 corrige, sans marque : « 7 cas ajoutés », « 89 sur 89 sont lisibles »."

const verdictMineur = (resume: string, mineur: string): string =>
  `DEFAUT: ${resume}\n\nSCORE: 80\n\nOBJECTIONS:\n- OK: typecheck, les deux fichiers de tests et le lint passent.\n- MINEUR: ${mineur}`

const VERDICT_1 = verdictMineur(
  "un commentaire du code porte l'historique. Le code, lui, tient.",
  MINEUR_1
)
const VERDICT_2 = verdictMineur(
  'la fixture de test est trop retouchée pour une « copie fidèle ».',
  MINEUR_2
)
const VERDICT_3 = verdictMineur(
  'le compte rendu contredit encore ses propres corrections.',
  MINEUR_3
)

const verdictMajeur = (n: number): string =>
  `DEFAUT: la copie durable n'est toujours pas reprise (passage ${n}).\n\nSCORE: 60\n\nOBJECTIONS:\n- MAJEUR: la reprise lit encore l'ancien dossier, le test de reprise reste rouge (passage ${n}).`

const RACINE_SANS_BUNDLE = mkdtempSync(`${tmpdir()}/autowin-reserves-frein-`)
let cwdSpy: ReturnType<typeof vi.spyOn>
const bornePrecedente = process.env.AUTOWIN_REPARATION_BORNEE
beforeAll(() => {
  // Racine vide : la mesure de code périmé ne coupe pas la boucle avant le frein testé ici.
  cwdSpy = vi.spyOn(process, 'cwd').mockReturnValue(RACINE_SANS_BUNDLE)
  // Le mode de production : « jusqu'au vert », seul le frein du refus répété arrête.
  delete process.env.AUTOWIN_REPARATION_BORNEE
})
afterAll(() => {
  cwdSpy.mockRestore()
  if (bornePrecedente === undefined) delete process.env.AUTOWIN_REPARATION_BORNEE
  else process.env.AUTOWIN_REPARATION_BORNEE = bornePrecedente
})

/** Rend les verdicts dans l'ordre (le dernier se répète) ; partout ailleurs, un build prouvé. */
class JugeSequenceProvider implements ProviderAdapter {
  readonly id = 'sequence'
  readonly supportsExecution = true
  readonly verdictsRendus: string[] = []
  constructor(private readonly verdicts: string[]) {}

  async auth(): Promise<boolean> {
    return true
  }

  // eslint-disable-next-line require-yield
  async *send(
    _messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const systemInjected = Boolean(options.system)
    const usage = { inputTokens: 4, outputTokens: 2, costUsd: 0.001 }
    if ((options.model ?? '').startsWith('juge')) {
      if (this.verdictsRendus.length >= 8) throw new Error('boucle juge-réparation non arrêtée')
      const text = this.verdicts[Math.min(this.verdictsRendus.length, this.verdicts.length - 1)]
      this.verdictsRendus.push(text)
      return { text, provider: this.id, usage, systemInjected }
    }
    return {
      text: 'travail fait',
      provider: this.id,
      usage,
      systemInjected,
      executionEvidence: [
        {
          type: 'file_change',
          kind: 'mutation',
          status: 'completed',
          ok: true,
          summary: 'mutation simulée'
        },
        {
          type: 'command_execution',
          kind: 'verification',
          status: 'completed',
          ok: true,
          summary: 'tests simulés'
        }
      ]
    }
  }
}

function lancer(verdicts: string[]) {
  const provider = new JugeSequenceProvider(verdicts)
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      orchestrator: { provider: provider.id, model: 'orch' },
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-1' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\ws',
    worktrees: makeTestWorktrees('C:\\ws'),
    classifyPhases: () => ['build']
  })
  return { provider, resultat: orch.run('/build range les copies sous une racine unique') }
}

describe('au frein du refus répété, des remarques mineures seules livrent le travail', () => {
  it('rejoue le cas réel : trois refus à 80 sur des MINEUR différents → livré avec réserves', async () => {
    const { provider, resultat } = lancer([VERDICT_1, VERDICT_2, VERDICT_3])
    const r = await resultat
    // Les MINEUR bloquent toujours : chacun a relancé une réparation, jusqu'au frein.
    expect(provider.verdictsRendus).toEqual([VERDICT_1, VERDICT_2, VERDICT_3])
    expect(r.trace.filter((s) => /^Réparation \d/u.test(s.detail ?? ''))).toHaveLength(2)
    // Au frein : livré, pas rouge.
    expect(r.valid).toBe(true)
    expect(r.gateBlocked).toBe(false)
    expect(r.gateReasons.join(' ')).not.toContain('le même refus est revenu')
    expect(r.trace.some((s) => /^Livré avec réserves/u.test(s.detail ?? ''))).toBe(true)
    // La réserve restante est écrite sous le résultat ; celles déjà traitées n'y reviennent pas.
    expect(r.result).toContain('Réserves du juge')
    expect(r.result).toContain('« 7 cas ajoutés »')
    expect(r.result).not.toContain('copie fidèle')
  })

  it('contrôle négatif : un MAJEUR répété reste un arrêt rouge', async () => {
    const { resultat } = lancer([verdictMajeur(1), verdictMajeur(2), verdictMajeur(3)])
    const r = await resultat
    expect(r.gateBlocked).toBe(true)
    expect(r.gateReasons.join(' ')).toContain('le même refus est revenu')
    expect(r.result).not.toContain('Réserves du juge')
  })
})

describe('reservesMineuresAuFrein et reservesLivreesAuFrein — les règles pures', () => {
  const FREIN =
    "Réparation interrompue : le même refus est revenu 3 fois de suite, même en mode jusqu'au vert — rejouer ne le fait plus bouger."

  it('des MINEUR seuls sont rendus ; un MAJEUR, une puce nue ou un refus sans objection bloquent', () => {
    expect(reservesMineuresAuFrein(VERDICT_3)).toEqual([MINEUR_3])
    expect(reservesMineuresAuFrein(verdictMajeur(1))).toEqual([])
    expect(
      reservesMineuresAuFrein(
        'DEFAUT: x\n\nOBJECTIONS:\n- MINEUR: un compte faux\n- une citation inventée'
      )
    ).toEqual([])
    expect(reservesMineuresAuFrein('DEFAUT: liste non vérifiée\n\nSCORE: 35')).toEqual([])
  })

  it('un écart d’étendue classé MINEUR bloque : une partie de la demande manque', () => {
    expect(
      reservesMineuresAuFrein(
        'DEFAUT: x\n\nOBJECTIONS:\n- MINEUR: ÉTENDUE — la deuxième partie de la demande n’est pas faite.'
      )
    ).toEqual([])
  })

  it('rien n’est livré hors du frein, avant le juge, ou si le refus ne vient pas du verdict seul', () => {
    const base = { arret: FREIN, verdictDuPassage: VERDICT_3, refusDuVerdictSeul: true }
    expect(reservesLivreesAuFrein(base)).toEqual([MINEUR_3])
    expect(
      reservesLivreesAuFrein({
        ...base,
        arret: 'Réparation interrompue : le code exécuté est périmé'
      })
    ).toEqual([])
    expect(reservesLivreesAuFrein({ ...base, arret: undefined })).toEqual([])
    expect(reservesLivreesAuFrein({ ...base, verdictDuPassage: undefined })).toEqual([])
    expect(reservesLivreesAuFrein({ ...base, refusDuVerdictSeul: false })).toEqual([])
  })
})
