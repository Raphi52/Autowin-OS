import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { stderrTailFromJournal } from './claude'

describe('cause d’echec en mode journal (stderr hors pipe)', () => {
  it('lit le fichier de diagnostic du relais Windows', () => {
    const fichiers: Record<string, string> = {
      '/j/run.log': '{"type":"system"}\n',
      '/j/run.log.stderr.log': 'Invalid API key\nPlease run /login\n'
    }
    expect(stderrTailFromJournal('/j/run.log', (p) => fichiers[p] ?? '')).toBe(
      'Invalid API key\nPlease run /login'
    )
  })

  it('a defaut, extrait les lignes non-JSON melangees au journal', () => {
    const fichiers: Record<string, string> = {
      '/j/run.log': '{"type":"system"}\nCredit balance too low\n{"type":"result"}\n'
    }
    expect(stderrTailFromJournal('/j/run.log', (p) => fichiers[p] ?? '')).toBe(
      'Credit balance too low'
    )
  })

  it('rend une chaine vide quand rien n’est lisible', () => {
    expect(
      stderrTailFromJournal('/j/absent', () => {
        throw new Error('ENOENT')
      })
    ).toBe('')
  })

  it('lit de VRAIS fichiers sur disque (lecteur par defaut)', () => {
    const dossier = mkdtempSync(join(tmpdir(), 'journal-stderr-'))
    const journal = join(dossier, 'run.log')
    writeFileSync(journal, '{"type":"system"}\n', 'utf8')
    writeFileSync(`${journal}.stderr.log`, 'Invalid API key · Please run /login\n', 'utf8')
    try {
      expect(stderrTailFromJournal(journal)).toBe('Invalid API key · Please run /login')
    } finally {
      rmSync(dossier, { recursive: true, force: true })
    }
  })
})
