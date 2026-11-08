/**
 * RUN RÉEL (orchestrateur vrai, modèle simulé) — la relecture à froid du cadrage.
 *
 * Les tests de `relecture-froide.ts` prouvent que l'écart est LU. Ceux-ci prouvent que le pipeline
 * l'HONORE : ils lisent l'ordre des appels réellement payés, et ce que chaque étape a reçu.
 */
import { describe, expect, it } from 'vitest'
import { CostAggregator } from '../dashboards/cost'
import { compileExecutionQuote, type ExecutionQuote } from './execution-quote'
import { Orchestrator, type WorkflowRunOverride } from './orchestrator'
import { CONSIGNE_RELECTURE_FROIDE } from '../consignes/phase-briefs'
import { ProviderRegistry } from '../providers/registry'
import type {
  Message,
  ProviderAdapter,
  SendOptions,
  SendResult,
  StreamChunk
} from '../providers/types'
import { promptDeRelecture } from '../juge/relecture-froide'
import { RoleModelConfig } from '../profil/roles'
import type { PipelinePhase } from '../skills/skill-pipeline'
import { TrustLedger } from '../trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/** `refactor` la classe critique : c'est la seule famille de tâches que la relecture lit. */
const TACHE = 'refactor : bascule toute l’application en anglais'
const TACHE_STANDARD = 'bascule toute l’application en anglais'

const REDUIT = `## Besoin
MARQUE-REDUITE : traduire un premier lot d'écrans.
- [ ] Settings en anglais — preuve : capture.
`
const COMPLET = `## Besoin
MARQUE-COMPLETE : traduire toute l'application.
- [ ] Toute l'interface en anglais — preuve : capture.
`
const ECART = 'ÉCART: toute l’application → un premier lot'

/** Un cadrage qui décrit une entrée sans cas limites : refusé par `frame-cas-limites.ts`. */
const SANS_CAS_LIMITES = `## Besoin
Ajouter un drapeau \`--depuis\`.
`

type Etape = string | Error

class Fournisseur implements ProviderAdapter {
  readonly id = 'run-froid'
  readonly supportsExecution = true
  /** L'ordre des appels RÉELLEMENT payés, relecture comprise. */
  readonly appels: string[] = []
  readonly recus: Array<{ phase: string; texte: string }> = []
  readonly relectures: Array<{ messages: Message[]; options: SendOptions }> = []
  avantRelecture?: () => void

  constructor(
    private readonly cadrages: Etape[],
    private readonly reponses: Etape[] = []
  ) {}

  async auth(): Promise<boolean> {
    return true
  }

  private rendre(etape: Etape | undefined, repli: string): SendResult {
    if (etape instanceof Error) throw etape
    return {
      text: etape ?? repli,
      provider: this.id,
      systemInjected: true,
      usage: { inputTokens: 10, outputTokens: 5, costUsd: 0.05 }
    }
  }

  // Le contrat impose un générateur ; cette simulation ne rend que sa valeur finale.
  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    // Comme le vrai lanceur (`providers/claude.ts`) : c'est lui qui honore une annulation, pas la boucle.
    if (options.signal?.aborted) throw new Error('arrêté')
    if (options.system === CONSIGNE_RELECTURE_FROIDE) {
      this.appels.push('relecture')
      this.relectures.push({ messages, options })
      this.avantRelecture?.()
      return this.rendre(this.reponses.shift(), 'ÉCARTS: aucun')
    }
    const phase = /SKILL\s+(frame|terrain|build|clean)/.exec(options.system ?? '')?.[1]
    const texte = `${options.system ?? ''}\n${String(messages[messages.length - 1]?.content ?? '')}`
    if (phase) {
      this.appels.push(phase)
      this.recus.push({ phase, texte })
    } else if (/juge/i.test(options.model ?? '')) {
      this.appels.push('judge')
      this.recus.push({ phase: 'judge', texte })
      return { text: 'VALIDE', provider: this.id, systemInjected: true }
    }
    if (phase === 'frame') return this.rendre(this.cadrages.shift(), COMPLET)
    return {
      text: `livrable ${phase ?? 'autre'}`,
      provider: this.id,
      systemInjected: true,
      executionEvidence:
        options.execution?.sandbox === 'danger-full-access'
          ? [
              { type: 'file_change', kind: 'mutation', status: 'done', ok: true, summary: 'edit' },
              {
                type: 'command_execution',
                kind: 'verification',
                status: 'done',
                ok: true,
                summary: 'test exit=0'
              }
            ]
          : undefined
    }
  }

  recu(phase: string, rang = 0): string {
    return this.recus.filter((r) => r.phase === phase)[rang]?.texte ?? ''
  }

  compte(appel: string): number {
    return this.appels.filter((a) => a === appel).length
  }
}

interface Options {
  phases?: PipelinePhase[]
  graphe?: WorkflowRunOverride['graph']
  groupe?: boolean
  devis?: ExecutionQuote
}

function orchestrateur(f: Fournisseur, o: Options = {}): Orchestrator {
  const { graphe, phases = ['frame', 'build'] } = o
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
    skillInstruction: (phase) => `SKILL ${phase}`,
    ...(graphe
      ? { currentWorkflow: (): WorkflowRunOverride => ({ graph: graphe, explicit: true }) }
      : { classifyPhases: (): PipelinePhase[] => phases }),
    ...(o.groupe
      ? {
          phaseFanOut: (phase: string) =>
            phase === 'frame'
              ? [
                  { provider: f.id, model: 'm1' },
                  { provider: f.id, model: 'm2' }
                ]
              : []
        }
      : {}),
    ...(o.devis ? { currentExecutionQuote: () => o.devis } : {})
  })
}

const lignes = (trace: Array<{ step: string; detail?: string }>): string[] =>
  trace.filter((s) => s.step === 'gate').map((s) => s.detail ?? '')

describe('cadrage suivi d’un build : la relecture part avant le code', () => {
  it('un écart : cadrage, relecture, cadrage repris, build', async () => {
    const f = new Fournisseur([REDUIT, COMPLET], [ECART])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 4)).toEqual(['frame', 'relecture', 'frame', 'build'])
    // Le 2e cadrage a reçu l'écart et ses sorties, le build n'a plus que la version retenue.
    expect(f.recu('frame', 1)).toContain(ECART)
    expect(f.recu('frame', 1)).toContain('Écart assumé')
    expect(f.recu('build')).toContain('MARQUE-COMPLETE')
    expect(f.recu('build')).not.toContain('MARQUE-REDUITE')
    expect(f.recu('build')).not.toContain('Relecture à froid du cadrage')
    expect(lignes(r.trace).some((l) => l.includes('1 écart(s)') && l.includes('$'))).toBe(true)
  })

  it('jumeau : aucun écart, cadrage, relecture, build, sans reprise', async () => {
    const f = new Fournisseur([COMPLET], ['1. PARAPHRASE\nUn texte.\n2. ÉCARTS: aucun'])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 3)).toEqual(['frame', 'relecture', 'build'])
    expect(f.compte('frame')).toBe(1)
    expect(lignes(r.trace).some((l) => l.includes('aucun écart'))).toBe(true)
  })

  it('l’appel est à froid : sans outil, sans session, la demande et le cadrage seuls', async () => {
    const f = new Fournisseur([COMPLET])
    await orchestrateur(f).run(TACHE)
    const { messages, options } = f.relectures[0]!
    expect(options.toolProfile).toBe('sans-outil')
    expect(options.execution).toBeUndefined()
    expect(options.resumeSessionId).toBeUndefined()
    expect(messages).toEqual([{ role: 'user', content: promptDeRelecture(TACHE, COMPLET) }])
  })

  it('un 2e cadrage encore réduit n’est pas relu : une seule reprise, pas de boucle', async () => {
    const f = new Fournisseur([REDUIT, REDUIT], [ECART, ECART])
    await orchestrateur(f).run(TACHE)
    expect(f.compte('relecture')).toBe(1)
    expect(f.compte('frame')).toBe(2)
    expect(f.compte('build')).toBe(1)
  })

  it('une reprise renvoyée par les cas limites ne déclenche pas de 2e relecture', async () => {
    const f = new Fournisseur([REDUIT, SANS_CAS_LIMITES, COMPLET], [ECART])
    await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 5)).toEqual(['frame', 'relecture', 'frame', 'frame', 'build'])
  })

  it.each([
    ['panne', new Error('modèle injoignable'), 'en panne'],
    ['réponse vide', '', 'illisible'],
    ['réponse illisible', 'Je ne sais pas.', 'illisible']
  ])('%s : le run continue et le dit dans la trace', async (_, reponse, mot) => {
    const f = new Fournisseur([COMPLET], [reponse])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 3)).toEqual(['frame', 'relecture', 'build'])
    expect(lignes(r.trace).some((l) => l.includes('Relecture à froid') && l.includes(mot))).toBe(
      true
    )
    expect(r.gateReasons.join(' ')).not.toContain('Relecture à froid')
  })

  it('une panne du cadrage repris ne coûte pas le run : le premier cadrage reste', async () => {
    const f = new Fournisseur([REDUIT, new Error('cadrage en panne')], [ECART])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.compte('build')).toBe(1)
    expect(f.recu('build')).toContain('MARQUE-REDUITE')
    expect(f.recu('build')).not.toContain('Relecture à froid du cadrage')
    expect(lignes(r.trace).some((l) => l.includes('cadrage repris') && l.includes('panne'))).toBe(
      true
    )
  })

  it('un cadrage refusé par les cas limites n’est relu qu’une fois refait', async () => {
    const f = new Fournisseur([SANS_CAS_LIMITES, COMPLET])
    await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 4)).toEqual(['frame', 'frame', 'relecture', 'build'])
  })

  it.each([
    ['l’appel coupé', new Error('arrêté')],
    ['une réponse déjà rendue', ECART]
  ])('une annulation pendant la relecture est honorée, sans reprise (%s)', async (_, reponse) => {
    const f = new Fournisseur([REDUIT, COMPLET], [reponse])
    const annulation = new AbortController()
    f.avantRelecture = () => annulation.abort()
    const details: string[] = []
    await orchestrateur(f)
      .run(
        TACHE,
        (etape) => details.push(etape.detail ?? ''),
        undefined,
        undefined,
        annulation.signal
      )
      .catch(() => undefined)
    expect(f.compte('frame')).toBe(1)
    expect(details.some((detail) => detail.includes('en panne'))).toBe(false)
  })
})

describe('autres chemins d’un cadrage', () => {
  it('un groupe de cadrage : la relecture lit la synthèse, la reprise rejoue le groupe', async () => {
    const f = new Fournisseur([REDUIT, REDUIT, COMPLET, COMPLET], [ECART])
    await orchestrateur(f, { groupe: true }).run(TACHE)
    expect(f.compte('relecture')).toBe(1)
    const rangRelecture = f.appels.indexOf('relecture')
    expect(f.appels.slice(0, rangRelecture)).toEqual(['frame', 'frame'])
    expect(f.appels.slice(rangRelecture + 1, rangRelecture + 3)).toEqual(['frame', 'frame'])
    expect(f.recu('frame', 2)).toContain(ECART)
    expect(f.appels.indexOf('build')).toBeGreaterThan(rangRelecture + 2)
  })

  const graphe: WorkflowRunOverride['graph'] = {
    entry: 'frame',
    nodes: [
      { id: 'frame', phase: 'frame' },
      { id: 'build', phase: 'build' }
    ],
    edges: [{ from: 'frame', to: 'build', when: 'always' }]
  }

  it('un graphe : même reprise, et le marcheur repart du cadrage retenu', async () => {
    const f = new Fournisseur([REDUIT, COMPLET], [ECART])
    await orchestrateur(f, { graphe }).run(TACHE)
    expect(f.appels.slice(0, 4)).toEqual(['frame', 'relecture', 'frame', 'build'])
    expect(f.compte('build')).toBe(1)
    expect(f.recu('build')).toContain('MARQUE-COMPLETE')
  })

  it('jumeau du graphe : aucun écart, aucun cadrage rejoué', async () => {
    const f = new Fournisseur([COMPLET])
    await orchestrateur(f, { graphe }).run(TACHE)
    expect(f.appels.slice(0, 3)).toEqual(['frame', 'relecture', 'build'])
  })

  it('un graphe sans build n’appelle pas la relecture', async () => {
    const f = new Fournisseur([COMPLET])
    await orchestrateur(f, {
      graphe: { entry: 'frame', nodes: [{ id: 'frame', phase: 'frame' }], edges: [] }
    }).run(TACHE)
    expect(f.compte('relecture')).toBe(0)
  })
})

/**
 * LA DEMANDE DISAIT « commencer par les tâches critiques ». Le premier passage l'avait
 * retirée sur une preuve fausse : l'en-tête `regime: standard` des RUN.md est écrit en dur
 * (`runs/conv-runs.ts`). Passés dans `classifyRegime`, 19 runs sur 131 sont critiques.
 */
describe('seules les tâches critiques sont relues', () => {
  it('une tâche standard n’appelle pas la relecture', async () => {
    const f = new Fournisseur([REDUIT], [ECART])
    await orchestrateur(f).run(TACHE_STANDARD)
    expect(f.compte('relecture')).toBe(0)
    expect(f.appels.slice(0, 2)).toEqual(['frame', 'build'])
  })

  it('jumeau : la même demande, classée critique par son devis, est relue', async () => {
    const f = new Fournisseur([COMPLET])
    const devis = { ...compileExecutionQuote(TACHE_STANDARD), regime: 'critical' as const }
    await orchestrateur(f, { devis }).run(TACHE_STANDARD)
    expect(f.appels.slice(0, 3)).toEqual(['frame', 'relecture', 'build'])
  })

  it('le devis fait foi dans l’autre sens aussi : un devis standard n’est pas relu', async () => {
    const f = new Fournisseur([COMPLET])
    const devis = { ...compileExecutionQuote(TACHE), regime: 'standard' as const }
    await orchestrateur(f, { devis }).run(TACHE)
    expect(f.compte('relecture')).toBe(0)
  })
})

describe('quand aucune relecture ne doit partir', () => {
  it('`/frame` nommé : le cadrage est le résultat demandé', async () => {
    const f = new Fournisseur([COMPLET])
    await orchestrateur(f).run(`/frame ${TACHE}`)
    expect(f.compte('frame')).toBe(1)
    expect(f.compte('relecture')).toBe(0)
  })

  it('profil sans build', async () => {
    const f = new Fournisseur([COMPLET])
    await orchestrateur(f, { phases: ['frame', 'terrain'] }).run(TACHE)
    expect(f.compte('relecture')).toBe(0)
  })

  it('cadrage repris après un redémarrage : déjà payé, il n’est pas relu', async () => {
    const f = new Fournisseur([])
    await orchestrateur(f).run(TACHE, undefined, undefined, undefined, undefined, '', [
      { phase: 'frame', text: REDUIT }
    ])
    expect(f.compte('frame')).toBe(0)
    expect(f.compte('relecture')).toBe(0)
    expect(f.compte('build')).toBe(1)
  })

  it('`SUITE: fin` : le cadrage arrête le run, il n’y a rien à protéger', async () => {
    const f = new Fournisseur([`${COMPLET}\nSUITE: fin`])
    await orchestrateur(f).run(TACHE)
    expect(f.compte('relecture')).toBe(0)
  })
})

/*
 * PLUS DE FENÊTRE DE QUESTION (2026-11-08, demande de l'utilisateur) : le run se mettait en pause
 * jusqu'à 30 minutes sur la question du cadrage repris. Il n'interroge plus personne : la réponse
 * recommandée (la première) devient la décision, et la suite la reçoit.
 */
describe('la question du cadrage repris : tranchée sans pause', () => {
  const avecQuestion = `${REDUIT}
### Bilan de l’étape
- Verdict : fait — cadrage refait.
- Fichiers touchés : aucun
- Preuves : aucune
- Reste à faire : aucun reste
- Question : Tout livrer d’un coup ? → Oui, tout | Non, par lots
`

  it('la réponse recommandée devient la décision, et arrive au build', async () => {
    const f = new Fournisseur([REDUIT, avecQuestion], [ECART])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.appels.slice(0, 4)).toEqual(['frame', 'relecture', 'frame', 'build'])
    expect(f.compte('build')).toBe(1)
    expect(f.recu('build')).toContain('DÉCISION DU CADRAGE')
    expect(f.recu('build')).toContain('« Oui, tout »')
    expect(f.recu('build')).not.toContain('DIRECTIVE UTILISATEUR')
    expect(lignes(r.trace).some((l) => l.includes('tranchée sans pause'))).toBe(true)
  })

  it('jumeau : un cadrage repris sans question ne décide rien de plus', async () => {
    const f = new Fournisseur([REDUIT, COMPLET], [ECART])
    const r = await orchestrateur(f).run(TACHE)
    expect(f.recu('build')).not.toContain('DÉCISION DU CADRAGE')
    expect(lignes(r.trace).some((l) => l.includes('tranchée sans pause'))).toBe(false)
  })
})

describe('après une reprise, le DERNIER cadrage fait foi', () => {
  const avecSupposition = (texte: string): string =>
    `${COMPLET}\n## Confiance\n- ${texte} — NON VÉRIFIÉ\n`

  it('le juge reçoit les suppositions du dernier cadrage', async () => {
    const f = new Fournisseur(
      [avecSupposition('supposition abandonnée'), avecSupposition('supposition retenue')],
      [ECART]
    )
    await orchestrateur(f).run(TACHE)
    const prompt = f.recu('judge')
    const debut = prompt.indexOf('SUPPOSITIONS DU CADRAGE')
    expect(debut).toBeGreaterThan(-1)
    const note = prompt.slice(debut, prompt.indexOf('TÂCHE:', debut))
    expect(note).toContain('supposition retenue')
    expect(note).not.toContain('supposition abandonnée')
  })
})

/**
 * LE RAPPEL DU CADRAGE lisait le PREMIER : après un refus des cas limites, la phase reprise en session
 * se voyait rappeler comme « LA référence du livrable » la version refusée.
 */
describe('rappel du cadrage en reprise de session', () => {
  class AvecSession extends Fournisseur {
    readonly honoursSessionResume = true
    override async *send(
      messages: Message[],
      options: SendOptions = {}
    ): AsyncGenerator<StreamChunk, SendResult, void> {
      const rendu = yield* super.send(messages, options)
      return { ...rendu, sessionId: 'session-du-run' }
    }
  }

  it('la phase suivante reçoit la dernière version, pas la version refusée', async () => {
    const f = new AvecSession([SANS_CAS_LIMITES, COMPLET])
    await orchestrateur(f, { phases: ['frame', 'terrain', 'build'] }).run(TACHE)
    const terrain = f.recu('terrain')
    const rappel = terrain.slice(terrain.indexOf('RAPPEL DU CADRAGE'))
    expect(terrain).toContain('RAPPEL DU CADRAGE')
    expect(rappel).toContain('MARQUE-COMPLETE')
    expect(rappel).not.toContain('Cadrage incomplet')
  })

  it('une reprise de session ne perd pas la consigne : le cadrage repart avec tout son contexte', async () => {
    const f = new AvecSession([REDUIT, COMPLET], [ECART])
    await orchestrateur(f).run(TACHE)
    expect(f.recu('frame', 1)).toContain(ECART)
  })

  it('ni la décision du cadrage : la phase suivante la reçoit', async () => {
    const avecQuestion = `${COMPLET}
### Bilan de l’étape
- Verdict : fait — cadrage refait.
- Fichiers touchés : aucun
- Preuves : aucune
- Reste à faire : aucun reste
- Question : Tout livrer d’un coup ? → Oui, tout | Non, par lots
`
    const f = new AvecSession([REDUIT, avecQuestion], [ECART])
    await orchestrateur(f, { phases: ['frame', 'terrain', 'build'] }).run(TACHE)
    expect(f.recu('terrain')).toContain('DÉCISION DU CADRAGE')
  })
})
