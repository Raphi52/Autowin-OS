/**
 * RUN REEL (orchestrateur vrai, fournisseur simule) — un cadrage sans cas limites est-il RENVOYE
 * en `frame`, au lieu de partir en `terrain` ?
 *
 * Les tests unitaires de `frame-cas-limites.ts` prouvent que le refus est PRODUIT. Ils ne prouvent
 * pas que le pipeline l'HONORE. Ici on joue le vrai marcheur de phases et on lit l'ordre des
 * phases reellement payees, plus ce que `terrain` a recu dans son contexte.
 */
import { describe, expect, it } from 'vitest'
import { Orchestrator } from './orchestrator'
import { ProviderRegistry } from './providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from './providers/types'
import { RoleModelConfig } from './roles'
import { CostAggregator } from './dashboards/cost'
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/** Un cadrage qui decrit une ENTREE (`--depuis`) sans enumerer un seul cas limite. */
const CADRAGE_INCOMPLET = `## Besoin
Ajouter un drapeau \`--depuis\` a \`scripts/rendement-sonde.mjs\` pour borner la fenetre lue.
- [ ] le drapeau borne la fenetre — preuve : node scripts/rendement-sonde.mjs --depuis 2026-01-01

## Contraintes
- HARD : ne pas toucher au format de sortie.
`

/**
 * Le meme cadrage, complet. Sert de TEMOIN : sans lui, un test vert ne prouverait rien.
 * La rubrique vit DANS `## Besoin` — ecrite plus bas, sous `## Contraintes`, elle ne compte pas
 * (constate en jouant ce meme run : la garde ne lit que la section du besoin).
 */
const CADRAGE_COMPLET = `## Besoin
Ajouter un drapeau \`--depuis\` a \`scripts/rendement-sonde.mjs\` pour borner la fenetre lue.
- [ ] le drapeau borne la fenetre — preuve : node scripts/rendement-sonde.mjs --depuis 2026-01-01

### Cas limites d'entree
- \`--depuis\` absent : fenetre par defaut, code 0.
- \`--depuis\` sans valeur : refus, code 2.
- \`--depuis abc\` : refus, code 2, aucune pile Node.
- \`--depuis 2099-01-01\` (futur) : refus, code 2.

## Contraintes
- HARD : ne pas toucher au format de sortie.
`

class Fournisseur implements ProviderAdapter {
  readonly id = 'run-caslim'
  readonly supportsExecution = true
  /** L'ordre des phases REELLEMENT payees. */
  readonly phases: string[] = []
  /** Ce que chaque phase a recu (systeme + dernier message). */
  readonly recus: Array<{ phase: string; texte: string }> = []
  private cadragesRendus = 0

  constructor(private readonly cadrage: string) {}

  async auth(): Promise<boolean> {
    return true
  }

  // Le contrat impose un generateur ; cette simulation ne rend que sa valeur finale.
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    const phase = /SKILL\s+(scout|frame|terrain|build|clean|judge)/.exec(options.system ?? '')?.[1]
    const texte = `${options.system ?? ''}\n${String(messages[messages.length - 1]?.content ?? '')}`
    if (phase) {
      this.phases.push(phase)
      this.recus.push({ phase, texte })
    }
    if (phase === 'frame') {
      this.cadragesRendus += 1
      return { text: this.cadrage, provider: this.id, systemInjected: true }
    }
    return { text: `livrable ${phase}`, provider: this.id, systemInjected: true }
  }

  get nombreDeCadrages(): number {
    return this.cadragesRendus
  }
}

function orchestrateur(f: ProviderAdapter): Orchestrator {
  return new Orchestrator({
    registry: new ProviderRegistry().register(f),
    roles: new RoleModelConfig({
      subagent: { provider: f.id, model: 'gros' },
      judge: { provider: f.id, model: 'juge' },
      orchestrator: { provider: f.id, model: 'chef' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:/ws',
    worktrees: makeTestWorktrees('C:/ws'),
    classifyPhases: () => ['frame', 'terrain'],
    skillInstruction: (phase) => `SKILL ${phase}`
  })
}

describe('run reel — le cadrage sans cas limites ne part pas en terrain', () => {
  it('le refus est POSE et le run repasse par frame', async () => {
    const f = new Fournisseur(CADRAGE_INCOMPLET)
    await orchestrateur(f).run('ajoute --depuis a la sonde de rendement')

    // 1. La phase jouee APRES le frame est un frame, pas le terrain : le renvoi a eu lieu.
    expect(f.phases.slice(0, 3)).toEqual(['frame', 'frame', 'terrain'])
    expect(f.nombreDeCadrages).toBeGreaterThan(1)
    // 2. La 2e passe de frame a bien recu le refus, nomme.
    const secondFrame = f.recus.filter((r) => r.phase === 'frame')[1]
    expect(secondFrame?.texte).toMatch(/Cadrage incomplet/)
    expect(secondFrame?.texte).toMatch(/Cas limites d'entree/i)
  })

  it('TEMOIN — un cadrage complet passe directement a terrain, sans rejeu', async () => {
    const f = new Fournisseur(CADRAGE_COMPLET)
    await orchestrateur(f).run('ajoute --depuis a la sonde de rendement')
    // Aucun rejeu : le terrain suit IMMEDIATEMENT le frame.
    expect(f.phases.slice(0, 2)).toEqual(['frame', 'terrain'])
    expect(f.nombreDeCadrages).toBe(1)
    const terrain = f.recus.find((r) => r.phase === 'terrain')
    expect(terrain?.texte).not.toMatch(/Cadrage incomplet/)
  })
})
