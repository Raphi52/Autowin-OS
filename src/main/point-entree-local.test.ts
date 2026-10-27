import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CATALOG } from './commands'
import {
  COMMANDES_POINT_ENTREE,
  demarrerPointEntreeLocal,
  FICHIER_POINT_ENTREE,
  MARQUE_SCRIPT,
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

  /*
   * conv-1144 (cadrage, périmètre « dedans ») : un tour lancé par un script doit se voir comme tel
   * dans le fil — pour l'utilisateur qui relit, et pour l'agent qui sait d'où vient la demande.
   */
  it('marque « lancé par un script » le message de chat_send, en tête', async () => {
    const { appeler, exec } = await ouvrir()
    await appeler({
      jsonrpc: '2.0',
      id: 5,
      method: 'tools/call',
      params: { name: 'chat_send', arguments: { message: 'corrige X', conversationId: 'conv-1' } }
    })
    const [, args] = exec.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(args.conversationId).toBe('conv-1')
    expect(String(args.message).startsWith(MARQUE_SCRIPT)).toBe(true)
    expect(String(args.message).endsWith('corrige X')).toBe(true)
  })

  it('garde « /skill » en tête : la marque passe alors à la fin', async () => {
    const { appeler, exec } = await ouvrir()
    await appeler({
      jsonrpc: '2.0',
      id: 6,
      method: 'tools/call',
      params: {
        name: 'chat_send',
        arguments: { message: '/frame cadre ça', conversationId: 'conv-1' }
      }
    })
    const [, args] = exec.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(String(args.message).startsWith('/frame cadre ça')).toBe(true)
    expect(String(args.message)).toContain(MARQUE_SCRIPT)
  })

  /*
   * conv-1144 (cadrage, point resté ouvert) : sans fil, `chat_send` part en simple question au
   * modèle (commands.ts, `case 'chat_send'`) — aucun tour, rien à attendre, et un appel payé. Le bus
   * lit un identifiant vide ou fait d'espaces comme « pas de fil » : les trois formes sont refusées.
   */
  it('refuse chat_send sans conversationId (absent, vide ou espaces) SANS l’exécuter', async () => {
    const { appeler, exec } = await ouvrir()
    for (const [id, args] of [
      [7, { message: 'bonjour' }],
      [8, { message: 'bonjour', conversationId: '' }],
      [9, { message: 'bonjour', conversationId: '   ' }]
    ] as const) {
      const corps = await (
        await appeler({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: 'chat_send', arguments: args }
        })
      ).json()
      expect(corps.result.isError).toBe(true)
      expect(corps.result.content[0].text).toContain('REFUSÉ')
      expect(corps.result.content[0].text).toContain('conversationId')
    }
    expect(exec).not.toHaveBeenCalled()
  })

  it('répond 401 sans jeton, et avec un faux jeton', async () => {
    const { appeler, exec } = await ouvrir()
    const liste = { jsonrpc: '2.0', id: 4, method: 'tools/list' }
    expect((await appeler(liste, null)).status).toBe(401)
    expect((await appeler(liste, 'faux-jeton')).status).toBe(401)
    expect(exec).not.toHaveBeenCalled()
  })
})

/**
 * Requête HTTP brute : `fetch` ne laisse pas choisir l'en-tête `Host`. Rend le code HTTP.
 * conv-1144 (risque 1 du cadrage) : une page web ouverte dans un navigateur peut viser le port local
 * — elle porte alors un en-tête `Origin`, ou, par rebond DNS, un `Host` qui n'est pas la machine.
 */
function requeteBrute(url: string, entetes: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const cible = new URL(url)
    const req = request(
      {
        host: '127.0.0.1',
        port: Number(cible.port),
        path: cible.pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json', ...entetes }
      },
      (res) => {
        res.resume()
        resolve(res.statusCode ?? 0)
      }
    )
    req.on('error', reject)
    req.end(JSON.stringify({ jsonrpc: '2.0', id: 9, method: 'tools/list' }))
  })
}

describe('point d’entrée local — refuse les requêtes venues d’un navigateur', () => {
  it('refuse un en-tête Origin, même avec le bon jeton, sans rien exécuter', async () => {
    const { description, exec } = await ouvrir()
    const statut = await requeteBrute(description.url, {
      'x-autowin-token': description.jeton,
      origin: 'http://page-quelconque.example'
    })
    expect(statut).toBe(403)
    expect(exec).not.toHaveBeenCalled()
  })

  it('refuse un Host qui n’est pas la machine locale (rebond DNS), même avec le bon jeton', async () => {
    const { description, point } = await ouvrir()
    const statut = await requeteBrute(description.url, {
      'x-autowin-token': description.jeton,
      host: `page-quelconque.example:${point.port}`
    })
    expect(statut).toBe(403)
  })

  it('accepte 127.0.0.1 et localhost sur son port, sans Origin', async () => {
    const { description, point } = await ouvrir()
    for (const host of [`127.0.0.1:${point.port}`, `localhost:${point.port}`])
      expect(
        await requeteBrute(description.url, { 'x-autowin-token': description.jeton, host })
      ).toBe(200)
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
