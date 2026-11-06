import { describe, expect, it } from 'vitest'
import { decisionDeSynchronisation } from './synchronisation-cible-bureau'
import { join, resolve } from 'node:path'

const WS = resolve('/tmp/ws')
const BUREAU = resolve('/tmp/bureau')
const octets = (t: string): Uint8Array => new TextEncoder().encode(t)

function lecteur(map: Record<string, string>) {
  return (chemin: string): Uint8Array | undefined => {
    const trouve = Object.entries(map).find(([c]) => resolve(c) === resolve(chemin))
    return trouve ? octets(trouve[1]) : undefined
  }
}

describe('decisionDeSynchronisation', () => {
  it('copie quand le bureau porte une version PERIMEE de la cible', () => {
    const d = decisionDeSynchronisation(
      'src/a.ts',
      WS,
      BUREAU,
      lecteur({ [join(WS, 'src/a.ts')]: 'vivant', [join(BUREAU, 'src/a.ts')]: 'commit' })
    )
    expect(d).toEqual({
      action: 'copier',
      cheminWorkspace: join(WS, 'src/a.ts'),
      cheminBureau: join(BUREAU, 'src/a.ts')
    })
  })

  it('ne copie pas un contenu déjà identique', () => {
    const d = decisionDeSynchronisation(
      'src/a.ts',
      WS,
      BUREAU,
      lecteur({ [join(WS, 'src/a.ts')]: 'même', [join(BUREAU, 'src/a.ts')]: 'même' })
    )
    expect(d.action).toBe('aucune')
  })

  it('ne CRÉE pas un fichier absent du bureau (hors périmètre d’edit_file)', () => {
    const d = decisionDeSynchronisation('src/a.ts', WS, BUREAU, lecteur({ [join(WS, 'src/a.ts')]: 'vivant' }))
    expect(d).toEqual({ action: 'aucune', raison: 'fichier absent' })
  })

  it('refuse une traversée hors du workspace', () => {
    const d = decisionDeSynchronisation('../ailleurs.ts', WS, BUREAU, () => octets('x'))
    expect(d).toEqual({ action: 'aucune', raison: 'cible hors du workspace' })
  })

  it('refuse .git — une copie y corromprait le dépôt', () => {
    const d = decisionDeSynchronisation('.git/config', WS, BUREAU, () => octets('x'))
    expect(d.action).toBe('aucune')
  })

  it('ne se copie pas sur soi-même quand bureau = workspace', () => {
    const d = decisionDeSynchronisation('src/a.ts', WS, WS, () => octets('x'))
    expect(d).toEqual({ action: 'aucune', raison: 'bureau = workspace' })
  })
})
