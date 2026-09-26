import { describe, expect, it, vi } from 'vitest'
import { fusionnerRelecture, relireRun, runOuvertARelire } from './run-ouvert-a-jour'
import type { OrchStep } from './chat-view-model'
import type { RunEntry } from './chat-view-types'

function entree(path: string, mtime: number): RunEntry {
  return {
    subject: 'run',
    session: 'conv-1',
    path,
    mtime,
    summary: { status: 'open', dodTotal: 2, dodChecked: 0, journalEvents: 1, defauts: 0 }
  }
}

describe('runOuvertARelire — le RUN.md déplié suit son fichier', () => {
  const runs = [entree('/a/RUN.md', 200), entree('/b/RUN.md', 100)]

  it('rend l’entrée quand le RUN.md déplié a changé depuis son chargement', () => {
    expect(runOuvertARelire({ path: '/a/RUN.md', mtime: 150 }, runs)).toBe(runs[0])
  })

  it('ne relit pas un fichier inchangé', () => {
    expect(runOuvertARelire({ path: '/a/RUN.md', mtime: 200 }, runs)).toBeNull()
  })

  it('ne relit rien quand aucun run n’est déplié', () => {
    expect(runOuvertARelire(null, runs)).toBeNull()
  })

  it('attend la fin de l’ouverture en cours avant toute relecture', () => {
    expect(runOuvertARelire({ path: '/a/RUN.md', mtime: 150, pending: true }, runs)).toBeNull()
  })

  it('ne relit pas à l’aveugle quand la date de chargement est inconnue', () => {
    expect(runOuvertARelire({ path: '/a/RUN.md' }, runs)).toBeNull()
  })

  it('ne relit pas un run sorti de la liste (supprimé, autre conversation)', () => {
    expect(runOuvertARelire({ path: '/disparu/RUN.md', mtime: 1 }, runs)).toBeNull()
  })
})

describe('relireRun — la relecture ne casse jamais l’affichage courant', () => {
  const run = entree('/a/RUN.md', 300)
  const filV1 = [{ label: 'exec' }] as unknown as OrchStep[]
  const filV2 = [{ label: 'exec' }, { label: 'juge' }] as unknown as OrchStep[]

  it('rapporte le nouveau fil et le nouveau RUN.md, sans toucher l’onglet', async () => {
    const lecteur = {
      runTrace: vi.fn().mockResolvedValue(filV2),
      readNodeFile: vi.fn().mockResolvedValue({ path: run.path, content: '# v2' })
    }
    const relu = await relireRun(lecteur, run, filV1, vi.fn())
    expect(relu).toEqual({ trace: filV2, contenu: '# v2', montrerRunMd: false })
    expect(lecteur.runTrace).toHaveBeenCalledWith('/a/RUN.md')
  })

  it('garde le RUN.md affiché quand un fil apparaît alors qu’il n’y en avait pas', async () => {
    const lecteur = {
      runTrace: vi.fn().mockResolvedValue(filV1),
      readNodeFile: vi.fn().mockResolvedValue({ path: run.path, content: '# v2' })
    }
    const relu = await relireRun(lecteur, run, null, vi.fn())
    expect(relu.montrerRunMd).toBe(true)
  })

  it('un RUN.md illisible (en pleine écriture) ne remplace pas le contenu affiché', async () => {
    const signaler = vi.fn()
    const lecteur = {
      runTrace: vi.fn().mockRejectedValue(new Error('EBUSY trace')),
      readNodeFile: vi.fn().mockRejectedValue(new Error('EBUSY run'))
    }
    const relu = await relireRun(lecteur, run, filV1, signaler)
    expect(relu).toEqual({ trace: filV1, montrerRunMd: false })
    expect(signaler).toHaveBeenCalledTimes(2)
  })
})

describe('fusionnerRelecture — le nouvel état du run déplié', () => {
  const run = entree('/a/RUN.md', 300)

  it('remplace le contenu et retient la nouvelle date', () => {
    expect(
      fusionnerRelecture({ path: '/a/RUN.md', content: '# v1', mtime: 200 }, run, '# v2')
    ).toEqual({
      path: '/a/RUN.md',
      content: '# v2',
      mtime: 300
    })
  })

  it('lecture échouée : garde le contenu mais retient la date, pour ne pas relire en boucle', () => {
    const suivant = fusionnerRelecture(
      { path: '/a/RUN.md', content: '# v1', mtime: 200 },
      run,
      undefined
    )
    expect(suivant).toEqual({ path: '/a/RUN.md', content: '# v1', mtime: 300 })
    expect(runOuvertARelire(suivant, [run])).toBeNull()
  })

  it('jette le résultat si le run a été replié ou remplacé pendant la lecture', () => {
    const autre = { path: '/b/RUN.md', content: '# b', mtime: 100 }
    expect(fusionnerRelecture(autre, run, '# v2')).toBe(autre)
    expect(fusionnerRelecture(null, run, '# v2')).toBeNull()
  })
})
