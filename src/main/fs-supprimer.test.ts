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
import { dirname, join, parse, relative } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { motifDeRefus, supprimerArbre } from './fs-supprimer'

/**
 * Un cas de test par cas limite du cadrage (conv-108, 2026-10-05). Les cas 5, 6 et 7 sont ceux
 * où `fs.rmSync({ recursive: true })` d'Electron 44.5.1 (Node 24) détruit ou échoue : remplacer
 * `supprimerArbre` par un `rmSync` brut doit faire rougir ces tests sous ce Node-là.
 */

const bacs: string[] = []
function bac(): string {
  const d = mkdtempSync(join(tmpdir(), 'autowin-fs-supprimer-'))
  bacs.push(d)
  return d
}
afterAll(() => {
  for (const d of bacs) supprimerArbre(d)
})

const typeLien = process.platform === 'win32' ? 'junction' : 'dir'

/** Une cible « extérieure » avec un témoin, un sous-dossier et un fichier en lecture seule. */
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

describe('supprimerArbre — cas limites', () => {
  it('cas 1 nominal : dossier avec sous-dossiers et fichiers, tout part', () => {
    const d = join(bac(), 'arbre')
    mkdirSync(join(d, 'a', 'b', 'c'), { recursive: true })
    writeFileSync(join(d, 'a', 'b', 'c', 'f.txt'), 'x')
    writeFileSync(join(d, 'g.txt'), 'x')
    supprimerArbre(d)
    expect(existsSync(d)).toBe(false)
  })

  it('cas 2 absent : succès silencieux', () => {
    expect(() => supprimerArbre(join(bac(), 'n-existe-pas'))).not.toThrow()
  })

  it('cas 3 vide : chemin vide ou blanc refusé explicitement', () => {
    expect(() => supprimerArbre('')).toThrow(/chemin vide/)
    expect(() => supprimerArbre('   ')).toThrow(/chemin vide/)
  })

  it('cas 4 mal typé / dangereux : relatif refusé et la cible survit ; racine, dossier courant et ses parents refusés', () => {
    const d = join(bac(), 'garde')
    mkdirSync(d)
    writeFileSync(join(d, 'f.txt'), 'x')
    const relatif = relative(process.cwd(), d)
    // Sur un autre lecteur, `relative` rend un chemin absolu : le cas ne s'appliquerait pas.
    if (!parse(relatif).root) {
      expect(() => supprimerArbre(relatif)).toThrow(/relatif/)
      expect(existsSync(join(d, 'f.txt'))).toBe(true)
    }
    // Garde testée sur la fonction PURE : jamais d'appel réel de suppression sur ces chemins.
    expect(motifDeRefus(undefined)).toMatch(/mal typé/)
    expect(motifDeRefus(parse(process.cwd()).root)).toMatch(/racine/)
    expect(motifDeRefus(process.cwd())).toMatch(/dossier courant/)
    expect(motifDeRefus(dirname(process.cwd()))).toMatch(/dossier courant/)
    // Jumeau accepté : un dossier ordinaire hors du dossier courant passe.
    expect(motifDeRefus(d)).toBeNull()
  })

  it('cas 5 le chemin EST une jonction : seul le lien part, la cible reste intacte (3 essais sur 3)', () => {
    for (let essai = 0; essai < 3; essai++) {
      const racine = bac()
      const cible = cibleTemoin(racine)
      const avant = contenuIntact(cible)
      const lien = join(racine, 'lien')
      symlinkSync(cible, lien, typeLien)
      supprimerArbre(lien)
      expect(existsSync(lien)).toBe(false)
      expect(contenuIntact(cible)).toEqual(avant)
    }
  })

  it('cas 6 jonction à l’intérieur, en profondeur : la copie part, la cible reste intacte (3 essais sur 3)', () => {
    for (let essai = 0; essai < 3; essai++) {
      const racine = bac()
      const cible = cibleTemoin(racine)
      const avant = contenuIntact(cible)
      const copie = join(racine, 'copie')
      mkdirSync(join(copie, 'profond', 'encore'), { recursive: true })
      writeFileSync(join(copie, 'a.txt'), 'x')
      symlinkSync(cible, join(copie, 'node_modules'), typeLien)
      symlinkSync(cible, join(copie, 'profond', 'encore', 'node_modules'), typeLien)
      supprimerArbre(copie)
      expect(existsSync(copie)).toBe(false)
      expect(contenuIntact(cible)).toEqual(avant)
    }
  })

  it('cas 7 lecture seule : un vrai dépôt git avec commit est supprimé', () => {
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
    // Le cas n'a de valeur que si git a bien posé la lecture seule.
    expect(statSync(unObjet).mode & 0o200).toBe(0)
    const fichierRo = join(depot, 'ro.txt')
    writeFileSync(fichierRo, 'x')
    chmodSync(fichierRo, 0o444)
    supprimerArbre(depot)
    expect(existsSync(depot)).toBe(false)
  })

  /**
   * Tient `fichier` ouvert SANS partage (comme un antivirus ou un éditeur), et ne rend la main
   * qu'une fois le verrou réellement posé : un processus dont le dossier courant est la cible ne
   * verrouille qu'après son démarrage complet (mesuré : EBUSY à 300 ms, rien juste après `spawn`).
   * fix-ok: le test « verrou durable » était rouge car le verrou n'était pas encore posé au moment de la suppression — mesuré : EBUSY à 300 ms, aucun juste après spawn ; on attend désormais le signal du processus.
   */
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
    'cas 8 verrou passager : un fichier tenu ouvert finit supprimé une fois libéré',
    async () => {
      const d = join(bac(), 'verrou-passager')
      mkdirSync(d)
      writeFileSync(join(d, 'tenu.txt'), 'x')
      const ps = await verrouiller(join(d, 'tenu.txt'), 400)
      supprimerArbre(d, { tentatives: 60, pauseMs: 50 })
      expect(existsSync(d)).toBe(false)
      await finDe(ps)
    },
    20000
  )

  it.runIf(process.platform === 'win32')(
    'cas 8 verrou durable : erreur qui nomme le fichier bloqué, après un nombre d’essais borné ; le reste part',
    async () => {
      const d = join(bac(), 'verrou-durable')
      mkdirSync(d)
      writeFileSync(join(d, 'libre.txt'), 'x')
      writeFileSync(join(d, 'tenu.txt'), 'x')
      const ps = await verrouiller(join(d, 'tenu.txt'), 30000)
      try {
        const debut = Date.now()
        let erreur: unknown
        try {
          supprimerArbre(d, { tentatives: 3, pauseMs: 20 })
        } catch (e) {
          erreur = e
        }
        expect(erreur).toBeInstanceOf(Error)
        expect((erreur as NodeJS.ErrnoException).code).toBe('EBUSY')
        expect(String((erreur as Error).message)).toContain('tenu.txt')
        expect(Date.now() - debut).toBeLessThan(5000)
        expect(existsSync(join(d, 'tenu.txt'))).toBe(true)
      } finally {
        ps.kill()
        await finDe(ps)
      }
      supprimerArbre(d, { tentatives: 60, pauseMs: 50 })
      expect(existsSync(d)).toBe(false)
    },
    20000
  )

  it('cas 9 chemin très long (plus de 260 caractères) : supprimé', () => {
    const racine = join(bac(), 'long')
    let d = racine
    for (let i = 0; i < 30; i++) d = join(d, `dossier-assez-long-${i}`)
    mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'f.txt'), 'x')
    expect(d.length).toBeGreaterThan(260)
    supprimerArbre(racine)
    expect(existsSync(racine)).toBe(false)
  })

  it('cas 10 appel répété : le 2e appel réussit sans rien faire', () => {
    const d = join(bac(), 'deux-fois')
    mkdirSync(d)
    writeFileSync(join(d, 'f.txt'), 'x')
    supprimerArbre(d)
    expect(() => supprimerArbre(d)).not.toThrow()
    expect(existsSync(d)).toBe(false)
  })

  it('cas 11 le chemin est un fichier en lecture seule : supprimé', () => {
    const f = join(bac(), 'seul.txt')
    writeFileSync(f, 'x')
    chmodSync(f, 0o444)
    supprimerArbre(f)
    expect(existsSync(f)).toBe(false)
  })
})
