import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Gel mesuré (gels.jsonl 2026-10-11 14:13) : 1 726 ms de fenêtre figée sur UN `writeFileSync
// …stdout.jsonl.<uuid>.stdin`, l'écriture du message d'un appel Claude avant son lancement.
vi.mock('node:fs', async (orig) => {
  const reel = await orig<typeof import('node:fs')>()
  return { ...reel, writeFileSync: vi.fn(reel.writeFileSync) }
})

import { backgroundSurvivalInvocation, backgroundSurvivalInvocationAsync } from './survivable-spawn'

const ecrituresSynchronesDuStdin = (): unknown[][] =>
  vi.mocked(fs.writeFileSync).mock.calls.filter(([chemin]) => String(chemin).endsWith('.stdin'))

describe('backgroundSurvivalInvocationAsync — message écrit sans E/S bloquante', () => {
  it('écrit le .stdin sans writeFileSync, avec le contenu exact du message', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'relais-entree-'))
    try {
      vi.mocked(fs.writeFileSync).mockClear()
      const journal = join(root, 'appel.stdout.jsonl')
      const invocation = await backgroundSurvivalInvocationAsync(
        'C:/outils/claude.exe',
        ['-p'],
        root,
        journal,
        'bonjour é ✓',
        'win32'
      )
      expect(ecrituresSynchronesDuStdin()).toEqual([])
      expect(invocation.relay).toBe(true)
      expect(invocation.inputPath).toMatch(/\.stdin$/)
      expect(fs.readFileSync(invocation.inputPath!, 'utf8')).toBe('bonjour é ✓')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('rend la MÊME invocation que la version synchrone (seul le nom du .stdin change)', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'relais-pareil-'))
    try {
      const journal = join(root, 'appel.stdout.jsonl')
      const env = { AUTOWIN_CONVERSATION_ID: 'conv-test' }
      vi.mocked(fs.writeFileSync).mockClear()
      const sync = backgroundSurvivalInvocation(
        'C:/c.exe',
        ['-p'],
        root,
        journal,
        'm',
        'win32',
        undefined,
        env
      )
      const async = await backgroundSurvivalInvocationAsync(
        'C:/c.exe',
        ['-p'],
        root,
        journal,
        'm',
        'win32',
        undefined,
        env
      )
      const sansEntree = (i: typeof sync): unknown => ({
        ...i,
        inputPath: undefined,
        args: i.args.slice(0, 1).concat(i.args.slice(2))
      })
      expect(sansEntree(async)).toEqual(sansEntree(sync))
      expect(async.inputPath).not.toBe(sync.inputPath)
      // Le détecteur n'est pas aveugle : il voit l'écriture BLOQUANTE de la version synchrone, et
      // celle-là seule.
      expect(ecrituresSynchronesDuStdin().map(([chemin]) => chemin)).toEqual([sync.inputPath])
      // Le chemin du .stdin voyage dans les arguments PowerShell encodés (2e argument du relais).
      const powershellArgs = JSON.parse(Buffer.from(async.args[1], 'base64').toString('utf8'))
      const entree = powershellArgs[powershellArgs.indexOf('-InputPathB64') + 1]
      expect(Buffer.from(entree, 'base64').toString('utf8')).toBe(async.inputPath)
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('hors Windows : aucun relais, aucun fichier écrit', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'relais-linux-'))
    try {
      const invocation = await backgroundSurvivalInvocationAsync(
        'claude',
        ['-p'],
        root,
        join(root, 'appel.stdout.jsonl'),
        'm',
        'linux'
      )
      expect(invocation).toEqual({
        bin: 'claude',
        args: ['-p'],
        relay: false,
        completionPath: join(root, 'appel.stdout.jsonl.exit.json')
      })
      expect(fs.readdirSync(root)).toEqual([])
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })
})
