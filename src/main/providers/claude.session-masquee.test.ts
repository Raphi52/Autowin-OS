import { EventEmitter } from 'node:events'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

/**
 * Le CLI Claude garde sa propre copie de la session : `<config>/projects/<dossier encodé>/<id>.jsonl`,
 * et les sorties d'outils trop longues dans `<id>/tool-results/`. Il l'écrit lui-même, hors de la
 * pompe du routeur qui masque ce qui entre dans Autowin : une valeur du coffre affichée par une
 * commande y restait en clair. Ce test joue un appel Claude complet (CLI simulé) avec un vrai coffre
 * qui contient une fausse clé, et relit la session sur le disque une fois l'appel fini.
 */
const { VALEUR, SESSION } = vi.hoisted(() => ({
  VALEUR: 'sk-coffre-session-0123456789abcdef',
  SESSION: '6f1906ce-0000-4000-8000-00000000c0ff'
}))

vi.mock('../app/coffre-cles', async (importOriginal) => {
  const vrai = await importOriginal<typeof import('../app/coffre-cles')>()
  const { mkdtempSync: dossierTemporaire } = await import('node:fs')
  const { tmpdir: temporaire } = await import('node:os')
  const { join: joindre } = await import('node:path')
  const dossier = dossierTemporaire(joindre(temporaire(), 'coffre-session-'))
  const coffre = vrai.creerCoffre({
    chemin: () => joindre(dossier, 'coffre-cles.bin'),
    chiffrement: () => ({
      isEncryptionAvailable: () => true,
      encryptString: (t: string) => Buffer.from(t, 'utf8'),
      decryptString: (b: Buffer) => b.toString('utf8')
    }),
    lireRegistre: () => new Map(),
    env: {}
  })
  coffre.ajouterCle('MISTRAL_API_KEY', VALEUR)
  return {
    ...vrai,
    masquerValeurs: (texte: string) => coffre.masquerValeurs(texte),
    valeursPourAgent: (exclusions: readonly string[]) => coffre.valeursPourAgent(exclusions)
  }
})

vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  spawn: () => {
    const child = new EventEmitter() as EventEmitter & Record<string, unknown>
    child.pid = 5353
    child.exitCode = null
    child.stdout = new EventEmitter()
    child.stderr = new EventEmitter()
    child.stdin = { end: () => undefined }
    child.kill = () => true
    child.unref = () => undefined
    queueMicrotask(() => {
      child.exitCode = 0
      child.emit('close', 0)
    })
    return child
  }
}))

vi.mock('../runs/stdout-journal', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../runs/stdout-journal')>()
  return {
    ...reel,
    tailJsonLines: async (
      _path: string,
      onLine: (line: string) => void,
      options?: { isComplete?: () => boolean }
    ) => {
      onLine(JSON.stringify({ type: 'system', subtype: 'init', session_id: SESSION }))
      onLine(
        JSON.stringify({
          type: 'result',
          subtype: 'success',
          result: 'clé utilisée',
          session_id: SESSION,
          is_error: false,
          usage: { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0 }
        })
      )
      while (!options?.isComplete?.()) await new Promise((resolve) => setTimeout(resolve, 5))
      return { offset: 1, stopped: false }
    }
  }
})

import { configureClaudeAccountEnv } from './claude-accounts'
import { ClaudeCliAdapter } from './claude'
import { encoderCheminCli } from '../store/historique-cli-copie'

const racines: string[] = []
const racineAvant = process.env.AUTOWIN_RUN_JOURNAL_ROOT

afterEach(() => {
  configureClaudeAccountEnv(() => ({}))
  for (const racine of racines.splice(0)) rmSync(racine, { recursive: true, force: true })
  if (racineAvant === undefined) delete process.env.AUTOWIN_RUN_JOURNAL_ROOT
  else process.env.AUTOWIN_RUN_JOURNAL_ROOT = racineAvant
})

describe('Claude CLI — la copie de session ne garde pas les valeurs du coffre en clair', () => {
  it('à la fin de l’appel, la session et ses sorties d’outils sont masquées en place', async () => {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-claude-session-'))
    racines.push(racine)
    process.env.AUTOWIN_RUN_JOURNAL_ROOT = join(racine, 'run-stdout')
    const compte = join(racine, 'compte-test')
    configureClaudeAccountEnv(() => ({ CLAUDE_CONFIG_DIR: compte }))
    const travail = join(racine, 'travail')
    mkdirSync(travail, { recursive: true })

    // Ce que le CLI a écrit pendant l'appel : la commande et sa sortie, valeur comprise.
    const projet = join(compte, 'projects', encoderCheminCli(travail))
    mkdirSync(join(projet, SESSION, 'tool-results'), { recursive: true })
    const session = join(projet, `${SESSION}.jsonl`)
    const sortieLongue = join(projet, SESSION, 'tool-results', 'toolu_01.txt')
    writeFileSync(
      session,
      [
        JSON.stringify({ type: 'user', message: { content: 'affiche la clé' } }),
        JSON.stringify({
          type: 'user',
          message: { content: [{ type: 'tool_result', content: `Bearer ${VALEUR}` }] }
        })
      ].join('\n') + '\n'
    )
    writeFileSync(sortieLongue, `ligne 1\nclé : ${VALEUR}\n`)
    const tailleAvant = statSync(session).size

    const flux = new ClaudeCliAdapter({ bin: 'claude-test' }).send(
      [{ role: 'user', content: 'sers-toi de la clé' }],
      { execution: { cwd: travail, sandbox: 'read-only' } }
    )
    let pas = await flux.next()
    while (!pas.done) pas = await flux.next()
    expect(pas.value.text).toBe('clé utilisée')

    const relue = readFileSync(session, 'utf8')
    expect(relue).not.toContain(VALEUR)
    expect(relue).toContain('[secret:MISTRAL_API_KEY]')
    // Même taille et JSON valide : le CLI reprend cette session au tour suivant (`--resume`).
    expect(statSync(session).size).toBe(tailleAvant)
    for (const ligne of relue.trim().split('\n')) expect(() => JSON.parse(ligne)).not.toThrow()
    expect(readFileSync(sortieLongue, 'utf8')).not.toContain(VALEUR)
  })
})
