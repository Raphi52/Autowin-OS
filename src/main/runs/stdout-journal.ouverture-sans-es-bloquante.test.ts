import { describe, expect, it, vi } from 'vitest'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Gel mesuré (gels.jsonl 2026-10-11 14:15) : 9 930 ms de fenêtre figée sur UN `openSync
// …stdout.jsonl`, l'ouverture du journal d'un appel Claude, pendant que le disque D: saturait.
vi.mock('node:fs', async (orig) => {
  const reel = await orig<typeof import('node:fs')>()
  return { ...reel, openSync: vi.fn(reel.openSync), mkdirSync: vi.fn(reel.mkdirSync) }
})

import { openStdoutJournalAsync, stdoutJournalPath } from './stdout-journal'

describe('openStdoutJournalAsync — ouverture du journal sans E/S bloquante', () => {
  it('crée le dossier et ouvre le journal sans openSync ni mkdirSync', async () => {
    const base = fs.mkdtempSync(join(tmpdir(), 'journal-ouverture-'))
    const root = join(base, 'jamais', 'cree')
    try {
      vi.mocked(fs.openSync).mockClear()
      vi.mocked(fs.mkdirSync).mockClear()
      const handle = await openStdoutJournalAsync(root, 'appel-1')
      expect(vi.mocked(fs.openSync)).not.toHaveBeenCalled()
      expect(vi.mocked(fs.mkdirSync)).not.toHaveBeenCalled()
      expect(handle.path).toBe(stdoutJournalPath(root, 'appel-1'))
      // Un descripteur NUMÉRIQUE : il part tel quel dans `stdio` du spawn, et l'appelant le ferme.
      expect(typeof handle.fd).toBe('number')
      fs.writeSync(handle.fd, '{"a":1}\n')
      fs.closeSync(handle.fd)
      expect(fs.readFileSync(handle.path, 'utf8')).toBe('{"a":1}\n')
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })

  it('ouvre en AJOUT : un journal existant n’est jamais tronqué', async () => {
    const root = fs.mkdtempSync(join(tmpdir(), 'journal-ajout-'))
    try {
      fs.writeFileSync(stdoutJournalPath(root, 'appel-2'), '{"avant":1}\n', 'utf8')
      const handle = await openStdoutJournalAsync(root, 'appel-2')
      fs.writeSync(handle.fd, '{"apres":2}\n')
      fs.closeSync(handle.fd)
      expect(fs.readFileSync(handle.path, 'utf8')).toBe('{"avant":1}\n{"apres":2}\n')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('un identifiant invalide est refusé par la promesse, sans rien créer', async () => {
    const base = fs.mkdtempSync(join(tmpdir(), 'journal-refus-'))
    try {
      await expect(openStdoutJournalAsync(join(base, 'r'), '..')).rejects.toThrow(
        'identifiant de run invalide'
      )
      expect(fs.existsSync(join(base, 'r'))).toBe(false)
    } finally {
      fs.rmSync(base, { recursive: true, force: true })
    }
  })
})
