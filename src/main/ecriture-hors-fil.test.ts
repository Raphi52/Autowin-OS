import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * ÉCRIRE UN FICHIER ENTIER HORS DU FIL PRINCIPAL (conv-1368, 2026-10-31).
 *
 * Mesure `gels.jsonl` sur 7 jours : `renameSync` a figé la fenêtre 66,6 s, dont 16 s d'un coup, sur
 * huit petits fichiers JSON. Remplacer un fichier tout neuf peut tenir 20 s sous charge, même hors de
 * l'app (`cmd move`). Seule la sortie du fil protège la fenêtre.
 *
 * ENTRÉES QUI DOIVENT FAIRE ÉCHOUER : un appel bloquant sur le chemin normal ; une relecture qui voit
 * l'ancienne valeur ; une valeur ancienne posée après une récente ; une fermeture qui perd la dernière
 * valeur ou se fait recouvrir par une écriture déjà partie.
 */
vi.mock('node:fs', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs')>()
  return {
    ...real,
    default: real,
    renameSync: vi.fn(real.renameSync),
    writeFileSync: vi.fn(real.writeFileSync)
  }
})

/** Le disque est pilotable : `retardMs` simule le mur, `refus` un fichier tenu par un autre. */
const disque = vi.hoisted(() => ({
  retardMs: 0,
  retardEcritureMs: 0,
  /** Renommage fait par un AUTRE fil, comme le pool de Node : il finit sans la boucle d'événements. */
  renommageAutonomeMs: 0,
  refus: 0,
  ecritures: [] as string[],
  avantRenommage: undefined as undefined | (() => Promise<void>)
}))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  const { Worker } = await import('node:worker_threads')
  const attendre = async (): Promise<void> => {
    if (disque.retardMs > 0) await new Promise((resolve) => setTimeout(resolve, disque.retardMs))
  }
  const writeFile = vi.fn(async (...args: Parameters<typeof real.writeFile>) => {
    disque.ecritures.push(String(args[1]))
    if (disque.retardEcritureMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, disque.retardEcritureMs))
    }
    return real.writeFile(...args)
  })
  const rename = vi.fn(async (...args: Parameters<typeof real.rename>) => {
    if (disque.renommageAutonomeMs > 0) {
      const code = `const { workerData: d } = require('node:worker_threads')
Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, d.ms)
require('node:fs').renameSync(d.de, d.vers)`
      await new Promise((resolve) =>
        new Worker(code, {
          eval: true,
          workerData: { de: args[0], vers: args[1], ms: disque.renommageAutonomeMs }
        }).once('exit', resolve)
      )
      return
    }
    await attendre()
    await disque.avantRenommage?.()
    if (disque.refus > 0) {
      disque.refus -= 1
      throw Object.assign(new Error('EPERM: fichier tenu'), { code: 'EPERM' })
    }
    return real.rename(...args)
  })
  return { ...real, default: real, writeFile, rename }
})

// Le fichier de préparation des tests charge déjà ce module, avec le vrai disque.
vi.resetModules()
const { attendreFichier, deposerFichier, relireFichier, viderFichiersEnAttente } =
  await import('./ecriture-hors-fil')
const fsPromesses = await import('node:fs/promises')

let dir = ''
let cible = ''
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aos-hors-fil-'))
  cible = join(dir, 'magasin.json')
  disque.retardMs = 0
  disque.retardEcritureMs = 0
  disque.renommageAutonomeMs = 0
  disque.refus = 0
  disque.ecritures = []
  disque.avantRenommage = undefined
  vi.mocked(fsPromesses.rename).mockClear()
  vi.mocked(fs.renameSync).mockClear()
  vi.mocked(fs.writeFileSync).mockClear()
})
afterEach(async () => {
  await attendreFichier()
  rmSync(dir, { recursive: true, force: true })
})

describe('deposerFichier', () => {
  it('pose le fichier sans un seul appel bloquant, et sans laisser de temporaire', async () => {
    deposerFichier(cible, '{"a":1}')

    expect(await attendreFichier(cible)).toBe(true)

    expect(vi.mocked(fs.renameSync)).not.toHaveBeenCalled()
    expect(vi.mocked(fs.writeFileSync)).not.toHaveBeenCalled()
    expect(readFileSync(cible, 'utf8')).toBe('{"a":1}')
    expect(readdirSync(dir)).toEqual(['magasin.json'])
  })

  it('rend la main tout de suite même si le renommage cale, et la valeur reste lisible', async () => {
    disque.retardMs = 150
    const debut = performance.now()
    deposerFichier(cible, 'neuf')

    expect(performance.now() - debut).toBeLessThan(100)
    expect(existsSync(cible)).toBe(false)
    expect(relireFichier(cible)).toBe('neuf')
  })

  it('crée le dossier manquant', async () => {
    const profond = join(dir, 'a', 'b', 'magasin.json')
    deposerFichier(profond, 'x')
    await attendreFichier(profond)
    expect(readFileSync(profond, 'utf8')).toBe('x')
  })

  it('une rafale ne pose que sa dernière valeur', async () => {
    for (let i = 0; i < 50; i += 1) deposerFichier(cible, `v${i}`)

    await attendreFichier(cible)

    expect(disque.ecritures).toEqual(['v49'])
    expect(readFileSync(cible, 'utf8')).toBe('v49')
  })

  it('une rafale pendant un mur ne pose que la dernière valeur, après celle en vol', async () => {
    disque.retardMs = 30
    deposerFichier(cible, 'en vol')
    await new Promise((resolve) => setTimeout(resolve, 10))
    for (let i = 0; i < 50; i += 1) deposerFichier(cible, `v${i}`)

    await attendreFichier(cible)

    expect(disque.ecritures).toEqual(['en vol', 'v49'])
    expect(readFileSync(cible, 'utf8')).toBe('v49')
  })

  it('une valeur récente n’est jamais recouverte par une plus ancienne', async () => {
    disque.retardMs = 30
    deposerFichier(cible, 'ancienne')
    await new Promise((resolve) => setTimeout(resolve, 10))
    deposerFichier(cible, 'recente')

    await attendreFichier(cible)

    expect(readFileSync(cible, 'utf8')).toBe('recente')
  })

  it('deux fichiers ne s’attendent pas : un mur sur l’un n’arrête pas l’autre', async () => {
    let lacher: () => void = () => undefined
    const mur = new Promise<void>((resolve) => (lacher = resolve))
    const autre = join(dir, 'autre.json')
    disque.avantRenommage = () => (disque.ecritures.length === 1 ? mur : Promise.resolve())

    deposerFichier(cible, 'bloque')
    await new Promise((resolve) => setTimeout(resolve, 20))
    disque.avantRenommage = undefined
    deposerFichier(autre, 'libre')
    await attendreFichier(autre)

    expect(readFileSync(autre, 'utf8')).toBe('libre')
    expect(existsSync(cible)).toBe(false)
    lacher()
    await attendreFichier(cible)
  })

  it('applique le mode demandé', async () => {
    const { writeFile } = await import('node:fs/promises')
    deposerFichier(cible, 'secret', { mode: 0o600 })
    await attendreFichier(cible)
    expect(vi.mocked(writeFile).mock.lastCall?.[2]).toMatchObject({ mode: 0o600 })
  })
})

describe('relireFichier', () => {
  it('rend `undefined` pour un fichier absent, le disque quand rien n’attend', async () => {
    expect(relireFichier(cible)).toBeUndefined()
    writeFileSync(cible, 'disque', 'utf8')
    expect(relireFichier(cible)).toBe('disque')
  })

  it('voit une suppression déposée avant qu’elle soit faite', async () => {
    writeFileSync(cible, 'disque', 'utf8')
    disque.retardMs = 30
    deposerFichier(cible, 'neuf')
    deposerFichier(cible, null)

    expect(relireFichier(cible)).toBeUndefined()
    await attendreFichier(cible)
    expect(existsSync(cible)).toBe(false)
  })

  it('relit le disque une fois l’écriture posée', async () => {
    deposerFichier(cible, 'pose')
    await attendreFichier(cible)
    writeFileSync(cible, 'change par un autre', 'utf8')
    expect(relireFichier(cible)).toBe('change par un autre')
  })
})

describe('suppression déposée', () => {
  it('ne lève pas sur un fichier déjà absent', async () => {
    deposerFichier(cible, null)
    expect(await attendreFichier(cible)).toBe(true)
  })

  it('une écriture après une suppression recrée le fichier', async () => {
    deposerFichier(cible, 'un')
    deposerFichier(cible, null)
    deposerFichier(cible, 'deux')
    await attendreFichier(cible)
    expect(readFileSync(cible, 'utf8')).toBe('deux')
  })
})

describe('erreur disque', () => {
  it('garde la valeur, et le dépôt suivant la remplace et la pose', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    disque.refus = 1
    deposerFichier(cible, 'refusee')

    expect(await attendreFichier(cible)).toBe(false)
    expect(relireFichier(cible)).toBe('refusee')
    expect(readdirSync(dir)).toEqual([])

    deposerFichier(cible, 'suivante')
    expect(await attendreFichier(cible)).toBe(true)
    expect(readFileSync(cible, 'utf8')).toBe('suivante')
    avertissement.mockRestore()
  })
})

describe('viderFichiersEnAttente — la fermeture de l’app', () => {
  it('pose la dernière valeur sur place, sans attendre', () => {
    disque.retardMs = 60
    deposerFichier(cible, 'dernier mot')

    viderFichiersEnAttente()

    expect(readFileSync(cible, 'utf8')).toBe('dernier mot')
  })

  it('un renommage déjà parti atterrit d’abord : il ne recouvre pas la valeur finale', async () => {
    disque.renommageAutonomeMs = 80
    deposerFichier(cible, 'ancienne')
    await vi.waitFor(() => expect(vi.mocked(fsPromesses.rename)).toHaveBeenCalled())
    deposerFichier(cible, 'finale')

    viderFichiersEnAttente()

    expect(readFileSync(cible, 'utf8')).toBe('finale')
    await new Promise((resolve) => setTimeout(resolve, 120))
    expect(readFileSync(cible, 'utf8')).toBe('finale')
    expect(readdirSync(dir)).toEqual(['magasin.json'])
  })

  it('une écriture pas encore renommée s’efface : rien n’atterrit après la fermeture', async () => {
    disque.retardEcritureMs = 30
    deposerFichier(cible, 'ancienne')
    await new Promise((resolve) => setTimeout(resolve, 5))
    deposerFichier(cible, 'finale')
    viderFichiersEnAttente()

    await new Promise((resolve) => setTimeout(resolve, 60))

    expect(vi.mocked(fsPromesses.rename)).not.toHaveBeenCalled()
    expect(readFileSync(cible, 'utf8')).toBe('finale')
    expect(readdirSync(dir)).toEqual(['magasin.json'])
  })

  it('applique aussi une suppression en attente', () => {
    writeFileSync(cible, 'disque', 'utf8')
    disque.retardMs = 60
    deposerFichier(cible, null)
    viderFichiersEnAttente()
    expect(existsSync(cible)).toBe(false)
  })

  it('pose une valeur que le disque avait refusée', async () => {
    const avertissement = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    disque.refus = 1
    deposerFichier(cible, 'refusee')
    await attendreFichier(cible)

    viderFichiersEnAttente()

    expect(readFileSync(cible, 'utf8')).toBe('refusee')
    avertissement.mockRestore()
  })

  it('un fichier impossible à poser n’empêche pas les suivants, et ne lève pas', () => {
    const erreur = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bloque = join(dir, 'bloque.json')
    mkdirSync(`${bloque}`)
    mkdirSync(join(bloque, 'plein'))
    disque.retardMs = 60
    deposerFichier(bloque, 'x')
    deposerFichier(cible, 'y')

    expect(() => viderFichiersEnAttente()).not.toThrow()

    expect(readFileSync(cible, 'utf8')).toBe('y')
    erreur.mockRestore()
  })

  it('l’app peut encore écrire après : la sortie annulée repart normalement', async () => {
    deposerFichier(cible, 'avant')
    viderFichiersEnAttente()
    deposerFichier(cible, 'apres')
    await attendreFichier(cible)
    expect(readFileSync(cible, 'utf8')).toBe('apres')
  })

  it('ne touche à rien quand rien n’attend', () => {
    viderFichiersEnAttente()
    expect(vi.mocked(fs.renameSync)).not.toHaveBeenCalled()
  })
})
