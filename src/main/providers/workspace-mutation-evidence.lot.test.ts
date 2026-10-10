import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  readGitDiff,
  readGitDiffHeadBatch,
  readGitState,
  readNoIndexGitDiff
} from '../git-read-main'
import { addedLineFingerprintsFromUnifiedDiff } from '../exact-line-fingerprint'
import { supprimerArbre } from '../fs-supprimer'
import {
  captureWorkspaceMutationSnapshot,
  captureWorkspacePathGenerationMarker
} from './workspace-mutation-evidence'

vi.mock('../git-read-main', async (importOriginal) => {
  const reel = await importOriginal<typeof import('../git-read-main')>()
  return {
    ...reel,
    readGitState: vi.fn(reel.readGitState),
    readGitDiffHeadBatch: vi.fn(reel.readGitDiffHeadBatch),
    readNoIndexGitDiff: vi.fn(reel.readNoIndexGitDiff)
  }
})

const roots: string[] = []

afterEach(() => {
  vi.mocked(readGitState).mockClear()
  vi.mocked(readGitDiffHeadBatch).mockClear()
  vi.mocked(readNoIndexGitDiff).mockClear()
  for (const root of roots.splice(0)) supprimerArbre(root)
})

function depot(prefixe: string): string {
  const root = mkdtempSync(join(tmpdir(), prefixe))
  roots.push(root)
  const git = (...args: string[]): void => {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' })
  }
  git('init')
  git('config', 'user.email', 'test@autowin.local')
  git('config', 'user.name', 'Autowin Test')
  git('config', 'core.autocrlf', 'false')
  writeFileSync(join(root, 'modifie.ts'), 'un\ndeux\n', 'utf8')
  writeFileSync(join(root, 'supprime.ts'), 'va disparaitre\n', 'utf8')
  writeFileSync(join(root, 'ancien-nom.ts'), 'contenu renomme\nsur deux lignes\n', 'utf8')
  writeFileSync(join(root, 'avec espace.ts'), 'avant\n', 'utf8')
  writeFileSync(join(root, 'accentué.ts'), 'avant\n', 'utf8')
  writeFileSync(join(root, 'a1.ts'), 'cible du joker\n', 'utf8')
  writeFileSync(join(root, 'image.bin'), Buffer.from([0, 1, 2, 3, 0, 255]))
  mkdirSync(join(root, 'suivi'))
  writeFileSync(join(root, 'suivi', 'interne.ts'), 'avant\n', 'utf8')
  git('add', '.')
  git('commit', '-m', 'initial')
  // Tous les cas que le lot doit rendre A L'IDENTIQUE de l'appel unitaire.
  writeFileSync(join(root, 'modifie.ts'), 'un\ndeux modifie\ntrois\n', 'utf8')
  rmSync(join(root, 'supprime.ts'))
  git('mv', 'ancien-nom.ts', 'nouveau-nom.ts') // renommage INDEXE : le lot ne doit pas l'apparier
  writeFileSync(join(root, 'avec espace.ts'), 'apres\n', 'utf8')
  writeFileSync(join(root, 'accentué.ts'), 'apres\n', 'utf8') // entete cite par git
  writeFileSync(join(root, 'a1.ts'), 'cible du joker modifiee\n', 'utf8')
  writeFileSync(join(root, 'a[1].ts'), 'nom a joker, non suivi\n', 'utf8')
  writeFileSync(join(root, 'image.bin'), Buffer.from([0, 9, 9, 9, 0, 255, 7]))
  writeFileSync(join(root, 'suivi', 'interne.ts'), 'apres\n', 'utf8')
  writeFileSync(join(root, 'nouveau.ts'), 'cree\ncree encore\n', 'utf8')
  mkdirSync(join(root, 'dossier-neuf'))
  writeFileSync(join(root, 'dossier-neuf', 'dedans.ts'), 'dans un dossier non suivi\n', 'utf8')
  return root
}

/** L'ANCIEN calcul, fichier par fichier : la reference dont les empreintes ne doivent pas bouger. */
async function referenceUnitaire(
  cwd: string,
  observes: readonly string[]
): Promise<Map<string, { empreinte: string; lignes: readonly string[] }>> {
  const git = await readGitState(cwd, 0)
  const chemins = [
    ...new Set([
      ...(git.state?.changes ?? []).map((change) => change.path.replaceAll('\\', '/')),
      ...observes
    ])
  ]
  const reference = new Map<string, { empreinte: string; lignes: readonly string[] }>()
  for (const chemin of chemins) {
    const diff = await readGitDiff(cwd, chemin)
    const generationMarker = await captureWorkspacePathGenerationMarker(cwd, chemin)
    const empreinte = createHash('sha256')
      .update(
        JSON.stringify({
          diff: diff.available ? (diff.diff ?? '') : `unavailable:${diff.error ?? ''}`,
          generationMarker
        }),
        'utf8'
      )
      .digest('hex')
    const lignes = diff.available ? addedLineFingerprintsFromUnifiedDiff(diff.diff ?? '') : []
    reference.set(chemin, { empreinte, lignes })
  }
  return reference
}

async function attendreLaParite(cwd: string, observes: readonly string[] = []): Promise<number> {
  const photo = await captureWorkspaceMutationSnapshot(cwd, observes)
  const reference = await referenceUnitaire(cwd, observes)
  expect([...photo.keys()].sort()).toEqual([...reference.keys()].sort())
  for (const [chemin, attendu] of reference) {
    expect({ chemin, empreinte: photo.get(chemin) }).toEqual({
      chemin,
      empreinte: attendu.empreinte
    })
    expect({ chemin, lignes: photo.lineFingerprints.get(chemin) }).toEqual({
      chemin,
      lignes: attendu.lignes
    })
  }
  return reference.size
}

describe('photo git du tour : un lot au lieu d un processus par fichier', () => {
  it('rend EXACTEMENT les empreintes de l ancien calcul fichier par fichier', async () => {
    const root = depot('autowin-lot-parite-')
    // Un chemin seulement OBSERVE et qui est un DOSSIER aux fichiers suivis : seul, son diff
    // englobe `suivi/interne.ts` — il doit garder l'ancien chemin unitaire.
    const compares = await attendreLaParite(root, ['suivi'])
    expect(compares).toBeGreaterThanOrEqual(11)
    expect(vi.mocked(readGitDiffHeadBatch)).toHaveBeenCalled()
  })

  it('retombe sur l ancien calcul, a l identique, quand le lot echoue', async () => {
    const root = depot('autowin-lot-echec-')
    vi.mocked(readGitDiffHeadBatch).mockResolvedValueOnce(undefined)
    expect(await attendreLaParite(root, ['suivi'])).toBeGreaterThanOrEqual(11)
    expect(vi.mocked(readGitDiffHeadBatch)).toHaveBeenCalledTimes(1)
  })
})

describe('photo git du tour : partagee entre conversations simultanees', () => {
  it('cinq demandes simultanees ne lancent que deux photos', async () => {
    const root = depot('autowin-lot-partage-')
    const photos = await Promise.all(
      Array.from({ length: 5 }, () => captureWorkspaceMutationSnapshot(root))
    )
    expect(vi.mocked(readGitState)).toHaveBeenCalledTimes(2)
    for (const photo of photos.slice(1)) expect(photo).toBe(photos[1])
  })

  it('ne rejoint jamais une photo deja en cours : la demande voit l ecriture faite juste avant', async () => {
    const root = depot('autowin-lot-ordre-')
    const premiere = captureWorkspaceMutationSnapshot(root)
    writeFileSync(join(root, 'ecrit-pendant.ts'), 'ecrit pendant la premiere photo\n', 'utf8')
    const seconde = await captureWorkspaceMutationSnapshot(root)
    await premiere
    expect(seconde.has('ecrit-pendant.ts')).toBe(true)
    expect(vi.mocked(readGitState)).toHaveBeenCalledTimes(2)
  })

  it('deux dossiers differents ne s attendent pas', async () => {
    const a = depot('autowin-lot-a-')
    const b = depot('autowin-lot-b-')
    await Promise.all([captureWorkspaceMutationSnapshot(a), captureWorkspaceMutationSnapshot(b)])
    expect(vi.mocked(readGitState)).toHaveBeenCalledTimes(2)
  })
})

/**
 * UNE ENTREE NON SUIVIE INCHANGEE NE SE REDIFFE PAS — heal conv-204, mesure du 2026-10-10.
 *
 * Apres le lot, une photo du depot reel lancait encore 91 `git diff --no-index` : un par entree non
 * suivie, alors que presque toutes etaient identiques d'une photo a l'autre (banc sur D:/Autowin :
 * 95 processus par photo, dont 91 pour ces entrees). Le texte de git n'est re-servi que si
 * l'entree n'a pas change de GENERATION — et les empreintes restent celles de l'ancien calcul.
 */
describe('photo git du tour : une entree non suivie inchangee ne se rediffe pas', () => {
  /*
   * Seules comptent les entrees PRESENTES sur le disque. `git status` rend un nom accentue entre
   * guillemets (`"accentu\303\251.ts"`) : ce chemin n'existe pas tel quel, n'a donc pas de
   * generation lisible, et repasse par git a chaque photo — comme avant, a l'identique.
   */
  const appelsSurDesEntreesPresentes = (root: string): string[] =>
    vi
      .mocked(readNoIndexGitDiff)
      .mock.calls.map(([, chemin]) => chemin)
      .filter((chemin) => existsSync(join(root, chemin)))

  it('la seconde photo ne relance aucun git --no-index et garde les empreintes de l ancien calcul', async () => {
    const root = depot('autowin-memo-stable-')
    await captureWorkspaceMutationSnapshot(root)
    expect(appelsSurDesEntreesPresentes(root).sort()).toEqual(['dossier-neuf/', 'nouveau.ts'])
    vi.mocked(readNoIndexGitDiff).mockClear()

    await attendreLaParite(root)
    expect(appelsSurDesEntreesPresentes(root)).toEqual([])
  })

  it('une entree non suivie MODIFIEE entre deux photos est rediffee, a l identique de l ancien calcul', async () => {
    const root = depot('autowin-memo-change-')
    const premiere = await captureWorkspaceMutationSnapshot(root)
    writeFileSync(join(root, 'nouveau.ts'), 'cree\nmodifie entre deux photos\n', 'utf8')
    vi.mocked(readNoIndexGitDiff).mockClear()

    await attendreLaParite(root)
    expect(appelsSurDesEntreesPresentes(root)).toEqual(['nouveau.ts'])
    const seconde = await captureWorkspaceMutationSnapshot(root)
    expect(seconde.get('nouveau.ts')).not.toBe(premiere.get('nouveau.ts'))
  })
})
