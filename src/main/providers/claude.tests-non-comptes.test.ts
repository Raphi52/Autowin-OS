import { describe, expect, it } from 'vitest'
import { spawn } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resoudreBash } from '../chat/relance-taches-de-fond'
import { avecAvertissementDesTests, findClaudeExecutable, reglagesCliAutowin } from './claude'
import { scriptHookTestsNonComptes } from './tests-du-terminal'

/**
 * TESTS NON COMPTÉS : L'AGENT EST PRÉVENU À CÔTÉ DU RÉSULTAT DE SA COMMANDE (conv-1221, 2026-10-28).
 *
 * Demande : « Claude est prévenu dès qu'un test qu'il lance ne comptera pas, pour qu'il le relance
 * proprement ». Le banc prouve la chaîne ENTIÈRE avec le VRAI CLI et les réglages de production
 * (`avecAvertissementDesTests(reglagesCliAutowin(…))`) : un faux serveur d'API local joue le modèle,
 * demande une commande de test raccourcie par un tube, puis on lit la requête SUIVANTE du CLI — ce
 * que le modèle recevrait. Entrée qui ferait échouer un branchement faux : hook absent des réglages,
 * mauvais nom d'événement, `additionalContext` mal placé → l'avertissement n'arrive pas.
 * Aucun appel modèle réel, aucun réseau.
 */

const CLI = process.env.CLAUDE_BIN ?? findClaudeExecutable()

function messageSse(
  contenu: { type: 'text'; text: string } | { type: 'tool_use'; input: unknown }
): unknown[] {
  const bloc =
    contenu.type === 'text'
      ? [
          { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'text_delta', text: contenu.text }
          }
        ]
      : [
          {
            type: 'content_block_start',
            index: 0,
            content_block: { type: 'tool_use', id: 'toolu_banc', name: 'Bash', input: {} }
          },
          {
            type: 'content_block_delta',
            index: 0,
            delta: { type: 'input_json_delta', partial_json: JSON.stringify(contenu.input) }
          }
        ]
  return [
    {
      type: 'message_start',
      message: {
        id: 'msg_banc',
        type: 'message',
        role: 'assistant',
        model: 'claude-sonnet-4-5',
        content: [],
        stop_reason: null,
        usage: { input_tokens: 1, output_tokens: 1 }
      }
    },
    ...bloc,
    { type: 'content_block_stop', index: 0 },
    {
      type: 'message_delta',
      delta: {
        stop_reason: contenu.type === 'text' ? 'end_turn' : 'tool_use',
        stop_sequence: null
      },
      usage: { output_tokens: 1 }
    },
    { type: 'message_stop' }
  ]
}

/** Un tour du vrai CLI où le « modèle » lance `commande` ; rend la requête qui suit le résultat. */
async function requeteApresLaCommande(commande: string, avecHook: boolean): Promise<string> {
  // Préfixe d'un dossier de réglages d'agent : le nettoyeur de fin de suite l'épargne (voir
  // claude.garde-onfailure.test.ts).
  const dir = mkdtempSync(join(tmpdir(), 'autowin-os-settings-'))
  try {
    const garde = join(dir, 'garde.mjs')
    writeFileSync(garde, '', 'utf8')
    const hookTests = join(dir, 'tests-non-comptes.mjs')
    writeFileSync(hookTests, scriptHookTestsNonComptes(), 'utf8')
    const settings = join(dir, 'settings.json')
    writeFileSync(
      settings,
      JSON.stringify(
        avecAvertissementDesTests(reglagesCliAutowin(garde), avecHook ? hookTests : undefined)
      ),
      'utf8'
    )
    let apres = ''
    let requetes = 0
    const serveur = createServer((req: IncomingMessage, res: ServerResponse) => {
      let corps = ''
      req.on('data', (d) => (corps += d))
      req.on('end', () => {
        if (!req.url?.startsWith('/v1/messages') || req.url.includes('count_tokens')) {
          res.writeHead(404, { 'content-type': 'application/json' })
          res.end('{}')
          return
        }
        requetes++
        const vuLeResultat = corps.includes('"tool_result"')
        if (vuLeResultat) apres = corps
        const evenements =
          vuLeResultat || requetes > 4
            ? messageSse({ type: 'text', text: 'fin' })
            : messageSse({
                type: 'tool_use',
                input: { command: commande, description: 'test du banc' }
              })
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const e of evenements)
          res.write(`event: ${(e as { type: string }).type}\ndata: ${JSON.stringify(e)}\n\n`)
        res.end()
      })
    })
    await new Promise<void>((ok) => serveur.listen(0, '127.0.0.1', ok))
    const port = (serveur.address() as { port: number }).port
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ANTHROPIC_BASE_URL: `http://127.0.0.1:${port}`,
      ANTHROPIC_API_KEY: 'sk-ant-banc-local',
      CLAUDE_CONFIG_DIR: join(dir, 'config-cli'),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      DISABLE_AUTOUPDATER: '1',
      // Sans lui, mesuré le 2026-10-28 (CLI de ce poste, dossier de config neuf) : « Git Bash was not
      // found », le CLI n'offre que PowerShell et `--tools Bash` ne laisse AUCUN outil. Les agents du
      // chat, eux, ont bien `Bash` : 251 commandes Bash de test relevées dans leurs journaux.
      ...(process.platform === 'win32' ? { CLAUDE_CODE_GIT_BASH_PATH: resoudreBash() } : {})
    }
    delete env.CLAUDE_CODE_OAUTH_TOKEN
    delete env.ANTHROPIC_AUTH_TOKEN
    const sortie = await new Promise<string>((ok, ko) => {
      const p = spawn(
        CLI!,
        [
          '-p',
          'lance le test',
          '--output-format',
          'stream-json',
          '--verbose',
          '--setting-sources',
          '',
          '--settings',
          settings,
          '--permission-mode',
          'bypassPermissions',
          '--tools',
          'Bash',
          '--model',
          'claude-sonnet-4-5'
        ],
        { env, cwd: dir }
      )
      let out = ''
      p.stdout.on('data', (d) => (out += d))
      p.stderr.on('data', (d) => (out += d))
      p.stdin.end()
      const coupe = setTimeout(() => {
        p.kill()
        ko(new Error(`CLI pendu > 50 s :\n${out.slice(-2000)}`))
      }, 50_000)
      p.on('error', ko)
      p.on('close', () => {
        clearTimeout(coupe)
        ok(out)
      })
    })
    await new Promise<void>((ok) => serveur.close(() => ok()))
    if (!apres)
      throw new Error(
        `le CLI n'a jamais renvoyé le résultat de la commande :\n${sortie.slice(-2000)}`
      )
    // Le hook s'est-il bien chargé ? Sa trace d'erreur serait dans la sortie du CLI.
    expect(readFileSync(hookTests, 'utf8')).toContain('lecteur.avertissement')
    return apres
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

describe('avecAvertissementDesTests — branchement dans les réglages du lancement', () => {
  it('ajoute PostToolUse et PostToolUseFailure sur Bash, sans toucher aux gardes PreToolUse', () => {
    const base = reglagesCliAutowin('G.mjs')
    const r = avecAvertissementDesTests(base, 'C:\\tmp\\reglages\\tests-non-comptes.mjs') as {
      hooks: Record<string, { matcher: string; hooks: Record<string, unknown>[] }[]>
    }
    expect(r.hooks.PreToolUse).toEqual(
      (base as { hooks: { PreToolUse: unknown } }).hooks.PreToolUse
    )
    for (const evenement of ['PostToolUse', 'PostToolUseFailure']) {
      expect(r.hooks[evenement]).toEqual([
        {
          matcher: 'Bash',
          hooks: [{ type: 'command', command: 'node "C:/tmp/reglages/tests-non-comptes.mjs"' }]
        }
      ])
      // Jamais d'échec fermé : un avertissement en panne ne doit rien bloquer.
      expect(r.hooks[evenement][0].hooks[0]).not.toHaveProperty('onFailure')
    }
    expect(avecAvertissementDesTests(base, undefined)).toBe(base)
  })

  it('`send` ne pose le hook que pour un tour de chat (fil connu par `opts.conversationId`)', () => {
    const source = readFileSync(join(__dirname, 'claude.ts'), 'utf8')
    expect(source).toMatch(
      /if \(opts\.conversationId\?\.trim\(\)\) \{\s*hookTests = join\(settingsDir, 'tests-non-comptes\.mjs'\)/
    )
    expect(source).toMatch(
      /avecAvertissementDesTests\(\s*reglagesCliAutowin\(hookGarde, [^)]*\)\),\s*hookTests\s*\)/
    )
  })
})

describe.skipIf(!CLI)('vrai CLI — l’agent est prévenu qu’un test ne comptera pas', () => {
  it('ligne qui réussit (PostToolUse) : `vitest … | tail -1` → l’avertissement suit le résultat', async () => {
    const requete = await requeteApresLaCommande('vitest --version | tail -1', true)
    expect(requete).toContain('ne comptera PAS comme preuve sur le Board')
    expect(requete).toContain('`vitest --version`')
  }, 60_000)

  it('ligne en échec (PostToolUseFailure) : `vitest … | grep FAIL` sans résultat → averti aussi', async () => {
    const requete = await requeteApresLaCommande(
      'vitest --version 2>&1 | grep FAIL_INTROUVABLE',
      true
    )
    expect(requete).toContain('ne comptera PAS comme preuve sur le Board')
  }, 60_000)

  it('témoin : sans le hook (agent de run), aucun avertissement', async () => {
    const requete = await requeteApresLaCommande('vitest --version | tail -1', false)
    expect(requete).not.toContain('ne comptera PAS')
  }, 60_000)
})
