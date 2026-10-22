import { describe, expect, it } from 'vitest'
import { CostAggregator } from './dashboards/cost'
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
import { TrustLedger } from './trust/ledger'
import { makeTestWorktrees } from './orchestrator.test-helpers'

/**
 * UNE DEMANDE `judge` EXPLICITE NE DOIT PAS ÊTRE CONDAMNÉE AU ROUGE PAR CONSTRUCTION.
 *
 * Mesuré sur le run réel conv-1078 (trace : 2 étapes, `judge` puis `gate`, aucune étape `exec`) :
 * `regimePhases()` rend `[]` pour une phase `judge` nommée, donc AUCUNE phase d'exécution ne tourne.
 * Le juge recevait alors « RÉPONSE (livrable agrégé de TOUTES les phases) : » vide et
 * « PREUVES OUTILS OBSERVÉES: [] », tout en étant sommé de « confronter au moins une preuve d'outil
 * ci-dessous ». Verdict inévitable : « DEFAUT: livrable agrégé vide et aucune preuve d'outil ».
 * Le gate ne faisait que recopier ce faux rouge.
 */
class CapturingProvider implements ProviderAdapter {
  readonly id = 'capturing'
  readonly supportsExecution = true
  readonly prompts: string[] = []

  // eslint-disable-next-line require-yield
  async *send(
    messages: Message[],
    options: SendOptions = {}
  ): AsyncGenerator<StreamChunk, SendResult, void> {
    void options
    this.prompts.push(messages.map((m) => m.content).join('\n'))
    return { text: 'VALIDE', provider: this.id, systemInjected: Boolean(options.system) }
  }

  async auth(): Promise<boolean> {
    return true
  }
}

function harnaisOrch() {
  const provider = new CapturingProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: []
  })
  return { provider, orch }
}

function harnais() {
  const provider = new CapturingProvider()
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust: new TrustLedger(),
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    // Le cas réel : phase `judge` nommée → aucune phase d'exécution.
    execPhases: []
  })
  return {
    provider,
    lancer: () =>
      orch.run('/judge la clôture du chantier chat', undefined, undefined, undefined, undefined, undefined, [])
  }
}

describe('juge sans phase d’exécution : le prompt ne réclame pas un agrégat qui ne peut pas exister', () => {
  it('n’exige PAS « au moins une preuve d’outil ci-dessous » quand aucune phase n’a tourné', async () => {
    const { provider, lancer } = harnais()
    await lancer()
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).not.toBe('')
    expect(promptDuJuge).not.toContain('confronte au moins une preuve d')
  })

  it('dit au juge qu’il est le SEUL agent et doit inspecter lui-même le workspace', async () => {
    const { provider, lancer } = harnais()
    await lancer()
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).toContain('AUCUNE phase d’exécution')
    // Et il ne présente pas un vide comme le livrable à juger.
    expect(promptDuJuge).not.toContain('livrable agrégé de TOUTES les phases) : \n')
  })

  /**
   * conv-113 (2026-10-06, run « judge-projet-ameliore-boucle-objectif-muwn6zvy ») : « Judge le Projet
   * et améliore le en boucle ». Toute la conversation portait sur PaperTrading2, mais le fil était
   * rangé dans D:\Chirurgien\AssistantChirurgien. Le juge SEUL a reçu la TÂCHE nue et le CLAUDE.md de
   * ce dossier (« # Projet : assistant patients… ») — sa trace contient ZÉRO mention de PaperTrading.
   * Il a jugé le dossier, et la chaîne du mode auto a suivi ses objections pendant des heures.
   */
  it('reçoit le fil qui a produit la demande : « le Projet » se lit dans la conversation', async () => {
    const { provider, orch } = harnaisOrch()
    const collecte = [
      '[COLLECTE DE CONTEXTE — effectuée avant RUN.md et délégation]',
      'Échanges récents (le fil qui a produit la demande — sa lettre ne dit pas tout) :',
      '  UTILISATEUR: Ajoute à PaperTrading2 une validation sur plusieurs fenêtres glissantes'
    ].join('\n')
    await orch.run('Judge le Projet', undefined, undefined, undefined, undefined, collecte, [])
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).toContain('Ajoute à PaperTrading2 une validation')
    // Le fil précède la TÂCHE : le juge sait de quoi parle « le Projet » avant de lire l'énoncé.
    expect(promptDuJuge.indexOf('PaperTrading2')).toBeLessThan(promptDuJuge.indexOf('TÂCHE:'))
  })

  it('un run AVEC phases garde le contrat de preuve d’origine', async () => {
    const provider = new CapturingProvider()
    const orch = new Orchestrator({
      registry: new ProviderRegistry().register(provider),
      roles: new RoleModelConfig({
        subagent: { provider: provider.id, model: 'ouvrier' },
        judge: { provider: provider.id, model: 'juge-dedie' }
      }),
      cost: new CostAggregator(),
      trust: new TrustLedger(),
      executionWorkspace: 'C:\\base',
      worktrees: makeTestWorktrees('C:\\base'),
      execPhases: ['build']
    })
    await orch.run('analyse le projet', undefined, undefined, undefined, undefined, undefined, [])
    const promptDuJuge = provider.prompts.filter((t) => t.includes('Tu es un juge')).at(-1) ?? ''
    expect(promptDuJuge).toContain('confronte au moins une preuve d')
  })
})

/**
 * UNE RELECTURE SEULE QUI REND SON VERDICT EST LIVRÉE (piste 5, conv-1070).
 *
 * Mesuré : conv-955, conv-984, conv-1043 et conv-1056 — quatre `/judge` qui ont trouvé des défauts
 * finissent « Gate BLOQUÉ: Promis mais pas fait : « Objection du juge : … » » et `status: red`. Or
 * la demande était la relecture : le verdict est la réponse (`orchestrator.ts`, « aucune réparation
 * : la demande nomme le juge seul »). Les objections ne sont pas des promesses non tenues ; elles
 * disent que le travail RELU est défectueux, et c'est ce que le résultat doit afficher.
 *
 * L'entrée qui ferait échouer ce test si le correctif était faux : un refus SANS objection
 * (« DEFAUT: aucun juge n’a répondu »), qui n'est pas une relecture et doit rester bloqué.
 */
class JugeQuiRepond implements ProviderAdapter {
  readonly id = 'juge-fixe'
  readonly supportsExecution = true
  constructor(private readonly verdict: string) {}
  // eslint-disable-next-line require-yield
  async *send(): AsyncGenerator<StreamChunk, SendResult, void> {
    return { text: this.verdict, provider: this.id, systemInjected: false }
  }
  async auth(): Promise<boolean> {
    return true
  }
}

function relire(verdict: string, tache = '/judge la clôture du chantier chat') {
  const provider = new JugeQuiRepond(verdict)
  const trust = new TrustLedger()
  const votes: string[] = []
  const enregistrer = trust.record.bind(trust)
  trust.record = (v) => {
    votes.push(v.verdict)
    enregistrer(v)
  }
  const orch = new Orchestrator({
    registry: new ProviderRegistry().register(provider),
    roles: new RoleModelConfig({
      subagent: { provider: provider.id, model: 'ouvrier' },
      judge: { provider: provider.id, model: 'juge-dedie' }
    }),
    cost: new CostAggregator(),
    trust,
    executionWorkspace: 'C:\\base',
    worktrees: makeTestWorktrees('C:\\base'),
    execPhases: []
  })
  return {
    votes,
    resultat: orch.run(tache, undefined, undefined, undefined, undefined, undefined, [])
  }
}

const VERDICT_AVEC_DEFAUTS = [
  'DEFAUT: deux défauts dans le travail relu',
  'OBJECTIONS:',
  '- MAJEUR: `src/main/store/surveillance-references-git.ts:128` surveille un dossier en nom court.',
  '- MINEUR: le commentaire de la ligne 40 date du mauvais jour.',
  'SCORE: 55'
].join('\n')

describe('relecture seule : le verdict est livré, les défauts du travail relu sont affichés', () => {
  it('un DEFAUT avec objections clôt la relecture, sans « Promis mais pas fait »', async () => {
    const { resultat } = relire(VERDICT_AVEC_DEFAUTS)
    const r = await resultat
    expect(r.gateBlocked).toBe(false)
    expect(r.gateReasons.join(' ')).not.toContain('Promis mais pas fait')
    // Le sens « le travail relu est défectueux » reste écrit, en tête, avec chaque objection.
    expect(r.result).toMatch(/^Relecture livrée — le travail relu a des défauts/)
    expect(r.result).toContain('surveillance-references-git.ts:128')
    expect(r.result).toContain('le commentaire de la ligne 40')
  })

  it('le vote du juge garde son sens : la calibration reçoit red, pas green', async () => {
    const { votes, resultat } = relire(VERDICT_AVEC_DEFAUTS)
    await resultat
    expect(votes).toEqual(['red'])
  })

  it('un refus SANS objection n’est pas une relecture : il reste bloqué', async () => {
    const r = await relire('DEFAUT: aucun juge n’a répondu (tous en échec)').resultat
    expect(r.gateBlocked).toBe(true)
  })

  it('un VALIDE reste un VALIDE, sans en-tête de défauts', async () => {
    const r = await relire('VALIDE\n- OK: rien à redire.\nSCORE: 90').resultat
    expect(r.gateBlocked).toBe(false)
    expect(r.result).not.toContain('Relecture livrée — le travail relu a des défauts')
    expect(r.defautsDuTravailRelu).toBeUndefined()
  })

  // Le RUN.md est écrit par `commands.ts`, qui ne voit que ce résultat : sans ce champ, il écrivait
  // « Juge: validé — clôture autorisée » sous un verdict qui dit le contraire (objection du juge,
  // conv-1070). Entrée qui fait rougir ce test : VERDICT_AVEC_DEFAUTS rendu sans ses défauts.
  // fix-ok: conv-1070 — mesuré : rouge avant le champ `defautsDuTravailRelu` (« Target cannot be
  // null or undefined »), vert après. Retouche antérieure du fichier : `'C:\base'` contenait un
  // retour arrière (0x08) né d'un heredoc, remplacé par `'C:\\base'`.
  it('les défauts du travail relu sortent du run, pour le Journal du RUN.md', async () => {
    const r = await relire(VERDICT_AVEC_DEFAUTS).resultat
    expect(r.defautsDuTravailRelu).toHaveLength(2)
    expect(r.defautsDuTravailRelu?.[0]).toMatch(/^MAJEUR: .*surveillance-references-git\.ts:128/)
  })
})
