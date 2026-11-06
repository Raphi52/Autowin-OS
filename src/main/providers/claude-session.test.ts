import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { parseClaudeAuthStatus, probeClaudeSession } from './claude-session'

/**
 * Constaté le 2026-07-30 sur ce poste : le préflight affichait « ✓ CLI claude » alors que `claude`
 * était installé mais JAMAIS loggué. L'utilisateur envoyait son premier prompt et l'app répondait
 * « ⚠️ claude result error: Not logged in · Please run /login ». Le seul check claude ne sondait que
 * la PRÉSENCE du binaire (`hasBin`) — jamais la session, alors que Codex, lui, a bien ses deux
 * entrées (« CLI codex » ET « Session OAuth Codex »).
 *
 * Sonde retenue : `claude auth status`, qui rend du JSON (`{"loggedIn":false,"authMethod":"none",…}`)
 * et sort en 1 quand la session manque — mesuré sur ce poste.
 *
 * RÈGLE D'HONNÊTETÉ du parseur : on ne rend `authenticated` que sur un `loggedIn: true` EXPLICITE.
 * Toute sortie illisible, vide, ou d'un CLI qui a planté rend `unknown` — jamais un vert.
 */
describe('parseClaudeAuthStatus — la session claude, jamais supposée', () => {
  it('LE CAS REPRODUIT : loggedIn false + exit 1 → absent', () => {
    const out = '{\n  "loggedIn": false,\n  "authMethod": "none",\n  "apiProvider": "firstParty"\n}'
    expect(parseClaudeAuthStatus(out, 1)).toBe('absent')
  })

  it('loggedIn true → authenticated', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":true,"authMethod":"oauth"}', 0)).toBe('authenticated')
  })

  it('un exit 0 ne suffit PAS : sans loggedIn true, jamais authenticated', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}', 0)).toBe('absent')
    expect(parseClaudeAuthStatus('{"authMethod":"none"}', 0)).toBe('unknown')
  })

  it('sortie illisible ou vide → unknown, jamais un faux vert', () => {
    for (const bogus of ['', '   ', 'not json', '<html>502</html>', 'null', '[]', '42']) {
      expect(parseClaudeAuthStatus(bogus, 0)).toBe('unknown')
    }
  })

  it('CLI absent / tué (exit null) → unknown', () => {
    expect(parseClaudeAuthStatus('', null)).toBe('unknown')
  })

  it('loggedIn non booléen → unknown (on ne coerce pas une valeur douteuse)', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":"true"}', 0)).toBe('unknown')
    expect(parseClaudeAuthStatus('{"loggedIn":1}', 0)).toBe('unknown')
    expect(parseClaudeAuthStatus('{"loggedIn":null}', 0)).toBe('unknown')
  })

  it('tolère du bruit autour du JSON (warning de shim, ligne blanche)', () => {
    const noisy = 'npm notice une mise a jour existe\n{"loggedIn":true,"authMethod":"oauth"}\n'
    expect(parseClaudeAuthStatus(noisy, 0)).toBe('authenticated')
  })

  it('ne se fait pas berner par un objet imbriqué qui parle de loggedIn', () => {
    expect(parseClaudeAuthStatus('{"nested":{"loggedIn":true}}', 0)).toBe('unknown')
  })

  /**
   * FAUX ROUGE fermé : un découpage du premier `{` au dernier `}` englobait DEUX objets quand le CLI
   * intercale une ligne de service, `JSON.parse` refusait, et une session valide était rapportée
   * « indéterminée ». On lit désormais les objets équilibrés un par un.
   */
  it('un objet de service AVANT la réponse ne masque plus la session', () => {
    const out = '{"telemetry":true}\n{"loggedIn":true,"authMethod":"oauth"}\n'
    expect(parseClaudeAuthStatus(out, 0)).toBe('authenticated')
  })

  it('un objet de service sans le champ est SAUTÉ, pas pris pour une réponse', () => {
    expect(parseClaudeAuthStatus('{"update":"available"}\n{"loggedIn":false}', 1)).toBe('absent')
  })

  it('un objet illisible n’interrompt pas la recherche du suivant', () => {
    expect(parseClaudeAuthStatus('{pas du json}\n{"loggedIn":true}', 0)).toBe('authenticated')
  })

  it('une accolade DANS une chaîne ne casse pas le découpage', () => {
    const out = '{"note":"une } accolade piégeuse","loggedIn":true}'
    expect(parseClaudeAuthStatus(out, 0)).toBe('authenticated')
  })

  it('un guillemet échappé ne casse pas le découpage', () => {
    expect(parseClaudeAuthStatus('{"note":"say \\"hi\\" }","loggedIn":false}', 1)).toBe('absent')
  })

  it('deux réponses : la PREMIÈRE qui porte le champ tranche (ordre stable)', () => {
    expect(parseClaudeAuthStatus('{"loggedIn":false}\n{"loggedIn":true}', 1)).toBe('absent')
  })
})

/** Faux enfant de spawn : stdout pilotable, `close`/`error` déclenchables à la demande. */
function fakeChild(): EventEmitter & { stdout: EventEmitter; kill: () => void } {
  const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; kill: () => void }
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

/**
 * LE DÉFAUT BLOQUANT FERMÉ (audit du 2026-07-30) : la sonde exécutait le littéral `'claude'` avec
 * `shell: true`. Deux conséquences, toutes deux graves :
 *  - le run, lui, résout son binaire par `resolveClaudeBin` → sur un poste à DEUX installations
 *    (npm -g vs CLI embarqué dans l'app Desktop, stores d'auth distincts — mesuré), la sonde lisait
 *    l'auth d'une installation que le run n'utilise pas → faux vert, le bug d'origine ressuscité ;
 *  - `shell: true` fait consulter le RÉPERTOIRE COURANT avant le PATH par cmd.exe : un `claude.cmd`
 *    déposé là s'exécutait dans le process principal d'Electron. `findClaudeExecutable` refuse déjà
 *    cette menace et son en-tête énonce que « `shell: true` est EXCLU ».
 */
describe('probeClaudeSession — sonde le binaire DU RUN, sans shell', () => {
  it('exécute le binaire résolu, avec `auth status` et JAMAIS de shell', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const probe = probeClaudeSession({
      spawnFn: spawnFn as never,
      resolveBin: () => 'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe'
    })
    child.stdout.emit('data', '{"loggedIn":true}')
    child.emit('close', 0)

    expect(await probe).toBe('authenticated')
    expect(spawnFn).toHaveBeenCalledWith(
      'C:\\npm\\node_modules\\@anthropic-ai\\claude-code\\bin\\claude.exe',
      ['auth', 'status'],
      expect.objectContaining({ shell: false, windowsHide: true })
    )
  })

  it('un chemin à ESPACES reste un seul argument (ce que shell:true cassait)', async () => {
    const child = fakeChild()
    const spawnFn = vi.fn(() => child)
    const probe = probeClaudeSession({
      spawnFn: spawnFn as never,
      resolveBin: () => 'C:\\Program Files\\claude\\claude.exe'
    })
    child.emit('close', 1)
    await probe

    expect(spawnFn).toHaveBeenCalledWith(
      'C:\\Program Files\\claude\\claude.exe',
      ['auth', 'status'],
      expect.objectContaining({ shell: false })
    )
  })

  it('recolle les chunks : un JSON coupé en deux est quand même lu', async () => {
    const child = fakeChild()
    const probe = probeClaudeSession({
      spawnFn: (() => child) as never,
      resolveBin: () => 'claude.exe'
    })
    child.stdout.emit('data', '{"logge')
    child.stdout.emit('data', 'dIn":true}')
    child.emit('close', 0)

    expect(await probe).toBe('authenticated')
  })

  it('ENOENT (binaire introuvable) → unknown, jamais un vert ni une absence prouvée', async () => {
    const child = fakeChild()
    const probe = probeClaudeSession({
      spawnFn: (() => child) as never,
      resolveBin: () => 'claude'
    })
    child.emit('error', new Error('spawn claude ENOENT'))

    expect(await probe).toBe('unknown')
  })

  it('un spawn qui JETTE ne casse pas le diagnostic → unknown', async () => {
    const state = await probeClaudeSession({
      spawnFn: (() => {
        throw new Error('EPERM')
      }) as never,
      resolveBin: () => 'claude.exe'
    })
    expect(state).toBe('unknown')
  })

  it('timeout : le process est tué et l’état reste unknown', async () => {
    const child = fakeChild()
    const state = await probeClaudeSession({
      spawnFn: (() => child) as never,
      resolveBin: () => 'claude.exe',
      timeoutMs: 1
    })
    expect(state).toBe('unknown')
    expect(child.kill).toHaveBeenCalled()
  })

  it('un `close` APRÈS le timeout ne réécrit pas le verdict déjà rendu', async () => {
    const child = fakeChild()
    const state = await probeClaudeSession({
      spawnFn: (() => child) as never,
      resolveBin: () => 'claude.exe',
      timeoutMs: 1
    })
    expect(state).toBe('unknown')
    // Le CLI répond tardivement « loggedIn:true » : la promesse est déjà résolue, rien ne doit
    // basculer au vert après coup (et aucun throw sur une résolution tardive).
    expect(() => {
      child.stdout.emit('data', '{"loggedIn":true}')
      child.emit('close', 0)
    }).not.toThrow()
  })
})
