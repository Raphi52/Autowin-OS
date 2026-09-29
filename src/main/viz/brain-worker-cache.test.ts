import { mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { CacheParSignature, signatureGraphe } from './brain-worker-cache'

describe('le cache du worker Brain relit un graph.json reecrit', () => {
  let dossier: string
  let graphe: string

  beforeEach(() => {
    dossier = mkdtempSync(join(tmpdir(), 'brain-worker-cache-'))
    graphe = join(dossier, 'graph.json')
    writeFileSync(graphe, '{"nodes":[1,2,3]}')
  })

  afterEach(() => {
    rmSync(dossier, { recursive: true, force: true })
  })

  function chargeurCompte(valeurs: string[]): { charger: () => string; appels: () => number } {
    let n = 0
    return {
      charger: () => valeurs[n++] ?? 'epuise',
      appels: () => n
    }
  }

  it('sert la valeur en memoire tant que le fichier est inchange', async () => {
    const cache = new CacheParSignature<string>()
    const { charger, appels } = chargeurCompte(['v1', 'v2'])
    expect(await cache.obtenir('cle', graphe, charger)).toBe('v1')
    expect(await cache.obtenir('cle', graphe, charger)).toBe('v1')
    expect(appels()).toBe(1)
  })

  it('relit un graph.json reconstruit sur le MEME chemin (constat du 2026-09-29)', async () => {
    const cache = new CacheParSignature<string>()
    const { charger, appels } = chargeurCompte(['ancienne carte', 'nouvelle carte'])
    expect(await cache.obtenir('cle', graphe, charger)).toBe('ancienne carte')
    writeFileSync(graphe, '{"nodes":[1,2,3,4,5,6,7]}')
    expect(await cache.obtenir('cle', graphe, charger)).toBe('nouvelle carte')
    expect(appels()).toBe(2)
  })

  it('relit aussi un fichier de meme taille dont la date a change', async () => {
    const cache = new CacheParSignature<string>()
    const { charger, appels } = chargeurCompte(['v1', 'v2'])
    await cache.obtenir('cle', graphe, charger)
    writeFileSync(graphe, '{"nodes":[4,5,6]}')
    const avant = statSync(graphe).mtime
    utimesSync(graphe, avant, new Date(avant.getTime() + 10_000))
    expect(await cache.obtenir('cle', graphe, charger)).toBe('v2')
    expect(appels()).toBe(2)
  })

  it('garde une seule entree par cle : une reconstruction remplace, elle n empile pas', async () => {
    const cache = new CacheParSignature<string>()
    const { charger } = chargeurCompte(['v1', 'v2', 'v3'])
    await cache.obtenir('cle', graphe, charger)
    writeFileSync(graphe, '{"nodes":[1]}')
    await cache.obtenir('cle', graphe, charger)
    writeFileSync(graphe, '{"nodes":[1,2,3,4,5,6,7,8,9]}')
    await cache.obtenir('cle', graphe, charger)
    expect(cache.taille).toBe(1)
  })

  it('ne met jamais un echec en cache', async () => {
    const cache = new CacheParSignature<string>()
    let appels = 0
    const charger = (): string => {
      appels += 1
      if (appels === 1) throw new Error('lecture impossible')
      return 'relu'
    }
    await expect(cache.obtenir('cle', graphe, charger)).rejects.toThrow('lecture impossible')
    expect(await cache.obtenir('cle', graphe, charger)).toBe('relu')
  })

  it('garde le cache d un dossier de notes : son contenu imbrique se rafraichit par Rafraichir', async () => {
    const cache = new CacheParSignature<string>()
    const { charger, appels } = chargeurCompte(['v1', 'v2'])
    await cache.obtenir('cle', dossier, charger)
    writeFileSync(join(dossier, 'note.md'), '# nouvelle note')
    expect(await cache.obtenir('cle', dossier, charger)).toBe('v1')
    expect(appels()).toBe(1)
    expect(signatureGraphe(dossier)).toBe('dossier')
  })
})
