import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot } from './agent-pilot'
import { configureCopieDuFilDuChat } from './session-du-tour'
import { configureAutowinAppDataBase } from '../app/app-data'
import {
  configureClaudeAccountEnv,
  configureClaudeActiveAccountId
} from '../providers/claude-accounts'
import {
  copieNotee,
  dossierDeTravailDuTour,
  preparerLeDossierDuTour
} from '../conversations/bascule-dossier-conversation'
import { encoderCheminCli } from '../store/historique-cli-copie'
import { ConversationStore } from '../store/conversations'
import type { Message, SendOptions, SendResult, StreamChunk } from '../providers/types'
import { AUTOWIN_WORKSPACE_ENV } from '../../shared/app-identity'

/**
 * Session-resume du CHAT (levier coût — mesure 2026-07-28 : 1,85 M de cache_write en 1h, ~79 k de
 * contexte re-payé par tour). Le tour N+1 doit REPRENDRE la session ouverte au tour N et n'envoyer
 * que le dernier message, au lieu de ré-injecter tout le fil.
 *
 * HERMÉTICITÉ OBLIGATOIRE depuis que l'index de sessions est PERSISTÉ : sans racine de données
 * dédiée, ces tests écrivaient dans le `%APPDATA%` RÉEL du développeur et se relisaient d'un run à
 * l'autre — le test « pas de fuite entre conversations » passait au premier run et échouait au
 * second, en lisant une entrée que le run précédent avait laissée. Constaté, pas supposé : une entrée
 * `conv-B → sess-1` a bel et bien été retrouvée dans le store réel. Un test qui écrit dans la donnée
 * de production n'est pas seulement fragile, il peut faire tenter à l'app une reprise sur une session
 * qui n'existe pas.
 */
type Captured = { options: SendOptions; content: string }

// `null` explicite, PAS `undefined` : un `undefined` passe déclenche la valeur par défaut.
function pilot(captured: Captured[], sessionId: string | null = 'sess-1') {
  const registry = {
    send: vi.fn(
      async (
        _provider: string,
        messages: Message[],
        options: SendOptions,
        _onChunk?: (c: StreamChunk) => void
      ): Promise<SendResult> => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        return { text: 'ok', ...(sessionId ? { sessionId } : {}) } as SendResult
      }
    ),
    describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
    // Ce faux simule `claude`, le seul adaptateur qui transmet réellement `--resume`.
    honoursSessionResume: vi.fn(() => true)
  }
  const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => []),
    snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
    exec: vi.fn()
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return new AgentPilot(registry as any, roles as any, bus as any)
}

const history = (...turns: string[]): Message[] =>
  turns.map(
    (content, index) => ({ role: index % 2 === 0 ? 'user' : 'assistant', content }) as Message
  )

describe('chat() — session-resume par conversation', () => {
  // Une racine NEUVE par test : l'index de sessions étant persisté, un test qui hérite du store d'un
  // autre (ou du store réel) ne mesure plus ce qu'il croit.
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-sessresume-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
  })

  it('tour 1 : aucune session connue → fil COMPLET, sans resumeSessionId', async () => {
    const captured: Captured[] = []
    await pilot(captured).chat(history('bonjour'), () => {}, undefined, 1, 'conv-A')
    expect(captured).toHaveLength(1)
    expect(captured[0].options.resumeSessionId).toBeUndefined()
    expect(captured[0].content).toContain('bonjour')
  })

  it('tour 2 : REPREND la session et n’envoie QUE le dernier message', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-A')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-A'
    )

    expect(captured[1].options.resumeSessionId).toBe('sess-1')
    expect(captured[1].content).toContain('deuxieme message')
    // Le coeur du levier : l'historique n'est PLUS re-injecte (il vit dans la session CLI).
    expect(captured[1].content).not.toContain('premier message')
    expect(captured[1].content).not.toContain('ma reponse')
  })

  it('conversation DIFFÉRENTE → pas de fuite de session entre conversations', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('dans A'), () => {}, undefined, 1, 'conv-A')
    await p.chat(history('dans B'), () => {}, undefined, 1, 'conv-B')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('dans B')
  })

  it('changement de MODÈLE → session invalidée (on ne reprend pas avec un autre modèle)', async () => {
    const captured: Captured[] = []
    const registry = {
      send: vi.fn(async (_p: string, m: Message[], o: SendOptions) => {
        captured.push({ options: o, content: m.at(-1)?.content ?? '' })
        return { text: 'ok', sessionId: 'sess-1' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => true)
    }
    let model = 'opus-5'
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({})),
      exec: vi.fn()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)
    await p.chat(history('avec opus'), () => {}, undefined, 1, 'conv-A')
    model = 'haiku-4-5'
    await p.chat(history('avec opus', 'r', 'avec haiku'), () => {}, undefined, 1, 'conv-A')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('avec opus') // fil complet re-injecte : degradation propre
  })

  it('provider qui ne rend AUCUN sessionId → comportement actuel préservé', async () => {
    const captured: Captured[] = []
    const p = pilot(captured, null)
    await p.chat(history('un'), () => {}, undefined, 1, 'conv-A')
    await p.chat(history('un', 'deux', 'trois'), () => {}, undefined, 1, 'conv-A')
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('un') // fil complet
  })

  it('retour au binding initial après un provider sans session → invalide la session périmée', async () => {
    const captured: Array<Captured & { provider: string }> = []
    let provider = 'claude'
    let model = 'opus-5'
    const registry = {
      send: vi.fn(async (p: string, messages: Message[], options: SendOptions) => {
        captured.push({ provider: p, options, content: messages.at(-1)?.content ?? '' })
        return {
          text: 'ok',
          ...(p === 'claude' ? { sessionId: 'sess-claude' } : {})
        } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider, messages: [], transport: 't' })),
      // Fidèle au réel : `claude` reprend, `codex` non — c'est tout l'objet de ce scénario.
      honoursSessionResume: vi.fn((id: string) => id === 'claude')
    }
    const roles = { getBinding: vi.fn(() => ({ provider, model })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({})),
      exec: vi.fn()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)

    await p.chat(history('début avec Claude'), () => {}, undefined, 1, 'conv-A')
    provider = 'codex'
    model = 'gpt-nouveau'
    await p.chat(
      history('début avec Claude', 'réponse Claude', 'passage à Codex'),
      () => {},
      undefined,
      1,
      'conv-A'
    )
    provider = 'claude'
    model = 'opus-5'
    await p.chat(
      history(
        'début avec Claude',
        'réponse Claude',
        'passage à Codex',
        'réponse Codex',
        'retour à Claude'
      ),
      () => {},
      undefined,
      1,
      'conv-A'
    )

    expect(captured[2].options.resumeSessionId).toBeUndefined()
    expect(captured[2].content).toContain('passage à Codex')
    expect(captured[2].content).toContain('réponse Codex')
  })

  /**
   * RESUME FANTÔME — mesuré le 2026-08-04 sur les journaux de prompts réels (90 fils, 113 appels) :
   * 0 appel `resumed=true` au transport, mais 31 prompts affirmant « tu en connais déjà l'historique ».
   *
   * Cause : `codex` RETOURNE un sessionId (son `thread_id`) mais n'honore JAMAIS `resumeSessionId` —
   * seul `claude` le passe à son CLI. Le pilote mémorisait la session sans regarder le provider, donc
   * le tour suivant amputait le fil ET affirmait au modèle qu'il le connaissait par sa session. Il ne
   * l'avait pas : il comblait le trou au lieu de signaler l'absence. Pire que perdre le contexte, on
   * lui interdisait de le réclamer.
   */
  it("provider qui rend un sessionId sans savoir le REPRENDRE → fil COMPLET, jamais d'amputation", async () => {
    const captured: Captured[] = []
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], options: SendOptions) => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        // Exactement codex : il rend son thread_id alors qu'il ne sait pas le reprendre.
        return { text: 'ok', sessionId: 'thread-codex-1' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'codex', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => false)
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'codex', model: 'gpt-5.6-sol' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({})),
      exec: vi.fn()
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = new AgentPilot(registry as any, roles as any, bus as any)

    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-A')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-A'
    )

    expect(captured[1].options.resumeSessionId).toBeUndefined()
    // Le fil est REMIS en entier, puisque personne ne l'a réellement conservé.
    expect(captured[1].content).toContain('premier message')
    expect(captured[1].content).toContain('ma reponse')
    // Et surtout : on ne lui affirme plus qu'il connaît un historique qu'il n'a pas reçu.
    expect(captured[1].content).not.toContain('tu en connais déjà l’historique')
  })

  it('sans conversationId → jamais de resume (rien à quoi rattacher la session)', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    await p.chat(history('a'), () => {}, undefined, 1)
    await p.chat(history('a', 'b', 'c'), () => {}, undefined, 1)
    expect(captured[1].options.resumeSessionId).toBeUndefined()
  })
})

/**
 * BASCULE DE COMPTE — une session CLI vit dans le `CLAUDE_CONFIG_DIR` du compte qui l'a ouverte.
 * La reprendre depuis un AUTRE compte fait rendre au CLI « No conversation found with session ID »
 * et le tour meurt a 0 message (vecu le 2026-08-30). La session doit donc etre oubliee a la bascule.
 */
describe('chat() — le compte Claude actif fait partie de l’identite de session', () => {
  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-sessacct-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
    configureClaudeActiveAccountId(() => undefined)
  })

  it('changer de compte entre deux tours → PAS de resume, fil complet', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    configureClaudeActiveAccountId(() => 'default')
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-ACC')
    configureClaudeActiveAccountId(() => 'compte-3')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-ACC'
    )
    expect(captured).toHaveLength(2)
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('premier message')
  })

  it('meme compte entre deux tours → la reprise reste armee', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    configureClaudeActiveAccountId(() => 'compte-3')
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-ACC2')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-ACC2'
    )
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
  })
})

/**
 * CHANGEMENT DE DOSSIER DE TRAVAIL — même panne que la bascule de compte, autre axe.
 *
 * Le CLI Claude range ses sessions PAR DOSSIER (`~/.claude/projects/<cwd encodé>/`), et le cwd d'un
 * tour de chat EST `process.env[AUTOWIN_WORKSPACE_ENV]` (`providers/claude.ts`, `readOnlyCwd`).
 * Reprendre depuis un AUTRE dossier fait donc rendre au CLI « No conversation found with session ID ».
 *
 * VÉCU le 2026-09-06, : conversation ouverte dans `E:\GIT\Autowin-OS`, workspace basculé sur
 * `E:\AutoWin-Temp` le temps d'un essai. Le tour est mort à `error_during_execution`, 0 message,
 * 0 token, 0 USD — l'appel n'avait pas démarré. La session n'était ni perdue ni corrompue : 355
 * lignes, 141 messages assistant, `cwd = E:\GIT\Autowin-OS`. Elle était simplement réclamée depuis
 * le mauvais dossier. Le binding stocké le disait : `conv-48 → key "claude:opus:default"`, sans
 * trace du dossier.
 */
describe('chat() — le dossier de travail fait partie de l’identite de session', () => {
  const envInitial = process.env[AUTOWIN_WORKSPACE_ENV]

  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-sessws-')))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
    if (envInitial === undefined) delete process.env[AUTOWIN_WORKSPACE_ENV]
    else process.env[AUTOWIN_WORKSPACE_ENV] = envInitial
  })

  it('changer de dossier entre deux tours → PAS de resume, fil complet', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    process.env[AUTOWIN_WORKSPACE_ENV] = join('E:', 'GIT', 'Autowin-OS')
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-WS')
    // L'essai bascule le workspace : la session ouverte au tour 1 n'existe pas dans ce dossier-la.
    process.env[AUTOWIN_WORKSPACE_ENV] = join('E:', 'AutoWin-Temp')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-WS'
    )
    expect(captured).toHaveLength(2)
    expect(captured[1].options.resumeSessionId).toBeUndefined()
    // Le fil complet doit repartir : sans lui, le modele perdrait tout le contexte au changement.
    expect(captured[1].content).toContain('premier message')
  })

  it('meme dossier entre deux tours → la reprise reste armee', async () => {
    const captured: Captured[] = []
    const p = pilot(captured)
    process.env[AUTOWIN_WORKSPACE_ENV] = join('E:', 'GIT', 'Autowin-OS')
    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-WS2')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-WS2'
    )
    // Discriminant : sans cette assertion, retirer le workspace de la cle passerait le test du haut
    // en cassant la reprise pour TOUT LE MONDE — le levier de cout disparaitrait en silence.
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
  })
})

/*
 * UN FIL QUI PASSE DANS SA COPIE GARDE LA MÉMOIRE DE SON AGENT. Le CLI range sa session sous le
 * dossier de son cwd (`projects/<cwd encodé>/<session>.jsonl`). Au passage, la session est recopiée
 * sous le dossier de la copie et reprise là : l'agent ne relit pas le fil. Seul un passage dans SA
 * copie le fait ; un changement de dossier ordinaire garde la règle d'avant (session oubliée).
 * Le CLI réel est simulé ici : chaque appel AJOUTE une ligne à sa session, sous le cwd de l'appel.
 * fix-ok: cause mesurée — la clé de session de `session-du-tour.ts` contient le dossier, et toute
 * session dont la clé change est oubliée : le passage perdait la reprise
 * (rouge mesuré : resumeSessionId undefined, attendu 'sess-1'). Le faux CLI écrit à chaque appel, donc
 * son fichier existe après le tour 2 même sans copie : la preuve est l'absence de la ligne du tour 1.
 */
describe('chat() — un fil qui passe dans sa copie garde la session de l’outil', () => {
  const DEPOT = join('D:', 'AutoWinOS')
  const COPIE = join(DEPOT, '.autowin-data', 'autowin-os', 'retours-de-tour', 'essai__conv-P-6-1')
  const envInitial = process.env[AUTOWIN_WORKSPACE_ENV]
  let config = ''

  beforeEach(() => {
    configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-sessfil-')))
    config = mkdtempSync(join(tmpdir(), 'aos-cfg-'))
    configureClaudeAccountEnv(() => ({ CLAUDE_CONFIG_DIR: config }))
  })
  afterEach(() => {
    configureAutowinAppDataBase(undefined)
    configureClaudeAccountEnv(() => ({}))
    configureCopieDuFilDuChat(() => null)
    if (envInitial === undefined) delete process.env[AUTOWIN_WORKSPACE_ENV]
    else process.env[AUTOWIN_WORKSPACE_ENV] = envInitial
  })

  const fichierDeSession = (cwd: string): string =>
    join(config, 'projects', encoderCheminCli(cwd), 'sess-1.jsonl')

  /** Un pilote dont le fournisseur reprend (ou non) sa session, et écrit (ou non) la sienne. */
  function pilote(
    captured: Captured[],
    opts: { reprend: boolean; ecrit: boolean; dossierDuTour: (conversationId?: string) => string }
  ): AgentPilot {
    const registry = {
      send: vi.fn(async (_p: string, messages: Message[], options: SendOptions) => {
        captured.push({ options, content: messages.at(-1)?.content ?? '' })
        if (opts.ecrit) {
          const dossier = join(config, 'projects', encoderCheminCli(options.workspaceCwd ?? ''))
          mkdirSync(dossier, { recursive: true })
          appendFileSync(join(dossier, 'sess-1.jsonl'), `tour ${captured.length}\n`, 'utf8')
        }
        return { text: 'ok', sessionId: 'sess-1' } as SendResult
      }),
      describePrompt: vi.fn(() => ({ provider: 'claude', messages: [], transport: 't' })),
      honoursSessionResume: vi.fn(() => opts.reprend)
    }
    const roles = { getBinding: vi.fn(() => ({ provider: 'claude', model: 'opus-5' })) }
    const bus = {
      catalog: vi.fn(() => []),
      snapshotForPrompt: vi.fn(async () => ({ tab: 'chat' })),
      exec: vi.fn()
    }
    type Parametres = ConstructorParameters<typeof AgentPilot>
    return new AgentPilot(
      registry as unknown as Parametres[0],
      roles as unknown as Parametres[1],
      bus as unknown as Parametres[2],
      undefined,
      () => '',
      opts.dossierDuTour
    )
  }

  /** Le même passage que `passerLeFilDansSaCopie` (ipc/chat.ts), sur le VRAI magasin. */
  const passerDansLaCopie = (store: ConversationStore, id: string): Promise<unknown> =>
    preparerLeDossierDuTour({
      fil: store.get(id),
      depotPartage: DEPOT,
      actif: true,
      ouvrirCopie: async () => ({ ok: true, chemin: COPIE }),
      passer: (copie) => {
        store.passerDansLaCopie(id, copie)
      },
      revenir: () => {
        store.revenirDeLaCopie(id)
      },
      annoncer: () => {},
      dossierExiste: () => true
    })

  it('passage dans la copie → la session est reprise, le fil n’est pas renvoyé, et la session suit sous la copie', async () => {
    const captured: Captured[] = []
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    configureCopieDuFilDuChat((conversationId) => copieNotee(store.get(conversationId)))
    const dossierDuTour = (conversationId?: string): string =>
      dossierDeTravailDuTour(store.get(conversationId ?? '')?.projectPath, DEPOT, () => true)
    const p = pilote(captured, { reprend: true, ecrit: true, dossierDuTour })

    await p.chat(history('le code secret est 4417'), () => {}, undefined, 1, id)
    await passerDansLaCopie(store, id)
    await p.chat(
      history('le code secret est 4417', 'noté', 'quel est le code ?'),
      () => {},
      undefined,
      1,
      id
    )

    expect(captured).toHaveLength(2)
    expect(captured[0].options.workspaceCwd).toBe(DEPOT)
    expect(captured[1].options.workspaceCwd).toBe(COPIE)
    expect(captured[1].options.resumeSessionId).toBe('sess-1')
    expect(captured[1].content).toContain('quel est le code ?')
    expect(captured[1].content).not.toContain('le code secret est 4417')
    // Le CLI cherchera la session sous le dossier de la copie : c'est là qu'elle doit se trouver.
    expect(readFileSync(fichierDeSession(COPIE), 'utf8')).toContain('tour 1')
  })

  it('passage dans la copie sans session à reprendre (rien d’écrit ou purgée) → fil complet, sans reprise', async () => {
    const captured: Captured[] = []
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    configureCopieDuFilDuChat((conversationId) => copieNotee(store.get(conversationId)))
    const dossierDuTour = (conversationId?: string): string =>
      dossierDeTravailDuTour(store.get(conversationId ?? '')?.projectPath, DEPOT, () => true)
    const p = pilote(captured, { reprend: true, ecrit: false, dossierDuTour })

    await p.chat(history('le code secret est 4417'), () => {}, undefined, 1, id)
    await passerDansLaCopie(store, id)
    await p.chat(
      history('le code secret est 4417', 'noté', 'quel est le code ?'),
      () => {},
      undefined,
      1,
      id
    )

    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('le code secret est 4417')
    expect(existsSync(fichierDeSession(COPIE))).toBe(false)
  })

  it('changement de dossier HORS copie → rien n’est recopié, fil complet (la règle d’avant tient)', async () => {
    process.env[AUTOWIN_WORKSPACE_ENV] = join('E:', 'GIT', 'Autowin-OS')
    const captured: Captured[] = []
    const p = pilote(captured, { reprend: true, ecrit: true, dossierDuTour: () => '' })

    await p.chat(history('premier message'), () => {}, undefined, 1, 'conv-HORS')
    process.env[AUTOWIN_WORKSPACE_ENV] = join('E:', 'AutoWin-Temp')
    await p.chat(
      history('premier message', 'ma reponse', 'deuxieme message'),
      () => {},
      undefined,
      1,
      'conv-HORS'
    )

    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('premier message')
    // Le CLI écrit bien sa ligne du tour 2 là ; ce qu'on refuse, c'est la copie de l'ANCIENNE session.
    expect(readFileSync(fichierDeSession(join('E:', 'AutoWin-Temp')), 'utf8')).not.toContain(
      'tour 1'
    )
  })

  it('Codex, Grok, agy (ne reprennent pas leur session) → rien à suivre : fil complet, aucune copie de session', async () => {
    const captured: Captured[] = []
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    configureCopieDuFilDuChat((conversationId) => copieNotee(store.get(conversationId)))
    const dossierDuTour = (conversationId?: string): string =>
      dossierDeTravailDuTour(store.get(conversationId ?? '')?.projectPath, DEPOT, () => true)
    const p = pilote(captured, { reprend: false, ecrit: true, dossierDuTour })

    await p.chat(history('le code secret est 4417'), () => {}, undefined, 1, id)
    await passerDansLaCopie(store, id)
    await p.chat(
      history('le code secret est 4417', 'noté', 'quel est le code ?'),
      () => {},
      undefined,
      1,
      id
    )

    expect(captured[1].options.resumeSessionId).toBeUndefined()
    expect(captured[1].content).toContain('le code secret est 4417')
    // Aucune copie de l'ancienne session : la ligne du tour 1 n'est pas dans le dossier de la copie.
    expect(readFileSync(fichierDeSession(COPIE), 'utf8')).not.toContain('tour 1')
  })

  // fix-ok: cause mesurée — rouge : `expected undefined to be 'sess-1'`. Le fournisseur ne rendait la copie
  // que pour un fil qui y travaille (copieOuTravailleLeFil), et la session n'était suivie que dans le sens
  // aller : une fois le fil revenu dans son dossier d'avant, la clé de session ne retrouvait rien.
  it('copie retirée, fil revenu dans son dossier d’avant → le tour suivant reprend la session, recopiée sous ce dossier', async () => {
    const captured: Captured[] = []
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    configureCopieDuFilDuChat((conversationId) => copieNotee(store.get(conversationId)))
    const dossierDuTour = (conversationId?: string): string =>
      dossierDeTravailDuTour(store.get(conversationId ?? '')?.projectPath, DEPOT, () => true)
    const p = pilote(captured, { reprend: true, ecrit: true, dossierDuTour })

    await p.chat(history('le code secret est 4417'), () => {}, undefined, 1, id)
    await passerDansLaCopie(store, id)
    await p.chat(
      history('le code secret est 4417', 'noté', 'quel est le code ?'),
      () => {},
      undefined,
      1,
      id
    )
    // Le ménage retire la copie et remet le fil dans son dossier d'avant (`decrocher` → `revenirDeLaCopie`).
    store.revenirDeLaCopie(id)
    await p.chat(
      history(
        'le code secret est 4417',
        'noté',
        'quel est le code ?',
        'le code est 4417',
        'et maintenant ?'
      ),
      () => {},
      undefined,
      1,
      id
    )

    expect(captured).toHaveLength(3)
    expect(captured[2].options.workspaceCwd).toBe(DEPOT)
    expect(captured[2].options.resumeSessionId).toBe('sess-1')
    expect(captured[2].content).toContain('et maintenant ?')
    expect(captured[2].content).not.toContain('le code secret est 4417')
    // La session du dossier d'avant porte les tours faits dans la copie (« tour 2 »), pas seulement le sien.
    expect(readFileSync(fichierDeSession(DEPOT), 'utf8')).toContain('tour 2')
  })

  it('copie retirée sans session posée sous elle → fil complet, sans reprise, rien n’est recopié', async () => {
    const captured: Captured[] = []
    const store = new ConversationStore(() => 1000)
    const id = store.create({ title: 'T', provider: 'claude', projectPath: DEPOT }).id
    configureCopieDuFilDuChat((conversationId) => copieNotee(store.get(conversationId)))
    const dossierDuTour = (conversationId?: string): string =>
      dossierDeTravailDuTour(store.get(conversationId ?? '')?.projectPath, DEPOT, () => true)
    const p = pilote(captured, { reprend: true, ecrit: false, dossierDuTour })

    await p.chat(history('le code secret est 4417'), () => {}, undefined, 1, id)
    await passerDansLaCopie(store, id)
    await p.chat(
      history('le code secret est 4417', 'noté', 'quel est le code ?'),
      () => {},
      undefined,
      1,
      id
    )
    store.revenirDeLaCopie(id)
    await p.chat(
      history(
        'le code secret est 4417',
        'noté',
        'quel est le code ?',
        'le code est 4417',
        'et maintenant ?'
      ),
      () => {},
      undefined,
      1,
      id
    )

    expect(captured[2].options.resumeSessionId).toBeUndefined()
    expect(captured[2].content).toContain('le code secret est 4417')
    expect(existsSync(fichierDeSession(DEPOT))).toBe(false)
  })
})
