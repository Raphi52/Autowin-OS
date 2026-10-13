import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AgentPilot, type PilotEvent } from './agent-pilot'
import { configureAutowinAppDataBase } from './app-data'
import {
  APPELS_NATIFS_MAX_PAR_ENVOI,
  cleAppelNatif,
  ouvrirOutilsNatifsDuChat,
  outilsDuChat
} from './chat-mcp'
import type { CommandSpec } from './commands'
import { argumentsMcpNoeudSkill } from './providers/claude'
import type { Message, SendOptions, SendResult, StreamChunk } from './providers/types'
import { RELANCE_FAIRE_LE_GESTE } from './chat-turn-messages'

/**
 * LES COMMANDES DU CHAT, SERVIES AUSSI COMME OUTILS DIRECTS DU MODELE (MCP).
 *
 * Reprise de l'idee du commit 7cec6570 (jamais fusionne), sur la base actuelle de main.
 *
 * CE QUE CES TESTS PROUVENT : un tour de chat avec Claude recoit les commandes de l'app sur son
 * canal d'outils natif ; un appel direct atteint le bus UNE fois, s'affiche et se COMPTE exactement
 * comme un `<cmd>` (echec non rattrape, depot de memoire refuse, bureau pilote) ; les commandes qui
 * ferment le tour (`ask`, `orchestrate`) et les commandes de fichiers restent au texte ; tout echec
 * du canal rend la main au texte `<cmd>`, avec une ligne visible.
 *
 * DEFAUTS QUI LES FONT ROUGIR (reinjectes un par un, voir le compte rendu du chantier) : retirer le
 * controle « deja executee » de la boucle des `<cmd>`, retirer l'exclusion d'`ask` du catalogue,
 * retirer la comptabilite commune sur le chemin direct, retirer la fermeture du serveur.
 */
const CATALOGUE: CommandSpec[] = [
  { name: 'get_state', description: 'etat', args: {} },
  { name: 'remember', description: 'memoire', args: { type: 'type' } },
  { name: 'desktop_observe', description: 'capture du bureau', args: {} },
  {
    name: 'read_file',
    description: 'lire',
    args: { path: 'chemin' },
    horsCanalNatif: 'le modele a deja son propre outil de lecture'
  },
  {
    name: 'edit_file',
    description: 'ecrire',
    args: { path: 'chemin' },
    horsCanalNatif: 'le modele a deja son propre outil d ecriture'
  },
  {
    name: 'orchestrate',
    description: 'lancer un run',
    args: { task: 'la tache' },
    horsCanalNatif: 'son issue clot le tour'
  },
  {
    name: 'ask',
    description: 'question',
    args: { question: 'q' },
    horsCanalNatif: 'une question clot le tour'
  }
]

type Config = { mcpServers: { autowin: { url: string; headers: Record<string, string> } } }
type Rpc = {
  result?: {
    tools?: Array<{ name: string }>
    content?: Array<{ type: string; text?: string; data?: string; mimeType?: string }>
    isError?: boolean
  }
}

async function rpc(mcpConfig: string, corps: unknown): Promise<Rpc> {
  const cfg = JSON.parse(mcpConfig) as Config
  const r = await fetch(cfg.mcpServers.autowin.url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...cfg.mcpServers.autowin.headers },
    body: JSON.stringify(corps)
  })
  return (await r.json()) as Rpc
}

const appeler = (o: SendOptions, nom: string, args: unknown = {}): Promise<Rpc> =>
  rpc(o.skillNodeTools!.mcpConfig, {
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: { name: nom, arguments: args }
  })

const texteDe = (r: Rpc): string => (r.result?.content ?? []).map((c) => c.text ?? '').join('\n')

interface Etape {
  pendant?: (o: SendOptions) => Promise<void>
  /** Battements d'outil diffuses par le CLI pendant l'envoi (`StreamChunk.status`). */
  statuts?: string[]
  texte?: string
  jette?: Error
}

type Exec = (nom: string, ...reste: unknown[]) => Promise<Record<string, unknown>>

function pilote(
  provider: string,
  etapes: Etape[],
  exec: Exec = async () => ({ ok: true, data: { tab: 'chat' } }),
  outilsNatifs: ConstructorParameters<typeof AgentPilot>[6] = true
) {
  const vus: SendOptions[] = []
  const prompts: string[] = []
  const restantes = [...etapes]
  const registry = {
    send: vi.fn(
      async (
        _p: string,
        messages: Message[],
        options: SendOptions,
        surMorceau?: (morceau: StreamChunk) => void
      ): Promise<SendResult> => {
        vus.push(options)
        prompts.push(messages.map((m) => m.content).join('\n'))
        const etape = restantes.shift() ?? { texte: 'fin.' }
        for (const status of etape.statuts ?? []) surMorceau?.({ delta: '', status })
        if (etape.pendant) await etape.pendant(options)
        if (etape.jette) throw etape.jette
        return { text: etape.texte ?? '' } as SendResult
      }
    ),
    describePrompt: vi.fn(() => ({
      provider,
      messages: [],
      transport: 't',
      options: {},
      limitation: 'test'
    })),
    honoursSessionResume: vi.fn(() => false)
  }
  const roles = { getBinding: vi.fn(() => ({ provider, model: 'opus-5' })) }
  const bus = {
    catalog: vi.fn(() => CATALOGUE),
    snapshotForPrompt: vi.fn(async () => ({
      tab: 'chat',
      providers: [],
      runsBlocked: [],
      conversationsCount: 0
    })),
    exec: vi.fn(exec)
  }
  const p = new AgentPilot(
    registry as never,
    roles as never,
    bus as never,
    undefined,
    () => '',
    () => '',
    outilsNatifs
  )
  const evenements: PilotEvent[] = []
  const jouer = (
    options: { signal?: AbortSignal; soigne?: boolean; surveillance?: boolean } = {}
  ): Promise<void> =>
    p.chat(
      [{ role: 'user', content: 'fais le point' } as Message],
      (e) => evenements.push(e),
      undefined,
      8,
      undefined,
      options.signal,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      options.surveillance ? { systemProfile: 'watchdog-read-only' } : undefined,
      undefined,
      undefined,
      options.soigne === true
    )
  const appelsBus = (nom: string): number => bus.exec.mock.calls.filter((c) => c[0] === nom).length
  const statuts = (): string[] =>
    evenements
      .filter((e) => e.kind === 'provider-status')
      .map((e) => String((e as { text?: string }).text ?? ''))
  const texteFinal = (): string =>
    String(
      ([...evenements].reverse().find((e) => e.kind === 'done') as { text?: string } | undefined)
        ?.text ?? ''
    )
  return { jouer, vus, prompts, bus, evenements, appelsBus, statuts, texteFinal }
}

describe('chat — commandes servies aussi comme outils directs du modele', () => {
  beforeEach(() => configureAutowinAppDataBase(mkdtempSync(join(tmpdir(), 'aos-chatmcp-'))))
  afterEach(() => configureAutowinAppDataBase(undefined))

  it('ce qui part au modele : la config d outils porte les commandes servies, pas celles du texte', async () => {
    let liste: Rpc = {}
    const t = pilote('claude', [
      {
        pendant: async (o) => {
          liste = await rpc(o.skillNodeTools!.mcpConfig, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/list'
          })
        },
        texte: 'Voici le point.'
      }
    ])
    await t.jouer()
    const premier = t.vus[0]!
    const autorises = premier.skillNodeTools?.allowedTools ?? []
    expect(autorises).toContain('mcp__autowin__remember')
    expect(autorises).toContain('mcp__autowin__get_state')
    for (const exclue of ['orchestrate', 'ask', 'edit_file', 'read_file']) {
      expect(autorises).not.toContain(`mcp__autowin__${exclue}`)
    }
    expect(argumentsMcpNoeudSkill(premier).mcp[0]).toBe('--mcp-config')
    // Le chat n'herite d'aucun serveur MCP du poste.
    expect(argumentsMcpNoeudSkill(premier).strict).toEqual(['--strict-mcp-config'])
    expect((liste.result?.tools ?? []).map((o) => o.name)).toEqual([
      'get_state',
      'remember',
      'desktop_observe'
    ])
    // SUCCES SILENCIEUX (conv-908, 2026-10-12 : « pk ca m'ecrit tout le temps ca dans le bloc
    // actions ») : le service normal ne s'annonce plus a chaque tour — seule une PANNE se dit
    // (« retour au texte », tests plus bas).
    expect(t.statuts().some((s) => /outils directs/i.test(s))).toBe(false)
  })

  it('pas de double execution : le <cmd> identique n est pas rejoue, un <cmd> different l est', async () => {
    let appel: Rpc = {}
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            appel = await appeler(o, 'remember', { type: 'lesson' })
          },
          texte:
            'Retenu.<cmd>{"name":"remember","args":{"type":"lesson"}}</cmd>' +
            '<cmd>{"name":"remember","args":{"type":"decision"}}</cmd>'
        },
        { texte: 'Fait.' }
      ],
      async () => ({ ok: true, data: { stored: true } })
    )
    await t.jouer()
    expect(appel.result?.isError).toBe(false)
    // 1 appel direct (lesson) + 1 <cmd> DIFFERENT (decision) ; le <cmd> identique est saute.
    expect(t.appelsBus('remember')).toBe(2)
    const args = t.bus.exec.mock.calls.filter((c) => c[0] === 'remember').map((c) => c[1])
    expect(args).toEqual([{ type: 'lesson' }, { type: 'decision' }])
    expect(t.statuts().some((s) => s.includes('non rejouée'))).toBe(true)
    // L'appel direct s'affiche comme un <cmd> : carte + resultat, meme identifiant.
    const carte = t.evenements.find(
      (e) => e.kind === 'command' && (e as { name?: string }).name === 'remember'
    ) as { actionId?: string } | undefined
    expect(carte?.actionId).toMatch(/^natif:/)
    expect(
      t.evenements.some(
        (e) => e.kind === 'result' && (e as { actionId?: string }).actionId === carte?.actionId
      )
    ).toBe(true)
  })

  it('commandes exclues : ask et orchestrate sont refusees en direct, rien n est execute', async () => {
    const reponses: Record<string, Rpc> = {}
    const t = pilote('claude', [
      {
        pendant: async (o) => {
          reponses.ask = await appeler(o, 'ask', { question: 'q', options: ['a', 'b'] })
          reponses.orchestrate = await appeler(o, 'orchestrate', { task: 't' })
          reponses.inconnue = await appeler(o, 'inexistante', {})
          // Jumeau accepte : une commande servie passe.
          reponses.get_state = await appeler(o, 'get_state', {})
        },
        texte: 'Voici.'
      }
    ])
    await t.jouer()
    for (const nom of ['ask', 'orchestrate']) {
      expect(reponses[nom]!.result?.isError).toBe(true)
      expect(texteDe(reponses[nom]!)).toContain('<cmd>')
      expect(t.appelsBus(nom)).toBe(0)
    }
    expect(reponses.inconnue!.result?.isError).toBe(true)
    expect(t.appelsBus('inexistante')).toBe(0)
    expect(reponses.get_state!.result?.isError).toBe(false)
    expect(t.appelsBus('get_state')).toBe(1)
  })

  it('meme comptabilite : un echec direct figure au bilan des echecs de fin de tour', async () => {
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            await appeler(o, 'desktop_observe', {})
          },
          texte: 'La capture a été refusée.'
        }
      ],
      async () => ({ ok: false, error: 'écran refusé' })
    )
    await t.jouer()
    const bilan = t.evenements.find((e) => e.kind === 'echecs-abandonnes') as
      { data?: Array<{ actionId: string; cible: string }> } | undefined
    expect(JSON.stringify(bilan?.data ?? [])).toContain('desktop_observe')
    expect(bilan?.data?.[0]?.actionId).toMatch(/^natif:/)
  })

  it('echec direct REPARE par un appel direct : la reprise « derniere action ECHOUEE » ne revient pas', async () => {
    /*
     * Mesure conv-908 (2026-10-12) : `verify` direct rouge, puis rejoue VERT (exit 0) — et la reprise
     * « ta derniere action a ECHOUE » revenait quand meme. Le drapeau d'echec de l'iteration n'etait
     * remis a plat que par la boucle des `<cmd>`, jamais atteinte par un tour 100 % outils directs.
     */
    const MARQUEUR = 'ta dernière action a ÉCHOUÉ'
    let essais = 0
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            await appeler(o, 'get_state', {})
          },
          texte: 'Le contrôle a renvoyé une erreur.'
        },
        {
          pendant: async (o) => {
            await appeler(o, 'get_state', {})
          },
          texte: 'Rejoué : l’état est lu, tout est en ordre.'
        }
      ],
      async () =>
        essais++ === 0 ? { ok: false, error: 'lecture refusée' } : { ok: true, data: { tab: 'chat' } }
    )
    await t.jouer({ soigne: true })
    expect(t.appelsBus('get_state')).toBe(2)
    expect(t.prompts[1]).toContain(MARQUEUR)
    // Aucun envoi ulterieur ne repousse la reprise apres la reparation.
    expect(t.prompts.at(-1)!.split(MARQUEUR).length - 1).toBe(1)
  })

  it('jumeau : un appel direct reussi ne laisse aucun bilan d echec', async () => {
    const t = pilote('claude', [
      {
        pendant: async (o) => {
          await appeler(o, 'desktop_observe', {})
        },
        texte: 'Capture prise.'
      }
    ])
    await t.jouer()
    expect(t.evenements.some((e) => e.kind === 'echecs-abandonnes')).toBe(false)
  })

  it('meme comptabilite : un remember direct refuse (stored:false) est dit a la cloture', async () => {
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            await appeler(o, 'remember', { type: 'lesson' })
          },
          texte: 'Je retiens la leçon.'
        }
      ],
      async () => ({ ok: true, data: { stored: false, detail: 'portée manquante' } })
    )
    await t.jouer()
    expect(t.texteFinal()).toContain('NON déposée')
    expect(t.texteFinal()).toContain('portée manquante')
  })

  it('jumeau : un remember direct depose ne pollue pas la cloture', async () => {
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            await appeler(o, 'remember', { type: 'lesson' })
          },
          texte: 'Je retiens la leçon.'
        }
      ],
      async () => ({ ok: true, data: { stored: true } })
    )
    await t.jouer()
    expect(t.texteFinal()).toContain('Je retiens la leçon.')
    expect(t.texteFinal()).not.toContain('NON déposée')
  })

  it('meme comptabilite : un bureau pilote en direct arme la relance « fais le geste toi-meme »', async () => {
    const t = pilote('claude', [
      {
        pendant: async (o) => {
          await appeler(o, 'desktop_observe', {})
        },
        texte: 'J’ai regardé l’écran.\n\nÀ faire :\n1. Clique sur OK.'
      },
      { texte: 'J’ai cliqué sur OK.' }
    ])
    await t.jouer({ soigne: true })
    expect(t.prompts.some((p) => p.includes(RELANCE_FAIRE_LE_GESTE))).toBe(true)
  })

  it('jumeau : sans bureau pilote, la meme cloture n arme pas cette relance', async () => {
    const t = pilote('claude', [
      {
        pendant: async (o) => {
          await appeler(o, 'get_state', {})
        },
        texte: 'J’ai regardé l’état.\n\nÀ faire :\n1. Clique sur OK.'
      },
      { texte: 'fin.' },
      { texte: 'fin.' }
    ])
    await t.jouer({ soigne: true })
    expect(t.prompts.some((p) => p.includes(RELANCE_FAIRE_LE_GESTE))).toBe(false)
  })

  it('une capture rendue en direct atteint le modele (image) et le fil (artefact)', async () => {
    let appel: Rpc = {}
    const t = pilote(
      'claude',
      [
        {
          pendant: async (o) => {
            appel = await appeler(o, 'desktop_observe', {})
          },
          texte: 'Capture prise.'
        }
      ],
      async () => ({
        ok: true,
        data: { fenetres: 1 },
        attachments: [
          { kind: 'image', name: 'capture.png', mimeType: 'image/png', size: 3, content: 'AAAA' }
        ]
      })
    )
    await t.jouer()
    expect(appel.result?.content).toContainEqual({
      type: 'image',
      data: 'AAAA',
      mimeType: 'image/png'
    })
    expect(
      t.evenements.some(
        (e) =>
          e.kind === 'artifact' &&
          (e as { artifact?: { content?: string } }).artifact?.content === 'AAAA'
      )
    ).toBe(true)
  })

  /*
   * UN APPEL DIRECT NE S'AFFICHE QU'UNE FOIS. Mesure du 2026-10-10 dans l'instance cachee (tour
   * b96ff4a2) : le CLI diffusait « mcp__autowin__get_state » puis « … terminé - 0 s » en battements
   * d'outil, EN PLUS de la carte d'action — le meme appel lu deux fois dans le fil.
   */
  it('un appel direct ne double pas sa carte d une ligne d activite du CLI', async () => {
    const t = pilote('claude', [
      {
        statuts: ['mcp__autowin__get_state', 'mcp__autowin__get_state terminé - 0 s'],
        pendant: async (o) => {
          await appeler(o, 'get_state', {})
        },
        texte: 'Voici.'
      }
    ])
    await t.jouer()
    expect(t.statuts().some((s) => s.includes('mcp__autowin__'))).toBe(false)
    expect(
      t.evenements.filter(
        (e) => e.kind === 'command' && (e as { name?: string }).name === 'get_state'
      )
    ).toHaveLength(1)
  })

  it('jumeau : les lignes d activite des autres outils restent affichees', async () => {
    const t = pilote('claude', [
      { statuts: ['Read · src/a.ts', 'mcp__autre__outil'], texte: 'Voici.' }
    ])
    await t.jouer()
    expect(t.statuts()).toContain('Read · src/a.ts')
    expect(t.statuts()).toContain('mcp__autre__outil')
  })

  it('retour au texte : un modele sans canal natif ne recoit rien, le <cmd> reste seul', async () => {
    const t = pilote('codex', [
      { texte: 'je regarde <cmd>{"name":"get_state","args":{}}</cmd>' },
      { texte: 'Voici.' }
    ])
    await t.jouer()
    expect(t.vus[0]!.skillNodeTools).toBeUndefined()
    expect(t.appelsBus('get_state')).toBe(1)
    expect(t.statuts().some((s) => s.includes('retour au texte') && s.includes('codex'))).toBe(true)
  })

  it('retour au texte : un serveur qui ne demarre pas ne casse pas le tour', async () => {
    const t = pilote(
      'claude',
      [{ texte: 'je regarde <cmd>{"name":"get_state","args":{}}</cmd>' }, { texte: 'Voici.' }],
      undefined,
      {
        demarrer: async () => {
          throw new Error('port indisponible')
        }
      }
    )
    await t.jouer()
    expect(t.vus[0]!.skillNodeTools).toBeUndefined()
    expect(t.appelsBus('get_state')).toBe(1)
    expect(
      t.statuts().some((s) => s.includes('retour au texte') && s.includes('port indisponible'))
    ).toBe(true)
    expect(t.texteFinal()).toContain('Voici.')
  })

  it('surveillance : le tour en lecture seule automatique n ouvre aucun serveur', async () => {
    const t = pilote('claude', [{ texte: 'Rien à signaler.' }])
    await t.jouer({ surveillance: true })
    expect(t.vus[0]!.skillNodeTools).toBeUndefined()
    expect(t.statuts().some((s) => /outils directs/i.test(s))).toBe(false)
  })

  it('jumeau : un pilote sans l option garde le texte seul (fixtures et tests existants)', async () => {
    const t = pilote('claude', [{ texte: 'Voici.' }], undefined, false)
    await t.jouer()
    expect(t.vus[0]!.skillNodeTools).toBeUndefined()
  })

  it('fermeture : apres un envoi reussi, le port ne repond plus', async () => {
    const t = pilote('claude', [{ texte: 'Voici.' }])
    await t.jouer()
    await expect(
      rpc(t.vus[0]!.skillNodeTools!.mcpConfig, { jsonrpc: '2.0', id: 3, method: 'tools/list' })
    ).rejects.toThrow()
  })

  it('fermeture : apres un envoi en erreur, le port ne repond plus', async () => {
    const t = pilote('claude', [{ jette: new Error('panne du fournisseur') }, { texte: 'Voici.' }])
    await t.jouer().catch(() => undefined)
    await expect(
      rpc(t.vus[0]!.skillNodeTools!.mcpConfig, { jsonrpc: '2.0', id: 3, method: 'tools/list' })
    ).rejects.toThrow()
  })

  it('fermeture : apres un arret pendant l envoi, le port ne repond plus', async () => {
    const arret = new AbortController()
    const annulation = Object.assign(new Error('arrêt'), { name: 'AbortError' })
    const t = pilote('claude', [
      {
        pendant: async () => {
          arret.abort()
        },
        jette: annulation
      }
    ])
    await expect(t.jouer({ signal: arret.signal })).rejects.toThrow()
    await expect(
      rpc(t.vus[0]!.skillNodeTools!.mcpConfig, { jsonrpc: '2.0', id: 3, method: 'tools/list' })
    ).rejects.toThrow()
  })
})

describe('ouvrirOutilsNatifsDuChat — cas limites', () => {
  it('derive du catalogue : seules les commandes sans motif d exclusion sont servies', () => {
    expect(outilsDuChat(CATALOGUE)).toEqual(['get_state', 'remember', 'desktop_observe'])
  })

  it('cle d appel : stable a l ordre des cles pres, distincte pour d autres arguments', () => {
    expect(cleAppelNatif('remember', { a: 1, b: { y: 2, x: 1 } })).toBe(
      cleAppelNatif('remember', { b: { x: 1, y: 2 }, a: 1 })
    )
    expect(cleAppelNatif('remember', { a: 1 })).not.toBe(cleAppelNatif('remember', { a: 2 }))
  })

  it('absent : modele sans canal natif => repli nomme, aucun serveur', async () => {
    const demarrer = vi.fn()
    const r = await ouvrirOutilsNatifsDuChat({
      provider: 'gemini',
      catalogue: CATALOGUE,
      exec: vi.fn(),
      demarrer
    })
    expect('servis' in r).toBe(false)
    expect('repli' in r && r.repli).toContain('gemini')
    expect(demarrer).not.toHaveBeenCalled()
  })

  it('vide : aucune commande servable => repli nomme, aucun serveur', async () => {
    const demarrer = vi.fn()
    const r = await ouvrirOutilsNatifsDuChat({
      provider: 'claude',
      catalogue: CATALOGUE.filter((c) => c.horsCanalNatif),
      exec: vi.fn(),
      demarrer
    })
    expect('repli' in r).toBe(true)
    expect(demarrer).not.toHaveBeenCalled()
  })

  it('mal type : des arguments qui ne sont pas un objet sont refuses, rien n est execute', async () => {
    const exec = vi.fn(async () => ({ ok: true, data: 'x' }))
    const r = await ouvrirOutilsNatifsDuChat({ provider: 'claude', catalogue: CATALOGUE, exec })
    if (!('servis' in r)) throw new Error('serveur attendu')
    try {
      const reponse = await rpc(r.servis.options.mcpConfig, {
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_state', arguments: 'pas un objet' }
      })
      expect(reponse.result?.isError).toBe(true)
      expect(exec).not.toHaveBeenCalled()
    } finally {
      await r.servis.arreter()
    }
  })

  it(`hors bornes : au-dela de ${APPELS_NATIFS_MAX_PAR_ENVOI} appels par envoi, refus lisible sans execution`, async () => {
    const exec = vi.fn(async () => ({ ok: true, data: 'x' }))
    const r = await ouvrirOutilsNatifsDuChat({ provider: 'claude', catalogue: CATALOGUE, exec })
    if (!('servis' in r)) throw new Error('serveur attendu')
    try {
      let dernier: Rpc = {}
      for (let n = 0; n <= APPELS_NATIFS_MAX_PAR_ENVOI; n += 1) {
        dernier = await rpc(r.servis.options.mcpConfig, {
          jsonrpc: '2.0',
          id: n,
          method: 'tools/call',
          params: { name: 'get_state', arguments: {} }
        })
      }
      expect(exec).toHaveBeenCalledTimes(APPELS_NATIFS_MAX_PAR_ENVOI)
      expect(dernier.result?.isError).toBe(true)
      expect(texteDe(dernier)).toContain('plafond')
    } finally {
      await r.servis.arreter()
    }
  })

  it('borne : un resultat geant est tronque comme pour un <cmd>, un petit reste intact', async () => {
    const geant = 'g'.repeat(200_000)
    const petit = 'p'.repeat(1_000)
    const exec = vi.fn(async (nom: string) => ({
      ok: true,
      data: nom === 'get_state' ? geant : petit
    }))
    const r = await ouvrirOutilsNatifsDuChat({ provider: 'claude', catalogue: CATALOGUE, exec })
    if (!('servis' in r)) throw new Error('serveur attendu')
    try {
      const appel = async (nom: string): Promise<string> =>
        texteDe(
          await rpc(r.servis.options.mcpConfig, {
            jsonrpc: '2.0',
            id: 1,
            method: 'tools/call',
            params: { name: nom, arguments: {} }
          })
        )
      const tronque = await appel('get_state')
      expect(tronque.length).toBeLessThan(130_000)
      expect(tronque).toContain('RESULTAT TRONQUE')
      expect(await appel('remember')).toBe(petit)
    } finally {
      await r.servis.arreter()
    }
  })
})
