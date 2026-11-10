import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const flux = vi.hoisted(() => ({
  lignes: [] as Array<Record<string, unknown>>,
  lancements: [] as Array<{
    args: string[]
    cwd: string
    stdin: string
    env: Record<string, string | undefined>
  }>
}))

// Même harnais que codex.progression-live.test.ts : on rejoue une séquence JSONL arbitraire.
vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: (entree: {
    args: string[]
    cwd: string
    stdin: string
    env: Record<string, string | undefined>
  }) => {
    flux.lancements.push(entree)
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5353
    child.exitCode = null
    child.kill = () => true
    return {
      child,
      pid: child.pid,
      spawnToken: 'codex-chat',
      journalPath: 'C:\\journals\\codex-chat.jsonl',
      survivable: true,
      release: vi.fn(),
      tail: async (onLine: (line: string) => void) => {
        for (const ligne of flux.lignes) onLine(JSON.stringify(ligne))
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: flux.lignes.length, stopped: false }
      }
    }
  }
}))

import {
  CodexAdapter,
  CodexCliIntrouvable,
  codexExecSpec,
  codexLauncher,
  contratHorsRun,
  optionsMcpCodex
} from './codex'
import type { Message, SendOptions, SendResult } from './types'

/**
 * LE CHAT CHATGPT PASSE PAR LE CLI CONNECTÉ (2026-10-31).
 *
 * Défaut d'origine : le chat exigeait un jeton propre à Autowin, écrit par `npm run codex:login`,
 * script supprimé le 2026-09-04. Le CLI répondait « Logged in using ChatGPT » et le chat mourait
 * sur « non authentifié ». Le vrai parcours a été joué sur le vrai CLI avant ces tests ; ils gardent
 * ce qu'il a établi, chaque cas venant d'un échec mesuré.
 */
const finDeTour = [
  { type: 'thread.started', thread_id: 'fil-du-cli' },
  { type: 'item.completed', item: { type: 'agent_message', text: 'pong' } }
]
const precedentBin = process.env.CODEX_BIN
const precedentHome = process.env.CODEX_HOME

/*
 * Un tour Codex relit `$CODEX_HOME/hooks.json` avant de partir (`verifierControlesCodex`). Sans
 * dossier à lui, ce fichier lirait celui du poste, et ses avertissements varieraient d'une machine
 * à l'autre : ici, la garde npm de l'app est installée, comme sur un poste prêt.
 * fix-ok: « relaie les messages intermédiaires » rouge mesuré (2 entrées au lieu d'1) : le tour lisait le vrai ~/.codex/hooks.json, sans garde npm, et son avertissement s'ajoutait au fil.
 */
beforeEach(() => {
  process.env.CODEX_HOME = mkdtempSync(join(tmpdir(), 'codex-home-'))
  const garde = resolve(__dirname, '..', '..', '..', 'scripts', 'garde-npm-modules.mjs')
  writeFileSync(
    join(process.env.CODEX_HOME, 'hooks.json'),
    JSON.stringify({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: `node "${garde}"` }] }]
      }
    })
  )
})

afterEach(() => {
  flux.lignes = []
  flux.lancements = []
  if (precedentBin === undefined) delete process.env.CODEX_BIN
  else process.env.CODEX_BIN = precedentBin
  if (process.env.CODEX_HOME) rmSync(process.env.CODEX_HOME, { recursive: true, force: true })
  if (precedentHome === undefined) delete process.env.CODEX_HOME
  else process.env.CODEX_HOME = precedentHome
})

async function tour(
  opts: SendOptions,
  messages: Message[] = [{ role: 'user', content: 'ping' }]
): Promise<{ resultat: SendResult; reflexion: string[]; textes: string[]; fetchFn: unknown }> {
  process.env.CODEX_BIN = 'codex-test'
  flux.lignes = flux.lignes.length > 0 ? flux.lignes : finDeTour
  const fetchFn = vi.fn()
  const adapter = new CodexAdapter({
    fetchFn: fetchFn as unknown as typeof fetch,
    loadTokensFn: () => null
  })
  const stream = adapter.send(messages, opts)
  const reflexion: string[] = []
  const textes: string[] = []
  for (;;) {
    const pas = await stream.next()
    if (pas.done) return { resultat: pas.value, reflexion, textes, fetchFn }
    if (pas.value.reasoning) reflexion.push(pas.value.reasoning)
    if (pas.value.delta) textes.push(pas.value.delta)
  }
}

describe('un tour de chat sans jeton Autowin', () => {
  it('part par le CLI, dans le dossier du fil, sans aucun appel HTTP', async () => {
    const { resultat, fetchFn } = await tour({ conversationId: 'conv-9', workspaceCwd: 'D:\\projet' })

    expect(fetchFn).not.toHaveBeenCalled()
    expect(resultat.text).toBe('pong')
    expect(flux.lancements[0]?.cwd).toBe('D:\\projet')
    expect(flux.lancements[0]?.args).toContain('danger-full-access')
    expect(flux.lancements[0]?.env.AUTOWIN_CONVERSATION_ID).toBe('conv-9')
  })

  it('ne rend pas la session du CLI : `--ephemeral` l’a déjà oubliée', async () => {
    // Sinon le pilote croirait l'historique côté CLI, et le tour suivant partirait sans lui.
    const { resultat } = await tour({ conversationId: 'conv-9' })
    expect(resultat.sessionId).toBeUndefined()
  })

  it('relaie les messages intermédiaires, et rend le dernier une seule fois', async () => {
    flux.lignes = [
      { type: 'item.completed', item: { type: 'agent_message', text: 'je lis le fichier' } },
      { type: 'item.completed', item: { type: 'agent_message', text: 'fini' } }
    ]
    const { reflexion, textes } = await tour({ conversationId: 'conv-9' })
    expect(reflexion).toEqual(['je lis le fichier'])
    expect(textes).toEqual(['fini'])
  })

  it('joint les images par `--image`, sans avaler le `-` final, et liste les autres pièces', async () => {
    const { resultat } = await tour({ conversationId: 'conv-9' }, [
      {
        role: 'user',
        content: 'regarde',
        attachments: [
          { kind: 'image', name: 'capture.png', mimeType: 'image/png', size: 2, content: 'aGk=' },
          { kind: 'text', name: 'notes.txt', mimeType: 'text/plain', size: 7, content: 'bonjour' }
        ]
      }
    ])

    expect(resultat.text).toBe('pong')
    const { args, stdin } = flux.lancements[0]!
    const image = args.indexOf('--image')
    expect(args[image + 1]).toMatch(/capture\.png$/)
    expect(args.filter((a) => a === '--image')).toHaveLength(1)
    expect(args.at(-1)).toBe('-')
    expect(stdin).toContain('notes.txt')
    expect(stdin).not.toContain('Utilise Read')
  })
})

describe('le contrat d’un appel sans run', () => {
  it('un tour de chat a les droits d’une phase qui modifie du code', () => {
    // Sous Windows, `workspace-write` refuse toute commande (mesuré le 2026-10-31).
    expect(contratHorsRun({ conversationId: 'conv-1' }).sandbox).toBe('danger-full-access')
  })

  it('un appel sans fil (bouton « Tester ») reste en lecture seule', () => {
    expect(contratHorsRun({}).sandbox).toBe('read-only')
  })

  it('un tour de surveillance reste en lecture seule, même sur un fil', () => {
    expect(
      contratHorsRun({ conversationId: 'conv-1', toolProfile: 'watchdog-read-only' }).sandbox
    ).toBe('read-only')
  })
})

describe('l’isolation de `codex exec`', () => {
  const spec = (): ReturnType<typeof codexExecSpec> => {
    process.env.CODEX_BIN = 'codex-test'
    return codexExecSpec('C:\\repo', 'gpt-6-luna', 'read-only')
  }

  it('ignore la configuration du poste : ni plugins, ni pilotage de l’écran', () => {
    // Mesuré le 2026-10-31 : sans cette option, `gpt-6-luna` a ouvert le Computer Use du poste.
    expect(spec().args).toContain('--ignore-user-config')
  })

  it('garde le bac à sable Windows que cette configuration portait', () => {
    // Sans lui, même une lecture est refusée.
    expect(spec().args).toContain('windows.sandbox="unelevated"')
  })

  it('accepte un dossier hors git', () => {
    expect(spec().args).toContain('--skip-git-repo-check')
  })
})

describe('les outils Autowin sur le canal du CLI', () => {
  const outils = {
    mcpConfig: JSON.stringify({
      mcpServers: {
        autowin: {
          type: 'http',
          url: 'http://127.0.0.1:4321/mcp',
          headers: { 'X-Autowin-Token': 'jeton-tres-secret' }
        }
      }
    }),
    allowedTools: ['mcp__autowin__get_state']
  }

  it('déclare le serveur et autorise ses outils sans accord interactif', () => {
    const { config } = optionsMcpCodex(outils)
    expect(config).toContain('mcp_servers.autowin.url="http://127.0.0.1:4321/mcp"')
    expect(config).toContain('mcp_servers.autowin.default_tools_approval_mode="approve"')
  })

  it('le jeton ne passe JAMAIS sur la ligne de commande', () => {
    const { config, env } = optionsMcpCodex(outils)
    expect(config.join(' ')).not.toContain('jeton-tres-secret')
    expect(config).toContain(
      'mcp_servers.autowin.env_http_headers={"X-Autowin-Token"="AUTOWIN_MCP_AUTOWIN_0"}'
    )
    expect(env).toEqual({ AUTOWIN_MCP_AUTOWIN_0: 'jeton-tres-secret' })
  })

  it('un tour outillé pose la configuration et le jeton sur le processus', async () => {
    await tour({ conversationId: 'conv-9', skillNodeTools: outils })
    const { args, env } = flux.lancements[0]!
    expect(args).toContain('mcp_servers.autowin.url="http://127.0.0.1:4321/mcp"')
    expect(args.join(' ')).not.toContain('jeton-tres-secret')
    expect(env.AUTOWIN_MCP_AUTOWIN_0).toBe('jeton-tres-secret')
  })
})

describe('un CLI dans un dossier trop long pour Windows', () => {
  const vider = (): void => {
    delete process.env.CODEX_BIN
  }

  it('refuse le poste en donnant la commande, plutôt qu’un agent sans outils', () => {
    // Mesuré le 2026-10-31 : le compagnon à 264 caractères rend ENOENT, le même à 67 démarre.
    vider()
    const long = `D:\\${'x'.repeat(200)}`
    let erreur: unknown
    try {
      codexLauncher(long, () => true, 'win32', 'x64')
    } catch (e) {
      erreur = e
    }
    expect(erreur).toBeInstanceOf(CodexCliIntrouvable)
    expect(String(erreur)).toContain('npm i -g --prefix')
  })

  it('accepte un dossier court', () => {
    vider()
    expect(codexLauncher('D:\\npm-court', () => true, 'win32', 'x64').executable).toMatch(
      /codex\.exe$/
    )
  })
})

describe('un APPDATA redirigé (instance cachée) ne cache pas le CLI du profil', () => {
  // Longueurs MESURÉES sur un poste réel : le CLI du PATH (Node de winget) a un compagnon à 264 caractères,
  // celui installé sous le profil en fait 157. L'instance cachée ne redirige que APPDATA.
  // Nom de session neutre, de la même longueur (14 caractères) que celui du poste mesuré : le calcul en dépend.
  const profil = 'C:\\Users\\utilisateur.un'
  const prefixeWinget = join(
    profil,
    'AppData',
    'Local',
    'Microsoft',
    'WinGet',
    'Packages',
    'OpenJS.NodeJS.LTS_Microsoft.Winget.Source_8wekyb3d8bbwe',
    'node-v24.19.0-win-x64'
  )
  const prefixeProfil = join(profil, 'AppData', 'Roaming', 'npm')
  const entree = (prefixe: string): string =>
    join(prefixe, 'node_modules', '@openai', 'codex', 'bin', 'codex.js')
  const natif = (prefixe: string): string =>
    join(
      prefixe,
      'node_modules',
      '@openai',
      'codex',
      'node_modules',
      '@openai',
      'codex-win32-x64',
      'vendor',
      'x86_64-pc-windows-msvc',
      'bin',
      'codex.exe'
    )

  it('prend le CLI du profil avant celui du PATH, dont le compagnon est trop long', () => {
    delete process.env.CODEX_BIN
    const presents = new Set([
      entree(prefixeWinget),
      natif(prefixeWinget),
      entree(prefixeProfil),
      natif(prefixeProfil)
    ])
    const precedents = { PATH: process.env.PATH, USERPROFILE: process.env.USERPROFILE }
    process.env.PATH = prefixeWinget
    process.env.USERPROFILE = profil
    try {
      const lanceur = codexLauncher(
        join(profil, 'AppData', 'Local', 'autowin-hdesk', 'instance', 'appdata'),
        (chemin) => presents.has(chemin),
        'win32',
        'x64'
      )
      expect(lanceur.executable).toBe(natif(prefixeProfil))
    } finally {
      if (precedents.PATH === undefined) delete process.env.PATH
      else process.env.PATH = precedents.PATH
      if (precedents.USERPROFILE === undefined) delete process.env.USERPROFILE
      else process.env.USERPROFILE = precedents.USERPROFILE
    }
  })
})
