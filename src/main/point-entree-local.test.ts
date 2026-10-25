import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG } from './commands'
import {
  COMMANDES_POINT_ENTREE,
  demarrerPointEntreeLocal,
  FICHIER_POINT_ENTREE,
  type PointEntreeLocal
} from './point-entree-local'

/**
 * Point d'entrée local permanent (conv-1144) : un script extérieur crée un fil, y lance un tour et
 * le relit, par le MÊME protocole que les outils du chat. Ces tests ouvrent le vrai serveur sur un
 * port local et lui parlent par `fetch` : asynchrone, donc sans le blocage d'un `spawnSync` vers un
 * serveur du même processus.
 */
const aFermer: PointEntreeLocal[] = []
const aEffacer: string[] = []
afterEach(async () => {
  while (aFermer.length) await aFermer.pop()!.arreter()
  while (aEffacer.length) rmSync(aEffacer.pop()!, { recursive: true, force: true })
})

async function ouvrir(exec = vi.fn(async () => ({ ok: true, data: { lu: true } }))) {
  const dossier = mkdtempSync(join(tmpdir(), 'point-entree-'))
  aEffacer.push(dossier)
  const point = await demarrerPointEntreeLocal({
    dossierDonnees: dossier,
    catalogue: () => CATALOG,
    exec
  })
  aFermer.push(point)
  const description = JSON.parse(readFileSync(point.fichier, 'utf8'))
  // `null` = aucun jeton envoyé (un `undefined` reprendrait la valeur par défaut).
  // fix-ok: conv-1144 — le cas « sans jeton » rendait 200 au lieu de 401 : passer `undefined` à
  // `appeler` déclenchait la valeur par défaut, donc le VRAI jeton partait ; `null` le retire.
  const appeler = (corps: unknown, jeton: string | null = description.jeton) =>
    fetch(description.url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(jeton ? { 'x-autowin-token': jeton } : {})
      },
      body: JSON.stringify(corps)
    })
  return { dossier, point, description, exec, appeler }
}

describe('point d’entrée local — ce qu’il sert', () => {
  it('publie EXACTEMENT les trois commandes, prises dans le vrai catalogue', async () => {
    const { appeler } = await ouvrir()
    const r = await appeler({ jsonrpc: '2.0', id: 1, method: 'tools/list' })
    expect(r.status).toBe(200)
    const noms = ((await r.json()).result.tools as Array<{ name: string }>).map((t) => t.name)
    expect(noms.sort()).toEqual([...COMMANDES_POINT_ENTREE].sort())
  })

  it('refuse une commande hors liste SANS l’exécuter', async () => {
    const { appeler, exec } = await ouvrir()
    const r = await appeler({
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'remove_conversation', arguments: { id: 'conv-1' } }
    })
    const corps = await r.json()
    expect(corps.result.isError).toBe(true)
    expect(corps.result.content[0].text).toContain('REFUSÉ')
    expect(exec).not.toHaveBeenCalled()
  })

  it('transmet une commande servie au bus, avec ses arguments', async () => {
    const { appeler, exec } = await ouvrir()
    const r = await appeler({
      jsonrpc: '2.0',
      id: 3,
      method: 'tools/call',
      params: { name: 'conversation_read', arguments: { id: 'conv-1', derniers: '1' } }
    })
    const corps = await r.json()
    expect(corps.result.isError).toBe(false)
    expect(JSON.parse(corps.result.content[0].text)).toEqual({ lu: true })
    expect(exec).toHaveBeenCalledWith('conversation_read', { id: 'conv-1', derniers: '1' })
  })

  it('répond 401 sans jeton, et avec un faux jeton', async () => {
    const { appeler, exec } = await ouvrir()
    const liste = { jsonrpc: '2.0', id: 4, method: 'tools/list' }
    expect((await appeler(liste, null)).status).toBe(401)
    expect((await appeler(liste, 'faux-jeton')).status).toBe(401)
    expect(exec).not.toHaveBeenCalled()
  })
})

describe('point d’entrée local — le fichier qui donne l’adresse', () => {
  it('existe après le démarrage avec adresse locale, port et jeton, puis disparaît à l’arrêt', async () => {
    const { point, description } = await ouvrir()
    expect(existsSync(point.fichier)).toBe(true)
    expect(point.fichier.endsWith(FICHIER_POINT_ENTREE)).toBe(true)
    expect(description.url).toBe(`http://127.0.0.1:${point.port}/mcp`)
    expect(description.port).toBeGreaterThan(0)
    expect(typeof description.jeton).toBe('string')
    expect(description.jeton.length).toBeGreaterThan(10)
    await point.arreter()
    expect(existsSync(point.fichier)).toBe(false)
    // Arrêt idempotent : un second appel ne jette pas.
    await expect(point.arreter()).resolves.toBeUndefined()
  })

  it('ne retire PAS le fichier écrit entre-temps par une autre instance', async () => {
    const { point } = await ouvrir()
    writeFileSync(point.fichier, JSON.stringify({ jeton: 'celui-d-une-autre-instance' }), 'utf8')
    await point.arreter()
    expect(existsSync(point.fichier)).toBe(true)
  })

  it('ferme le serveur si le fichier ne peut pas être écrit', async () => {
    const arreter = vi.fn(async () => undefined)
    const demarrer = vi.fn(async () => ({
      url: 'http://127.0.0.1:1/mcp',
      jeton: 'j',
      port: 1,
      configMcp: () => '',
      nomsExposes: () => [],
      arreter
    }))
    await expect(
      demarrerPointEntreeLocal({
        dossierDonnees: join(tmpdir(), 'dossier-qui-n-existe-pas-1144', 'encore'),
        catalogue: () => CATALOG,
        exec: async () => ({ ok: true }),
        demarrer
      })
    ).rejects.toThrow()
    expect(arreter).toHaveBeenCalledTimes(1)
  })
})
