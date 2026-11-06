import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Les lancements de `codex exec`, rejoués sans processus : on lit les arguments remis au CLI.
const lancements = vi.hoisted(() => [] as Array<{ args: string[] }>)
vi.mock('../runs/survivable-spawn', () => ({
  spawnSurvivable: (entree: { args: string[] }) => {
    lancements.push(entree)
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 4242
    child.exitCode = null
    child.kill = () => true
    return {
      child,
      pid: child.pid,
      release: () => undefined,
      tail: async (onLine: (line: string) => void) => {
        // Le vrai CLI annonce l'option par DEUX éléments « error » avant le tour (sortie lue le
        // 2026-11-06, Codex 0.166.0) : le faux les rejoue pour qu'un tour normal soit fidèle.
        if (entree.args.includes('--dangerously-bypass-hook-trust')) {
          for (const id of ['item_0', 'item_1']) {
            onLine(
              JSON.stringify({
                type: 'item.completed',
                item: {
                  id,
                  type: 'error',
                  message:
                    '`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.'
                }
              })
            )
          }
        }
        onLine(
          JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'pong' } })
        )
        queueMicrotask(() => {
          child.exitCode = 0
          child.emit('close', 0)
        })
        return { offset: 1, stopped: false }
      }
    }
  }
}))

import {
  CodexAdapter,
  CodexStructuralFailure,
  codexExecSpec,
  codexApiEffort,
  codexExecutionEvidenceFromItem,
  codexStructuralFailure,
  structuredEvidenceFields
} from './codex'
import { startDeviceLogin, pollForToken, refreshTokens, CODEX_CLIENT_ID } from './codex-auth'
import { FICHIER_CONTROLES_DE_CONFIANCE } from './hooks-des-cli'
import { autowinAppDataRoot, configureAutowinAppDataBase } from '../app/app-data'
import type { Message } from './types'

describe('codexApiEffort — clamp au set Responses réel (live 2026-07-24)', () => {
  it('valides passés tels quels : low/medium/high/xhigh/max', () => {
    for (const e of ['low', 'medium', 'high', 'xhigh', 'max']) expect(codexApiEffort(e)).toBe(e)
  })
  it('les deux 400 sont remappés : minimal→low, ultra→max', () => {
    expect(codexApiEffort('minimal')).toBe('low')
    expect(codexApiEffort('ultra')).toBe('max')
  })
  it('none/absent → undefined (on omet reasoning)', () => {
    expect(codexApiEffort('none')).toBeUndefined()
    expect(codexApiEffort(undefined)).toBeUndefined()
    expect(codexApiEffort('')).toBeUndefined()
  })
  it('inconnu → high (valide par défaut)', () => {
    expect(codexApiEffort('wat')).toBe('high')
  })
})

/** Fabrique une Response-like minimale pour mocker fetch. */
function jsonRes(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body
  } as Response
}

/** Response SSE mockée pour l'inférence Codex. */
function sseRes(events: string[]): Response {
  const encoder = new TextEncoder()
  let i = 0
  return {
    ok: true,
    status: 200,
    body: {
      getReader() {
        return {
          read: async () => {
            if (i >= events.length) return { done: true, value: undefined }
            return { done: false, value: encoder.encode(events[i++]) }
          }
        }
      }
    }
  } as unknown as Response
}

const conv: Message[] = [{ role: 'user', content: 'salut' }]

describe('CodexAdapter — classification des pannes structurelles', () => {
  it.each([
    ['cache JSON: trailing characters at column 8', 'json-trailing-characters'],
    [
      'schema invalide: supports_reasoning_summaries absent',
      'missing-supports-reasoning-summaries'
    ]
  ])('marque %s sans perdre la cause', (cause, signature) => {
    const error = codexStructuralFailure(new Error(cause))
    expect(error).toBeInstanceOf(CodexStructuralFailure)
    expect(error).toMatchObject({ provider: 'codex', signature, causeText: cause })
  })

  it('ne marque pas une panne transitoire sans signature connue', () => {
    expect(codexStructuralFailure(new Error('timeout temporaire'))).not.toBeInstanceOf(
      CodexStructuralFailure
    )
  })
})

describe('codex-auth — device-code flow (mocké, hors-ligne)', () => {
  it('startDeviceLogin poste le client_id et rend user_code + interval', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      void url
      void init
      return jsonRes(200, { user_code: 'WXYZ-1234', device_auth_id: 'dev1', interval: 5 })
    })
    const login = await startDeviceLogin(fetchFn as unknown as typeof fetch)
    expect(login.userCode).toBe('WXYZ-1234')
    expect(login.intervalMs).toBe(5000)
    const sent = JSON.parse((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.client_id).toBe(CODEX_CLIENT_ID)
  })

  it('pollForToken attend (403) puis échange le code (200) contre des tokens', async () => {
    const calls: number[] = []
    const fetchFn = vi.fn(async (url: string) => {
      if (url.includes('deviceauth/token')) {
        calls.push(1)
        if (calls.length < 3) return jsonRes(403, {})
        return jsonRes(200, { authorization_code: 'AC', code_verifier: 'VER' })
      }
      // oauth/token exchange
      return jsonRes(200, { access_token: 'AT', refresh_token: 'RT', expires_in: 3600 })
    })
    const tok = await pollForToken(
      { userCode: 'X', deviceAuthId: 'dev1', intervalMs: 1 },
      { fetchFn: fetchFn as unknown as typeof fetch, sleep: async () => {}, maxAttempts: 10 }
    )
    expect(tok.accessToken).toBe('AT')
    expect(tok.refreshToken).toBe('RT')
    expect(calls.length).toBe(3) // 2×403 puis 200
  })

  it('refreshTokens échange le refresh_token', async () => {
    const fetchFn = vi.fn(async (url: string, init?: RequestInit) => {
      void url
      void init
      return jsonRes(200, { access_token: 'AT2', refresh_token: 'RT2', expires_in: 3600 })
    })
    const t = await refreshTokens(
      { accessToken: 'old', refreshToken: 'RT', obtainedAt: 0 },
      fetchFn as unknown as typeof fetch
    )
    expect(t.accessToken).toBe('AT2')
    // corps form-urlencoded (contrat live oauth/token), pas JSON
    const sent = new URLSearchParams((fetchFn.mock.calls[0][1] as RequestInit).body as string)
    expect(sent.get('grant_type')).toBe('refresh_token')
    expect(sent.get('refresh_token')).toBe('RT')
  })
})

describe('CodexAdapter — inférence + injection (mocké, hors-ligne)', () => {
  const tokens = {
    accessToken: 'AT',
    refreshToken: 'RT',
    obtainedAt: Date.now(),
    expiresInSec: 3600
  }

  it('streame les deltas SSE et assemble le texte final', async () => {
    const fetchFn = vi.fn(async () =>
      sseRes([
        'data: {"type":"response.output_text.delta","delta":"SA"}\n',
        'data: {"type":"response.output_text.delta","delta":"LUT"}\n',
        'data: {"type":"response.completed","response":{"id":"resp_1"}}\n'
      ])
    )
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const chunks: string[] = []
    const gen = adapter.send(conv, { system: 'SOUL' })
    let step = await gen.next()
    while (!step.done) {
      chunks.push(step.value.delta)
      step = await gen.next()
    }
    expect(chunks.join('')).toBe('SALUT')
    expect(step.value.text).toBe('SALUT')
    expect(step.value.provider).toBe('codex')
    // `response.id` is not resumable until the adapter sends it back as `previous_response_id`.
    // Advertising it as a session would make AgentPilot drop the history on the next turn.
    expect(step.value.sessionId).toBeUndefined()
    expect(step.value.systemInjected).toBe(true)
  })

  it('normalise une image générée du flux Responses en artefact', async () => {
    const fetchFn = vi.fn(async () =>
      sseRes([
        'data: {"type":"response.output_item.done","item":{"id":"img_1","type":"image_generation_call","result":"YWJj"}}\n',
        'data: {"type":"response.completed","response":{"id":"resp_image"}}\n'
      ])
    )
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, { model: 'gpt-image-test' })
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toEqual([
      expect.objectContaining({
        id: 'img_1',
        kind: 'image',
        mimeType: 'image/png',
        content: 'YWJj',
        source: { provider: 'codex', model: 'gpt-image-test' }
      })
    ])
  })

  it('normalise un output_file complet du flux Responses en artefact', async () => {
    const fetchFn = vi.fn(async () =>
      sseRes([
        'data: {"type":"response.output_item.done","item":{"id":"file_1","type":"message","content":[{"type":"output_file","filename":"rapport.md","mime_type":"text/markdown","file_data":"data:text/markdown;base64,IyBSYXBwb3J0"}]}}\n',
        'data: {"type":"response.completed","response":{"id":"resp_file"}}\n'
      ])
    )
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, { model: 'gpt-file-test' })
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    expect(step.value.artifacts).toEqual([
      expect.objectContaining({
        name: 'rapport.md',
        kind: 'markdown',
        mimeType: 'text/markdown',
        content: 'IyBSYXBwb3J0',
        source: { provider: 'codex', model: 'gpt-file-test' }
      })
    ])
  })

  it('INJECTE le système dans le champ natif `instructions` (preuve)', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, { system: 'REGLE SOUL INJECTEE' })
    let s = await gen.next()
    while (!s.done) s = await gen.next()
    expect(captured.instructions).toBe('REGLE SOUL INJECTEE') // champ natif, pas un message system
    expect((captured.input as unknown[]).length).toBe(1) // le user seul (role=system filtré)
  })

  it('transmet le modèle et l’effort choisis dans Agents', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv, {
      model: 'gpt-5.6-terra',
      reasoningEffort: 'high'
    })
    let step = await gen.next()
    while (!step.done) step = await gen.next()
    expect(captured.model).toBe('gpt-5.6-terra')
    expect(captured.reasoning).toEqual({ effort: 'high' })
  })

  it('sérialise réellement le texte, les images et les fichiers joints', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const messages: Message[] = [
      {
        role: 'user',
        content: 'Analyse ces fichiers',
        attachments: [
          {
            name: 'notes.md',
            mimeType: 'text/markdown',
            size: 7,
            kind: 'text',
            content: '# Notes'
          },
          {
            name: 'capture.png',
            mimeType: 'image/png',
            size: 3,
            kind: 'image',
            content: 'YWJj'
          },
          {
            name: 'document.pdf',
            mimeType: 'application/pdf',
            size: 3,
            kind: 'file',
            content: 'ZGVm'
          }
        ]
      }
    ]

    let observed: unknown
    const gen = adapter.send(messages, {
      observePrompt: (prompt) => {
        observed = prompt
      }
    })
    let step = await gen.next()
    while (!step.done) step = await gen.next()

    const input = captured.input as Array<{ content: Array<Record<string, string>> }>
    expect(input[0].content).toEqual([
      { type: 'input_text', text: 'Analyse ces fichiers' },
      { type: 'input_text', text: '<fichier nom="notes.md">\n# Notes\n</fichier>' },
      { type: 'input_image', image_url: 'data:image/png;base64,YWJj' },
      {
        type: 'input_file',
        filename: 'document.pdf',
        file_data: 'data:application/pdf;base64,ZGVm'
      }
    ])
    expect((observed as { options: { body: unknown } }).options.body).toEqual(captured)
  })

  it('sans système → instructions absent (contrôle négatif)', async () => {
    let captured: Record<string, unknown> = {}
    const fetchFn = vi.fn(async (_url: string, init: RequestInit) => {
      captured = JSON.parse(init.body as string)
      return sseRes(['data: {"type":"response.completed","response":{"id":"r"}}\n'])
    })
    const adapter = new CodexAdapter({
      fetchFn: fetchFn as unknown as typeof fetch,
      loadTokensFn: () => tokens
    })
    const gen = adapter.send(conv)
    let s = await gen.next()
    while (!s.done) s = await gen.next()
    expect(captured.instructions).toBeUndefined()
  })

  it('auth() suit le jeton Autowin, sinon la session du CLI', async () => {
    const fetchFn = (async () => jsonRes(200, {})) as unknown as typeof fetch
    const sansRien = new CodexAdapter({
      fetchFn,
      loadTokensFn: () => null,
      cliConnecteFn: async () => false
    })
    expect(await sansRien.auth()).toBe(false)
    const parLeCli = new CodexAdapter({
      fetchFn,
      loadTokensFn: () => null,
      cliConnecteFn: async () => true
    })
    expect(await parLeCli.auth()).toBe(true)
  })
})

describe('CodexAdapter — exécution agentique locale', () => {
  it('borne codex exec au workspace-write et au cwd demandé', () => {
    const spec = codexExecSpec(
      'C:\\repo',
      'gpt-5.6-sol',
      'workspace-write',
      'high',
      'C:\\AppData',
      () => true
    )
    expect(spec.cwd).toBe('C:\\repo')
    expect(spec.args).toContain('workspace-write')
    expect(spec.args).toContain('C:\\repo')
    expect(spec.args).toContain('gpt-5.6-sol')
    expect(spec.args).not.toContain('danger-full-access')
    expect(spec.args).not.toContain('--dangerously-bypass-approvals-and-sandbox')
  })

  it('supprime l’auto-load AGENTS.md par défaut (souveraineté contexte), désactivable', () => {
    const on = codexExecSpec('C:\\repo', 'm', 'read-only', undefined, 'C:\\AppData', () => true)
    expect(on.args).toContain('project_doc_max_bytes=0')
    const off = codexExecSpec(
      'C:\\repo',
      'm',
      'read-only',
      undefined,
      'C:\\AppData',
      () => true,
      false
    )
    expect(off.args).not.toContain('project_doc_max_bytes=0')
  })

  it('échoue explicitement quand le CLI local est absent', () => {
    expect(() =>
      codexExecSpec('C:\\repo', 'gpt-5.6-sol', 'workspace-write', 'low', 'C:\\Missing', () => false)
    ).toThrow(/Codex CLI introuvable/)
  })
})

describe('CodexAdapter — attribution des fichiers', () => {
  it('normalise les chemins absolus du worktree avant attribution', () => {
    expect(
      structuredEvidenceFields(
        {
          type: 'file_change',
          changes: {
            'C:\\repo\\.claude\\worktrees\\run-1\\src\\feature.ts': { type: 'update' }
          }
        },
        'C:\\repo\\.claude\\worktrees\\run-1'
      ).paths
    ).toEqual(['src/feature.ts'])
  })
})

describe('codexExecSpec — recherche web vive', () => {
  /*
   * La consigne injectee dans CHAQUE phase promet WebSearch/WebFetch « sur toutes les branches ».
   * Sans cette cle, une branche Codex devinait la ou une branche Claude lisait. `--search` est
   * REFUSE par `codex exec` (mesure du 2026-09-09, codex-cli 0.151.0) : seule la cle passe.
   */
  it('active tools.web_search par cle de configuration, jamais par --search', () => {
    const args = codexExecSpec('C:\\repo', 'gpt-5.6-sol', 'workspace-write', 'low', 'C:\\AppData', () => true).args
    const i = args.indexOf('tools.web_search=true')
    expect(i).toBeGreaterThan(0)
    expect(args[i - 1]).toBe('-c')
    expect(args).not.toContain('--search')
  })
})

/*
 * LA GARDE NPM DE CODEX. Codex lit `$CODEX_HOME/hooks.json` malgré `--ignore-user-config`, mais pas
 * la validation des contrôles, rangée dans `config.toml` : sans `--dangerously-bypass-hook-trust`,
 * la garde ne tourne pas (mesuré le 2026-11-06, Codex 0.166.0). L'option fait tourner TOUS les
 * contrôles activés sans relecture : l'app ne la passe qu'après avoir vérifié qu'il n'y a que les siens.
 */
describe('Codex — la relecture des contrôles levée seulement pour des contrôles connus', () => {
  const GARDE = resolve(__dirname, '..', '..', '..', 'scripts', 'garde-npm-modules.mjs')
  // fix-ok: le nom de l'entreprise était recopié dans la commande du contrôle tiers ; rouge mesuré : separation-entreprise.test.ts listait ce fichier. Nom fictif désormais, la confiance vient de la liste du poste.
  const COMMANDE_DU_POSTE =
    'powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "C:\\Outils\\CerveauFictif\\cerveau-fictif-hook.ps1"'
  const DU_POSTE = {
    matcher: '',
    hooks: [{ type: 'command', command: COMMANDE_DU_POSTE, timeout: 15 }]
  }
  const GARDE_NPM = {
    matcher: 'Bash',
    hooks: [{ type: 'command', command: `node "${GARDE}"`, timeout: 10 }]
  }
  const avant = { home: process.env.CODEX_HOME, bin: process.env.CODEX_BIN }
  let dossier: string

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'codex-controles-'))
    mkdirSync(join(dossier, 'depot', '.git'), { recursive: true })
    // Le chemin du fichier des contrôles vient de CODEX_HOME, comme pour Codex : jamais le vrai.
    process.env.CODEX_HOME = join(dossier, 'maison')
    process.env.CODEX_BIN = 'codex-test'
    mkdirSync(process.env.CODEX_HOME)
    // La liste de confiance du poste vit dans le dossier de données de l'app : celui du test.
    configureAutowinAppDataBase(join(dossier, 'donnees'))
    mkdirSync(autowinAppDataRoot(), { recursive: true })
    lancements.length = 0
  })
  afterEach(() => {
    for (const [cle, valeur] of [
      ['CODEX_HOME', avant.home],
      ['CODEX_BIN', avant.bin]
    ] as const) {
      if (valeur === undefined) delete process.env[cle]
      else process.env[cle] = valeur
    }
    configureAutowinAppDataBase(undefined)
    rmSync(dossier, { recursive: true, force: true })
  })

  const controles = (hooks: Record<string, unknown>): void =>
    writeFileSync(join(process.env.CODEX_HOME!, 'hooks.json'), JSON.stringify({ hooks }))
  const listeDuPoste = (commandes: string[] = [COMMANDE_DU_POSTE]): void =>
    writeFileSync(
      join(autowinAppDataRoot(), FICHIER_CONTROLES_DE_CONFIANCE),
      JSON.stringify({
        controles: commandes.map((command) => ({ evenement: 'UserPromptSubmit', command }))
      })
    )

  async function tourDeChat(): Promise<{
    args: string[]
    fil: string[]
    preuves: Array<{ type: string }>
  }> {
    const adapter = new CodexAdapter({ loadTokensFn: () => null })
    const flux = adapter.send([{ role: 'user', content: 'ping' }], {
      conversationId: 'conv-1',
      workspaceCwd: join(dossier, 'depot')
    })
    const fil: string[] = []
    let pas = await flux.next()
    for (; !pas.done; pas = await flux.next()) {
      if (pas.value.reasoning) fil.push(pas.value.reasoning)
    }
    return {
      args: lancements.at(-1)!.args,
      fil,
      preuves: (pas.value.executionEvidence ?? []) as Array<{ type: string }>
    }
  }

  it('le contrôle listé par le poste et la garde npm seuls : Codex part avec l’option, et --ignore-user-config reste', async () => {
    listeDuPoste()
    controles({ UserPromptSubmit: [DU_POSTE], PreToolUse: [GARDE_NPM] })
    const { args, fil } = await tourDeChat()
    expect(args).toContain('--dangerously-bypass-hook-trust')
    expect(args).toContain('--ignore-user-config')
    expect(fil.join('\n')).not.toMatch(/Garde npm/)
  })

  it('un contrôle absent de la liste du poste : option absente, et le contrôle est nommé au fil', async () => {
    // Sans liste, puis avec une liste qui en nomme un autre : jamais de confiance par défaut.
    for (const liste of [undefined, ['powershell.exe -File "C:\\Outils\\autre-hook.ps1"']]) {
      if (liste) listeDuPoste(liste)
      controles({ UserPromptSubmit: [DU_POSTE], PreToolUse: [GARDE_NPM] })
      const { args, fil } = await tourDeChat()
      expect(args).not.toContain('--dangerously-bypass-hook-trust')
      expect(args).toContain('--ignore-user-config')
      expect(fil.join('\n')).toContain(`UserPromptSubmit : ${COMMANDE_DU_POSTE}`)
    }
  })

  it('l’avis que Codex émet pour l’option n’apparaît ni comme « error — terminé » ni comme preuve', async () => {
    listeDuPoste()
    controles({ UserPromptSubmit: [DU_POSTE], PreToolUse: [GARDE_NPM] })
    const { args, fil, preuves } = await tourDeChat()
    expect(args).toContain('--dangerously-bypass-hook-trust')
    expect(fil.join('\n')).not.toMatch(/error — terminé/)
    expect(fil).toEqual([])
    expect(preuves.filter((preuve) => preuve.type === 'error')).toEqual([])
  })

  it('jumeau : un autre élément « error » reste une preuve, la reprise après plantage comprise', () => {
    const avis = {
      type: 'error',
      message:
        '`--dangerously-bypass-hook-trust` is enabled. Enabled hooks may run without review for this invocation.'
    }
    expect(codexExecutionEvidenceFromItem(avis)).toEqual([])
    const autre = { type: 'error', message: 'stream disconnected before completion' }
    expect(codexExecutionEvidenceFromItem(autre)).toHaveLength(1)
  })

  it('un contrôle inconnu : option absente, et l’avertissement remonte dans le fil', async () => {
    listeDuPoste()
    controles({
      UserPromptSubmit: [DU_POSTE],
      PreToolUse: [GARDE_NPM, { hooks: [{ type: 'command', command: 'node C:\\inconnu.mjs' }] }]
    })
    const { args, fil } = await tourDeChat()
    expect(args).not.toContain('--dangerously-bypass-hook-trust')
    expect(args).toContain('--ignore-user-config')
    expect(fil.join('\n')).toMatch(/Garde npm inactive.*node C:\\inconnu\.mjs/)
  })

  it('un appel en lecture seule (« Tester ») n’a rien à protéger : ni option, ni avertissement', async () => {
    controles({ PreToolUse: [GARDE_NPM] })
    const adapter = new CodexAdapter({ loadTokensFn: () => null })
    const flux = adapter.send([{ role: 'user', content: 'ping' }], {
      workspaceCwd: join(dossier, 'depot')
    })
    const fil: string[] = []
    for (let pas = await flux.next(); !pas.done; pas = await flux.next()) {
      if (pas.value.reasoning) fil.push(pas.value.reasoning)
    }
    expect(lancements.at(-1)!.args).toContain('read-only')
    expect(lancements.at(-1)!.args).not.toContain('--dangerously-bypass-hook-trust')
    expect(fil).toEqual([])
  })
})
