import { describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scriptHookGardes } from '../../shared/garde-git-destructeur'
import { refusReglageProd, refusSqlAgent } from '../prod/prod-run-guard'
import { OpenAICompatAdapter } from './openai-compat'
import { creerOutilsAgentDirect } from './outils-agent-direct'
import type { SendOptions, SendResult, StreamChunk } from './types'

/**
 * Outils d'agent du moteur direct. Le faux serveur OpenAI-compatible demande un appel
 * d'outil, puis répond en texte : on relit le disque et ce que le moteur a rendu au modèle.
 * La garde est le VRAI script PreToolUse (`scriptHookGardes`, celui de `scriptDesGardesCourant`),
 * construit avec un dossier de mod protégé, comme dans garde-mod-autowin.hook.test.ts.
 */
function sse(evts: unknown[]): Response {
  const corps = evts.map((e) => `data: ${JSON.stringify(e)}\n\n`).join('') + 'data: [DONE]\n\n'
  return new Response(corps, { status: 200, headers: { 'content-type': 'text/event-stream' } })
}

function fauxServeur(nom: string, args: Record<string, unknown>) {
  const corps: Array<{
    messages: Array<Record<string, unknown>>
    tools?: Array<{ function: { name: string } }>
  }> = []
  const fetchImpl = async (_url: string, init: RequestInit): Promise<Response> => {
    corps.push(JSON.parse(String(init.body)))
    if (corps.length === 1) {
      return sse([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, id: 'c1', function: { name: nom, arguments: JSON.stringify(args) } }
                ]
              }
            }
          ]
        }
      ])
    }
    return sse([{ choices: [{ delta: { content: 'fini' } }] }])
  }
  return { corps, fetchImpl }
}

async function vider(gen: AsyncGenerator<StreamChunk, SendResult, void>): Promise<SendResult> {
  for (;;) {
    const r = await gen.next()
    if (r.done) return r.value
  }
}

function gardeAvecMod(mod: string): () => string {
  const fabrique = scriptHookGardes as unknown as (...a: unknown[]) => string
  return () => fabrique(refusReglageProd, refusSqlAgent, [], mod)
}

describe('moteur direct — outils d’agent dans le dossier du run', () => {
  it('le modèle demande l’écriture : le fichier existe ensuite dans le dossier de travail', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'direct-ecrire-'))
    const { corps, fetchImpl } = fauxServeur('ecrire_fichier', {
      chemin: 'sous/bonjour.txt',
      contenu: 'salut'
    })
    const a = new OpenAICompatAdapter({
      id: 'api-test',
      baseUrl: 'http://faux/v1',
      defaultModel: 'm',
      fetchImpl,
      outilsDuDossier: (ex) =>
        creerOutilsAgentDirect({
          cwd: ex.cwd,
          sandbox: ex.sandbox,
          scriptGarde: gardeAvecMod(join(cwd, '..', 'mod-absent'))
        })
    })
    const opts: SendOptions = { execution: { cwd, sandbox: 'workspace-write' } }
    const r = await vider(a.send([{ role: 'user', content: 'écris' }], opts))
    expect(r.text).toBe('fini')
    expect(readFileSync(join(cwd, 'sous', 'bonjour.txt'), 'utf8')).toBe('salut')
    expect(corps[0]!.tools!.map((t) => t.function.name)).toEqual(
      expect.arrayContaining([
        'lire_fichier',
        'ecrire_fichier',
        'editer_fichier',
        'commande',
        'grep',
        'glob'
      ])
    )
    expect(String(corps[1]!.messages.at(-1)!.content)).toMatch(/Fichier écrit/)
  })

  it('un chemin interdit par la garde est refusé, rien n’est écrit, l’erreur revient au modèle', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'direct-refus-'))
    const mod = join(racine, 'mods', 'autowin')
    const cwd = join(racine, 'copie')
    mkdirSync(mod, { recursive: true })
    mkdirSync(cwd, { recursive: true })
    const cible = join(mod, 'regles.js')
    const { corps, fetchImpl } = fauxServeur('ecrire_fichier', { chemin: cible, contenu: 'x' })
    const a = new OpenAICompatAdapter({
      id: 'api-test',
      baseUrl: 'http://faux/v1',
      defaultModel: 'm',
      fetchImpl,
      outilsDuDossier: (ex) =>
        creerOutilsAgentDirect({
          cwd: ex.cwd,
          agentEnv: ex.agentEnv,
          scriptGarde: gardeAvecMod(mod)
        })
    })
    const r = await vider(
      a.send([{ role: 'user', content: 'écris' }], {
        execution: { cwd, sandbox: 'workspace-write', agentEnv: { AUTOWIN_HDESK_ID: 'run-test-1' } }
      })
    )
    expect(r.text).toBe('fini')
    expect(existsSync(cible)).toBe(false)
    const rendu = String(corps[1]!.messages.at(-1)!.content)
    expect(rendu).toMatch(/^Erreur : refusé par la garde/)
    expect(rendu).toMatch(/mod Autowin/)
  })

  it('jumeau : même garde, chemin voisin hors du mod protégé → écrit', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'direct-jumeau-'))
    const mod = join(racine, 'mods', 'autowin')
    mkdirSync(mod, { recursive: true })
    const [, ecrire] = creerOutilsAgentDirect({
      cwd: racine,
      agentEnv: { AUTOWIN_HDESK_ID: 'run-test-1' },
      scriptGarde: gardeAvecMod(mod)
    })
    await ecrire!.executer(
      { chemin: join(racine, 'mods', 'autowin-copie', 'x.js'), contenu: 'x' },
      {}
    )
    expect(existsSync(join(racine, 'mods', 'autowin-copie', 'x.js'))).toBe(true)
  })

  it('éditer, lire, grep, glob et commande travaillent dans le cwd du run ; lecture seule sans écriture', async () => {
    const cwd = mkdtempSync(join(tmpdir(), 'direct-divers-'))
    mkdirSync(join(cwd, 'src'))
    writeFileSync(join(cwd, 'src', 'a.ts'), 'const x = 1\n', 'utf8')
    const outils = Object.fromEntries(
      creerOutilsAgentDirect({ cwd, scriptGarde: gardeAvecMod(join(cwd, 'aucun')) }).map((o) => [
        o.nom,
        o
      ])
    )
    await outils.editer_fichier!.executer({ chemin: 'src/a.ts', ancien: '1', nouveau: '2' }, {})
    expect(await outils.lire_fichier!.executer({ chemin: 'src/a.ts' }, {})).toBe('const x = 2\n')
    expect(await outils.grep!.executer({ motif: 'x = 2' }, {})).toBe('src/a.ts:1: const x = 2')
    expect(await outils.glob!.executer({ motif: 'src/**/*.ts' }, {})).toBe('src/a.ts')
    expect(
      await outils.commande!.executer(
        { commande: 'node -e "process.stdout.write(process.cwd())"' },
        {}
      )
    ).toContain(cwd)
    const ro = creerOutilsAgentDirect({
      cwd,
      sandbox: 'read-only',
      scriptGarde: gardeAvecMod(join(cwd, 'aucun'))
    }).map((o) => o.nom)
    expect(ro).not.toContain('ecrire_fichier')
    expect(ro).not.toContain('editer_fichier')
  })
})
