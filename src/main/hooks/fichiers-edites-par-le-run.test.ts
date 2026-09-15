import { describe, expect, it } from 'vitest'
import { fichiersEditesParLeRun, creerPreuveVisuelleHandler } from './default-gate-hooks'
import type { HookContext } from './hook-bus'
import type { ExecutionEvidence } from '../providers/types'

/**
 * LE DIFF DU RUN, ENFIN TRANSPORTE.
 *
 * Etat mesure le 2026-09-12 : `editsByFile` etait declare dans `HookContext` et lu par le fix-gate,
 * mais AUCUN site de production ne le remplissait (`grep -rn producedDiff\\|editsByFile src/main`
 * ne rendait que des declarations). Les garde-fous de preuve deduisaient donc les fichiers du run
 * par soustraction sur `git status` — exact tant que l'arbre de depart est connu, indirect sinon.
 *
 * Or la preuve d'execution PORTE deja l'information : une `ExecutionEvidence` de `kind: 'mutation'`
 * nomme ses chemins (`paths`, `path`, `pathFingerprints`). On la derive donc au lieu de la deviner.
 */
function mutation(paths: string[], extra: Partial<ExecutionEvidence> = {}): ExecutionEvidence {
  return {
    type: 'file_change',
    kind: 'mutation',
    status: 'ok',
    ok: true,
    summary: 'edition',
    paths,
    ...extra
  } as ExecutionEvidence
}

describe('fichiersEditesParLeRun — derive du diff reel, pas devine', () => {
  it('compte une edition par chemin mute', () => {
    const edits = fichiersEditesParLeRun([mutation(['src/main/a.ts'])])
    expect(edits).toEqual({ 'src/main/a.ts': 1 })
  })

  it('cumule les editions successives du MEME fichier', () => {
    const edits = fichiersEditesParLeRun([
      mutation(['src/main/a.ts']),
      mutation(['src/main/a.ts']),
      mutation(['src/main/b.ts'])
    ])
    expect(edits).toEqual({ 'src/main/a.ts': 2, 'src/main/b.ts': 1 })
  })

  it('accepte la forme `path` seule et les chemins Windows', () => {
    const edits = fichiersEditesParLeRun([
      mutation([], { paths: undefined, path: 'src\\main\\c.ts' } as Partial<ExecutionEvidence>)
    ])
    expect(edits).toEqual({ 'src/main/c.ts': 1 })
  })

  it('lit aussi les empreintes par chemin quand elles seules portent les fichiers', () => {
    const edits = fichiersEditesParLeRun([
      mutation([], { pathFingerprints: { 'src/main/d.ts': 'abc' } } as Partial<ExecutionEvidence>)
    ])
    expect(edits).toEqual({ 'src/main/d.ts': 1 })
  })

  it('IGNORE ce qui n est pas une mutation — lire un fichier n est pas l editer', () => {
    const lecture = { ...mutation(['src/main/e.ts']), kind: 'inspection' as const }
    const verif = { ...mutation(['src/main/f.ts']), kind: 'verification' as const }
    expect(fichiersEditesParLeRun([lecture, verif])).toEqual({})
  })

  it('rend un objet vide sur une preuve absente — jamais undefined', () => {
    expect(fichiersEditesParLeRun(undefined)).toEqual({})
    expect(fichiersEditesParLeRun([])).toEqual({})
  })
})

describe('preuve visuelle — le diff du run PRIME sur la soustraction git', () => {
  const RENDU = 'src/renderer/src/components/ChatView.tsx'
  const AUTRE = 'src/renderer/src/components/HomeView.tsx'

  function ctx(evidence: ExecutionEvidence[], avant?: readonly string[]): HookContext {
    return {
      event: 'pre-green',
      task: 'corrige le bug',
      cwd: 'D:\\depot',
      requireProof: true,
      evidence,
      fichiersTouchesAvantLeRun: avant
    }
  }

  it('bloque sur le fichier que le RUN dit avoir mute, meme si git en voit dix autres', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU, AUTRE])
    const verdict = await handler(ctx([mutation([RENDU])]))
    expect(verdict.block).toBe(true)
    expect(verdict.reason).toContain('ChatView.tsx')
    expect(verdict.reason).not.toContain('HomeView.tsx')
  })

  it('ne bloque PAS quand le run n a mute aucun fichier de rendu, meme sur un arbre sale', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU, AUTRE])
    const verdict = await handler(ctx([mutation(['src/main/logique.ts'])]))
    expect(verdict.block).toBe(false)
  })

  it('retombe sur la soustraction git quand le run ne rapporte AUCUNE mutation', async () => {
    const handler = creerPreuveVisuelleHandler(() => [RENDU])
    expect((await handler(ctx([], []))).block).toBe(true)
    expect((await handler(ctx([], [RENDU]))).block).toBe(false)
  })
})

/**
 * UN FICHIER, UNE CLE. conv-539, tour 24e29815 (reparation 1) : le fix-gate a refuse DEUX fois le
 * meme fichier — « 4 edits de src/main/orchestrator.ts » ET « 4 edits de
 * D:/AutoWinOS/src/main/orchestrator.ts ». Les mutations nomment le fichier tantot en relatif,
 * tantot en absolu ; sans le dossier de travail, les deux formes devenaient deux cles, et un jeton
 * de cause pose sur l'une laissait l'autre bloquee.
 */
describe('fichiersEditesParLeRun — chemin absolu et relatif du meme fichier', () => {
  it('fusionne les deux formes sous le chemin relatif au dossier de travail', () => {
    const edits = fichiersEditesParLeRun(
      [mutation(['src/main/a.ts']), mutation(['D:\\AutoWinOS\\src\\main\\a.ts'])],
      'D:\\AutoWinOS'
    )
    expect(edits).toEqual({ 'src/main/a.ts': 2 })
  })
  it('laisse intact un chemin hors du dossier de travail', () => {
    expect(fichiersEditesParLeRun([mutation(['E:/autre/b.ts'])], 'D:/AutoWinOS')).toEqual({
      'E:/autre/b.ts': 1
    })
  })
})
