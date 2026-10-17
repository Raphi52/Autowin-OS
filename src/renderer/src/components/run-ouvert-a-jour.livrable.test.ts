import { describe, expect, it, vi } from 'vitest'
import { cheminDuLivrableDuRun, fusionnerRelecture, lireLivrableDuRun } from './run-ouvert-a-jour'
import type { RunEntry } from './chat-view-types'

/**
 * LE PANNEAU DU RUN LIT LA SORTIE ENTIERE DES ETAPES (conv-989, 2026-10-16).
 *
 * Le « Fil des sous-agents » vient de `trace.json`, plafonne a 4 000 caracteres par etape. La fin
 * du run ecrit desormais la sortie entiere a cote du RUN.md (`livrable.md`, runs/livrable-entier.ts) :
 * le panneau la retrouve par ce nom, sans identifiant a deviner.
 */
const run: RunEntry = {
  subject: 'run',
  session: 'conv-1',
  path: 'D:\\data\\runs\\conv-1\\pistes-workspace\\RUN.md',
  mtime: 300,
  summary: { status: 'green', dodTotal: 1, dodChecked: 1, journalEvents: 1, defauts: 0 }
}

describe('lireLivrableDuRun', () => {
  it('le fichier voisin du RUN.md, quels que soient les séparateurs', () => {
    expect(cheminDuLivrableDuRun(run.path)).toBe(
      'D:\\data\\runs\\conv-1\\pistes-workspace\\livrable.md'
    )
    expect(cheminDuLivrableDuRun('/a/b/RUN.md')).toBe('/a/b/livrable.md')
  })

  it('rend son contenu quand il existe', async () => {
    const lecteur = {
      readNodeFile: vi.fn().mockResolvedValue({ path: 'x', content: '## 1. étape scout' })
    }
    expect(await lireLivrableDuRun(lecteur, run.path)).toBe('## 1. étape scout')
    expect(lecteur.readNodeFile).toHaveBeenCalledWith(cheminDuLivrableDuRun(run.path))
  })

  it('absent (run ancien, run en cours) : rien, sans erreur — ce n’est pas une panne', async () => {
    const lecteur = { readNodeFile: vi.fn().mockRejectedValue(new Error('fichier introuvable')) }
    expect(await lireLivrableDuRun(lecteur, run.path)).toBeUndefined()
  })
})

describe('fusionnerRelecture garde la sortie entière', () => {
  it('une relecture qui la trouve l’ajoute ; une relecture qui ne la trouve pas garde l’ancienne', () => {
    const courant = { path: run.path, content: '# v1', mtime: 100 }
    const avec = fusionnerRelecture(courant, run, '# v2', '## sortie')
    expect(avec).toEqual({ path: run.path, content: '# v2', mtime: 300, livrable: '## sortie' })
    expect(fusionnerRelecture(avec, run, '# v3')).toEqual({
      path: run.path,
      content: '# v3',
      mtime: 300,
      livrable: '## sortie'
    })
  })
})
