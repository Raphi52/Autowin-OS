import { type ChildProcess, spawn, execFileSync } from 'node:child_process'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  statSync,
  symlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { supprimerArbre, supprimerArbreAsync } from './fs-supprimer'

/**
 * `supprimerArbreAsync` rejoue les cas limites de `fs-supprimer.test.ts` (conv-108) — heal conv-1115.
 * Les deux formes ont chacune leur parcours : ces cas sont ce qui les empêche de diverger. Le cas
 * « jonction » est le plus grave : une suppression qui suit la jonction `node_modules` d'une copie
 * d'agent viderait les modules du dépôt.
 */

const bacs: string[] = []
function bac(): string {
  const d = mkdtempSync(join(tmpdir(), 'autowin-fs-supprimer-async-'))
  bacs.push(d)
  return d
}
afterAll(() => {
  for (const d of bacs) supprimerArbre(d)
})

const typeLien = process.platform === 'win32' ? 'junction' : 'dir'

function cibleTemoin(racine: string): string {
  const cible = join(racine, 'cible-exterieure')
  mkdirSync(join(cible, 'sous'), { recursive: true })
  writeFileSync(join(cible, 'temoin.txt'), 'x')
  writeFileSync(join(cible, 'sous', 'b.txt'), 'x')
  writeFileSync(join(cible, 'ro.txt'), 'x')
  chmodSync(join(cible, 'ro.txt'), 0o444)
  return cible
}
const contenuIntact = (cible: string): string[] => readdirSync(cible).sort()

describe('supprimerArbreAsync — mêmes cas limites que la forme synchrone', () => {
  it('rend la main à la boucle pendant la suppression (la raison d’être de cette forme)', async () => {
    const d = join(bac(), 'lourd')
    for (let i = 0; i < 200; i++) {
      mkdirSync(join(d, `d${i % 10}`), { recursive: true })
      writeFileSync(join(d, `d${i % 10}`, `f${i}.txt`), 'x')
    }
    let tours = 0
    let actif = true
    const tourner = (): void => {
      if (!actif) return
      tours += 1
      setImmediate(tourner)
    }
    setImmediate(tourner)
    await supprimerArbreAsync(d)
    actif = false
    expect(existsSync(d)).toBe(false)
    expect(tours).toBeGreaterThan(20)
  })

  it('cas 1 nominal : dossier avec sous-dossiers et fichiers, tout part', async () => {
    const d = join(bac(), 'arbre')
    mkdirSync(join(d, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(d, 'a', 'b', 'c', 'f.txt'), 'x')
    writeFileSync(join(d, 'g.txt'), 'x')
    await supprimerArbreAsync(d)
    expect(existsSync(d)).toBe(false)
  })

  it('cas 2 absent : succès silencieux', async () => {
    await expect(supprimerArbreAsync(join(bac(), 'n-existe-pas'))).resolves.toBeUndefined()
  })

  it('cas 3-4 refus : vide, relatif et dossier courant rejetés, rien n’est supprimé', async () => {
    await expect(supprimerArbreAsync('')).rejects.toThrow(/chemin vide/)
    await expect(supprimerArbreAsync('relatif/x')).rejects.toThrow(/relatif/)
    await expect(supprimerArbreAsync(process.cwd())).rejects.toThrow(/dossier courant/)
  })

  it('cas 5 le chemin EST une jonction : seul le lien part, la cible reste intacte (3 essais sur 3)', async () => {
    for (let essai = 0; essai < 3; essai++) {
      const racine = bac()
      const cible = cibleTemoin(racine)
      const avant = contenuIntact(cible)
      const lien = join(racine, 'lien')
      symlinkSync(cible, lien, typeLien)
      await supprimerArbreAsync(lien)
      expect(existsSync(lien)).toBe(false)
      expect(contenuIntact(cible)).toEqual(avant)
    }
  })

  it('cas 6 jonction à l’intérieur, en profondeur : la copie part, la cible reste intacte (3 essais sur 3)', async () => {
    for (let essai = 0; essai < 3; essai++) {
      const racine = bac()
      const cible = cibleTemoin(racine)
      const avant = contenuIntact(cible)
      const copie = join(racine, 'copie')
      mkdirSync(join(copie, 'profond', 'encore'), { recursive: true })
      writeFileSync(join(copie, 'a.txt'), 'x')
      symlinkSync(cible, join(copie, 'node_modules'), typeLien)
      symlinkSync(cible, join(copie, 'profond', 'encore', 'node_modules'), typeLien)
      await supprimerArbreAsync(copie)
      expect(existsSync(copie)).toBe(false)
      expect(contenuIntact(cible)).toEqual(avant)
    }
  })

  it('cas 7 lecture seule : un vrai dépôt git avec commit est supprimé', async () => {
    const depot = join(bac(), 'depot')
    mkdirSync(depot)
    const git = (...args: string[]): void => {
      execFileSync('git', args, { cwd: depot, stdio: 'ignore' })
    }
    git('init', '-q')
    git('config', 'user.email', 'test@exemple.invalid')
    git('config', 'user.name', 'test')
    writeFileSync(join(depot, 'f.txt'), 'bonjour')
    git('add', '.')
    git('commit', '-qm', 'init')
    const objets = join(depot, '.git', 'objects')
    const unObjet = readdirSync(objets)
      .filter((n) => n.length === 2)
      .map((n) => join(objets, n, readdirSync(join(objets, n))[0]))[0]
    expect(statSync(unObjet).mode & 0o200).toBe(0)
    await supprimerArbreAsync(depot)
    expect(existsSync(depot)).toBe(false)
  })

  /** Tient `fichier` ouvert sans partage ; ne rend la main qu'une fois le verrou posé. */
  async function verrouiller(fichier: string, dureeMs: number): Promise<ChildProcess> {
    const ps = spawn(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `$s=[IO.File]::Open('${fichier}','Open','Read','None'); [Console]::Out.WriteLine('pret'); [Console]::Out.Flush(); Start-Sleep -Milliseconds ${dureeMs}; $s.Close()`
      ],
      { stdio: ['ignore', 'pipe', 'ignore'] }
    )
    await new Promise<void>((ok, ko) => {
      ps.stdout?.on('data', (b: Buffer) => b.toString().includes('pret') && ok())
      ps.once('exit', () => ko(new Error('le verrou PowerShell est mort avant d’être posé')))
    })
    return ps
  }
  const finDe = (p: ChildProcess): Promise<unknown> =>
    new Promise((r) => (p.exitCode !== null ? r(null) : p.once('exit', r)))

  it.runIf(process.platform === 'win32')(
    'cas 8 verrou durable : rejet qui nomme le fichier bloqué, après un nombre d’essais borné',
    async () => {
      const d = join(bac(), 'verrou-durable')
      mkdirSync(d)
      writeFileSync(join(d, 'libre.txt'), 'x')
      writeFileSync(join(d, 'tenu.txt'), 'x')
      const ps = await verrouiller(join(d, 'tenu.txt'), 30000)
      try {
        const debut = Date.now()
        const erreur = await supprimerArbreAsync(d, { tentatives: 3, pauseMs: 20 }).then(
          () => undefined,
          (e: unknown) => e
        )
        expect(erreur).toBeInstanceOf(Error)
        expect((erreur as NodeJS.ErrnoException).code).toBe('EBUSY')
        expect(String((erreur as Error).message)).toContain('tenu.txt')
        expect(Date.now() - debut).toBeLessThan(5000)
        expect(existsSync(join(d, 'tenu.txt'))).toBe(true)
      } finally {
        ps.kill()
        await finDe(ps)
      }
      await supprimerArbreAsync(d, { tentatives: 60, pauseMs: 50 })
      expect(existsSync(d)).toBe(false)
    },
    20000
  )

  it('cas 10 appel répété : le 2e appel réussit sans rien faire', async () => {
    const d = join(bac(), 'deux-fois')
    mkdirSync(d)
    writeFileSync(join(d, 'f.txt'), 'x')
    await supprimerArbreAsync(d)
    await expect(supprimerArbreAsync(d)).resolves.toBeUndefined()
    expect(existsSync(d)).toBe(false)
  })

  it('cas 11 le chemin est un fichier en lecture seule : supprimé', async () => {
    const f = join(bac(), 'seul.txt')
    writeFileSync(f, 'x')
    chmodSync(f, 0o444)
    await supprimerArbreAsync(f)
    expect(existsSync(f)).toBe(false)
  })
})
