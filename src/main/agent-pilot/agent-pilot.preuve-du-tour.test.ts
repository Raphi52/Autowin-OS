import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AgentPilot, type PilotEvent, type RecoveredPilotProviderCall } from './agent-pilot'
import { configureAutowinAppDataBase } from '../app/app-data'
import type { PromptSnapshot } from '../commands/commands'
import type { ExecutionEvidence, SendResult } from '../providers/types'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'

/*
 * ISOLATION : un échec d'action est inscrit au registre des murs, qui PERSISTE sur disque. Le dossier
 * du tour est celui que lit le pilote : la garde n'y compte que les fichiers écrits dedans.
 */
let racine = ''
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'preuve-du-tour-'))
  configureAutowinAppDataBase(racine)
  vi.stubEnv(AUTOWIN_WORKSPACE_ENV, racine)
})
afterEach(() => {
  vi.unstubAllEnvs()
  configureAutowinAppDataBase(undefined)
  if (racine) rmSync(racine, { recursive: true, force: true })
})

/**
 * LA RELANCE DE PREUVE, DANS UN VRAI DÉROULÉ DU PILOTE (conv-1423).
 *
 * Le moteur de tour est le vrai ; seul le modèle est factice, et il rend les mêmes champs que
 * l'adaptateur Claude (`executionEvidence`). L'oracle : le nombre d'appels payés au modèle, et le
 * texte de la consigne qu'il reçoit. Ce qui ferait échouer ces tests : une relance qui boucle, une
 * garde qui bloque le tour, ou un fait perdu entre deux itérations.
 * fix-ok: mesuré du 29/10 au 01/11 sur 139 demandes qui ont écrit du code : 92 finies sur un test
 * rouge, sans aucune relance. Les relances d'échec existantes passent avant : elles gardent leur place.
 */
const snapshotForPrompt = async (): Promise<PromptSnapshot> => ({
  tab: 'chat',
  providers: [],
  runsBlocked: [],
  conversationsCount: 0
})

const CLOTURE =
  '\n\n✅ Fait\n1. Écrit.\n\n📍 Maintenant : terminé.\n⏳ Reste à faire : aucune étape.'

const trace = (partielle: Partial<ExecutionEvidence>): ExecutionEvidence => ({
  type: 'Bash',
  kind: 'inspection',
  status: 'completed',
  ok: true,
  summary: '',
  ...partielle
})

const ecriture = (path: string): ExecutionEvidence =>
  trace({ type: 'Edit', kind: 'mutation', path, paths: [path] })

const ROUGE = 'npx vitest run src/a.test.ts'
const test = (commande: string, codeDeSortie: number): ExecutionEvidence =>
  trace({
    kind: 'verification',
    command: commande,
    testsLus: [{ commande, codeDeSortie, at: Date.now() }]
  })

interface Appel {
  text: string
  executionEvidence?: ExecutionEvidence[]
}

async function jouer(
  appels: Appel[],
  options: {
    recovered?: RecoveredPilotProviderCall
    tourDeFond?: boolean
    exec?: (nom: string, args: unknown) => { ok: boolean; data?: unknown; error?: string }
    soigne?: boolean
  } = {}
): Promise<{ appels: number; consignes: string[]; events: PilotEvent[] }> {
  const consignes: string[] = []
  const send = vi.fn(
    async (
      _provider: string,
      messages: { content: string }[],
      _options: unknown,
      onChunk?: (chunk: { delta: string }) => void
    ): Promise<SendResult> => {
      consignes.push(messages.map((m) => m.content).join('\n'))
      const appel = appels.shift() ?? { text: `Rien de plus.${CLOTURE}` }
      onChunk?.({ delta: appel.text })
      return { provider: 'claude', ...appel } as SendResult
    }
  )
  const registry = {
    send,
    describePrompt: () => ({
      provider: 'claude',
      transport: 'fixture',
      messages: [],
      options: {},
      limitation: 'test'
    })
  }
  const roles = {
    getBinding: () => ({ provider: 'claude', model: 'claude-test', reasoningEffort: 'low' })
  }
  const bus = {
    catalog: () => [
      { name: 'get_state', args: {}, description: 'etat' },
      { name: 'verify', args: {}, description: 'verification' }
    ],
    snapshotForPrompt,
    exec: vi.fn(async (nom: string, args: unknown) => options.exec?.(nom, args) ?? { ok: true })
  }
  const events: PilotEvent[] = []
  await new AgentPilot(registry as never, roles as never, bus as never).chat(
    [{ role: 'user', content: 'corrige le fichier a.ts' }],
    (event) => events.push(event),
    undefined,
    6,
    'conv-preuve-du-tour',
    undefined, // signal
    undefined, // drainDirectives
    undefined, // bindingOverride
    undefined, // turnId
    undefined, // runtimeBinding
    options.recovered,
    undefined, // onProviderJournal
    options.tourDeFond ? ({ tourDeFond: true } as never) : undefined,
    undefined, // routingUserMessageOverride
    undefined, // tourCoupePourCeMessage
    options.soigne ?? true // exigerExperienceSoignee
  )
  return { appels: send.mock.calls.length, consignes, events }
}

const ecritDansLeDossier = (): ExecutionEvidence => ecriture(join(racine, 'src', 'a.ts'))

describe('relance de preuve — dans un déroulé réel du pilote', () => {
  it('un rouge resté en place : exactement 2 appels, et la relance nomme la commande', async () => {
    const { appels, consignes, events } = await jouer([
      {
        text: `C’est corrigé.${CLOTURE}`,
        executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1)]
      },
      { text: `Le test reste rouge.\n⚠️ Non résolu : à reprendre.${CLOTURE}` }
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain(`\`${ROUGE}\``)
    expect(consignes.at(-1)).toContain('REMPLACE')
    // La réponse relancée est retirée du fil : elle sera remplacée, jamais doublée.
    expect(events.some((e) => e.kind === 'stream-reset')).toBe(true)
  })

  it('le tour finit même si l’agent ne fait rien : la relance ne bloque jamais', async () => {
    const texte = `C’est corrigé.${CLOTURE}`
    const { appels, events } = await jouer([
      { text: texte, executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1)] },
      { text: texte }
    ])
    expect(appels).toBe(2)
    const fin = events.find((e) => e.kind === 'done') as { text?: string } | undefined
    expect(fin?.text).toContain('C’est corrigé.')
  })

  it('un seul appel quand le rouge a été rejoué vert', async () => {
    const { appels } = await jouer([
      {
        text: `C’est corrigé.${CLOTURE}`,
        executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1), test(ROUGE, 0)]
      }
    ])
    expect(appels).toBe(1)
  })

  it('les faits s’accumulent d’une itération à l’autre', async () => {
    const { appels } = await jouer([
      {
        text: 'Je relis.<cmd>{"name":"get_state","args":{}}</cmd>',
        executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1)]
      },
      { text: `C’est corrigé.${CLOTURE}`, executionEvidence: [test('npx vitest run', 0)] }
    ])
    // Le rouge de l'appel 1 est couvert par le vert de l'appel 2 : aucune relance.
    expect(appels).toBe(2)
  })

  /*
   * fix-ok: `verify` se décide dans le dossier du tour : avec le mauvais dossier, le fichier du rouge
   * y serait absent et `verify` ne serait jamais proposé, sans qu'aucun test de la garde le voie.
   */
  it('la relance propose `verify` si le dossier du tour peut le jouer sur ce fichier', async () => {
    mkdirSync(join(racine, 'src'), { recursive: true })
    writeFileSync(join(racine, 'src', 'a.test.ts'), '// test', 'utf8')
    writeFileSync(
      join(racine, 'package.json'),
      JSON.stringify({ scripts: { 'test:unit': 'vitest run' } }),
      'utf8'
    )
    const { consignes } = await jouer([
      {
        text: `C’est corrigé.${CLOTURE}`,
        executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1)]
      },
      { text: `Non vérifié : le test reste rouge.${CLOTURE}` }
    ])
    expect(consignes.at(-1)).toContain('`verify` avec ce fichier pour cible')
  })

  it('jumeau : sans script de test dans ce dossier, seul le rejeu est proposé', async () => {
    const { consignes } = await jouer([
      {
        text: `C’est corrigé.${CLOTURE}`,
        executionEvidence: [ecritDansLeDossier(), test(ROUGE, 1)]
      },
      { text: `Non vérifié : le test reste rouge.${CLOTURE}` }
    ])
    expect(consignes.at(-1)).toContain('Rejoue-le tel quel')
    expect(consignes.at(-1)).not.toContain('`verify`')
  })

  it('du code écrit sans aucune preuve : relance sans inventer de commande', async () => {
    const { appels, consignes } = await jouer([
      { text: `C’est corrigé.${CLOTURE}`, executionEvidence: [ecritDansLeDossier()] },
      { text: `Non vérifié : pas de test pour ce fichier.${CLOTURE}` }
    ])
    expect(appels).toBe(2)
    expect(consignes.at(-1)).toContain('verify')
  })

  it('un `verify` rouge non rattrapé, joué par le modèle : la garde le voit', async () => {
    const { appels, consignes } = await jouer(
      [
        {
          text: 'Je vérifie.<cmd>{"name":"verify","args":{"target":"a"}}</cmd>',
          executionEvidence: [ecritDansLeDossier()]
        },
        // L'échec est dit et déclaré hors de portée : les deux relances d'échec restent muettes.
        { text: `Je ne peux pas aller plus loin : npm test a échoué.${CLOTURE}` },
        { text: `⚠️ Non résolu : npm test rouge.${CLOTURE}` }
      ],
      {
        exec: () => ({ ok: true, data: { command: 'npm test', exitCode: 1, ok: false } })
      }
    )
    expect(appels).toBe(3)
    expect(consignes.at(-1)).toContain('`npm test`')
  })

  it('jumeau : un `verify` vert est une preuve retenue, aucune relance', async () => {
    const { appels } = await jouer(
      [
        {
          text: 'Je vérifie.<cmd>{"name":"verify","args":{"target":"a"}}</cmd>',
          executionEvidence: [ecritDansLeDossier()]
        },
        { text: `C’est corrigé, npm test passe.${CLOTURE}` }
      ],
      {
        exec: () => ({ ok: true, data: { command: 'npm test', exitCode: 0, ok: true } })
      }
    )
    expect(appels).toBe(2)
  })

  it('une relance déjà partie dans le tour prend la place : jamais deux', async () => {
    const { consignes } = await jouer(
      [
        {
          text: 'Je vérifie.<cmd>{"name":"verify","args":{"target":"a"}}</cmd>',
          executionEvidence: [ecritDansLeDossier()]
        },
        { text: `Tout est bon.${CLOTURE}` },
        { text: `Tout est bon.${CLOTURE}` },
        { text: `Tout est bon.${CLOTURE}` },
        { text: `Tout est bon.${CLOTURE}` }
      ],
      { exec: () => ({ ok: true, data: { command: 'npm test', exitCode: 1, ok: false } }) }
    )
    // Le rouge de `verify` a déjà sa relance, « tu n'as pas dit l'échec » : la garde n'en ajoute pas.
    expect(
      consignes.some((consigne) => consigne.includes('avoué') || consigne.includes('ÉCHOUÉ'))
    ).toBe(true)
    expect(consignes.some((consigne) => consigne.includes('ne le couvre'))).toBe(false)
  })

  it('un `verify` refusé : aucune relance de preuve', async () => {
    const { appels, consignes } = await jouer(
      [
        {
          text: 'Je vérifie.<cmd>{"name":"verify","args":{"target":"a"}}</cmd>',
          executionEvidence: [ecritDansLeDossier()]
        },
        // L'échec est dit et déclaré hors de portée : les relances d'échec gardent le silence.
        { text: `Je ne peux pas vérifier : verify a échoué, aucun script de test ici.${CLOTURE}` }
      ],
      { exec: () => ({ ok: true, data: { allowed: false, reason: 'aucun script' } }) }
    )
    expect(appels).toBe(2)
    expect(consignes.some((consigne) => consigne.includes('aucune preuve retenue'))).toBe(false)
  })

  it('un tour de fond ne relance pas', async () => {
    const { appels } = await jouer(
      [{ text: `C’est corrigé.${CLOTURE}`, executionEvidence: [ecritDansLeDossier()] }],
      { tourDeFond: true }
    )
    expect(appels).toBe(1)
  })

  it('hors de la surface de chat soignée, aucune relance', async () => {
    const { appels } = await jouer(
      [{ text: `C’est corrigé.${CLOTURE}`, executionEvidence: [ecritDansLeDossier()] }],
      { soigne: false }
    )
    expect(appels).toBe(1)
  })
})

describe('relance de preuve — après un redémarrage de l’app', () => {
  const recupere = (
    executionEvidence: ExecutionEvidence[],
    iteration = 0
  ): RecoveredPilotProviderCall => ({
    iteration,
    attempt: 0,
    streamId: `${iteration}:0`,
    streamedPrefix: '',
    result: {
      text: `C’est corrigé.${CLOTURE}`,
      provider: 'claude',
      executionEvidence
    } as SendResult
  })

  it('un vert vu dans l’appel récupéré : pas de relance à tort', async () => {
    const { appels } = await jouer([], {
      recovered: recupere([ecritDansLeDossier(), test(ROUGE, 0)])
    })
    expect(appels).toBe(0)
  })

  it('un rouge vu dans l’appel récupéré : relance', async () => {
    const { appels, consignes } = await jouer([{ text: `⚠️ Non résolu.${CLOTURE}` }], {
      recovered: recupere([ecritDansLeDossier(), test(ROUGE, 1)])
    })
    expect(appels).toBe(1)
    expect(consignes.at(-1)).toContain(`\`${ROUGE}\``)
  })

  it('les premières itérations sont perdues : aucune relance « sans preuve » à l’aveugle', async () => {
    const { appels } = await jouer([], { recovered: recupere([ecritDansLeDossier()], 2) })
    expect(appels).toBe(0)
  })
})
