import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  basculerServeurMcp,
  enregistrerIpcServeursMcp,
  enregistrerServeurMcp,
  fusionnerServeursMcp,
  lireServeursMcp,
  supprimerServeurMcp,
  validerServeurMcp,
  type ServeurMcpUtilisateur
} from './mcp-servers'
import { argumentsMcpNoeudSkill } from './claude'

const fichier = (): string => join(mkdtempSync(join(tmpdir(), 'mcp-servers-')), 'mcp-servers.json')
const blender: ServeurMcpUtilisateur = {
  id: 'blender',
  nom: 'Blender',
  commande: 'uvx',
  args: ['blender-mcp'],
  env: {},
  actif: true
}
const interne = JSON.stringify({
  mcpServers: { autowin: { type: 'http', url: 'http://127.0.0.1:1/mcp' } }
})

describe('registre des serveurs MCP (conv-1558)', () => {
  it('fichier absent : blender pré-rempli et désactivé', () => {
    const l = lireServeursMcp(fichier())
    expect(l.map((s) => s.id)).toEqual(['blender', 'images'])
    expect(l[0]).toEqual({ ...blender, actif: false })
  })

  it('images : désactivé par défaut, clés nommées et VIDES, valide et fusion sans clé écrite', () => {
    const images = lireServeursMcp(fichier()).find((s) => s.id === 'images')!
    expect(images.actif).toBe(false)
    expect(Object.keys(images.env).sort()).toEqual([
      'IMAGE_GENERATION_MCP_GOOGLE_API_KEY',
      'IMAGE_GENERATION_MCP_OPENAI_API_KEY'
    ])
    expect(Object.values(images.env).every((v) => v === '')).toBe(true)
    expect(validerServeurMcp(images)).toEqual(images)
    expect(fusionnerServeursMcp(interne, [images]).autorises).toEqual([])
    expect(fusionnerServeursMcp(interne, [{ ...images, actif: true }]).autorises).toEqual([
      'mcp__images__*'
    ])
  })

  it('valide : refuse un id réservé, un id invalide, une commande vide ; accepte le jumeau correct', () => {
    expect(validerServeurMcp({ ...blender, id: 'autowin' })).toMatch(/réservé/)
    expect(validerServeurMcp({ ...blender, id: 'A B' })).toMatch(/invalide/)
    expect(validerServeurMcp({ ...blender, commande: ' ' })).toMatch(/commande/)
    expect(validerServeurMcp({ ...blender, args: [1] })).toMatch(/args/)
    expect(validerServeurMcp(blender)).toEqual(blender)
  })

  it('enregistrer, basculer, supprimer : relu sur disque', () => {
    const f = fichier()
    expect(enregistrerServeurMcp({ ...blender, id: 'x', commande: 'npx' }, f).ok).toBe(true)
    expect(basculerServeurMcp('blender', true, f).ok).toBe(true)
    const disque = JSON.parse(readFileSync(f, 'utf8')) as ServeurMcpUtilisateur[]
    expect(disque.map((s) => [s.id, s.actif])).toEqual([
      ['blender', true],
      ['images', false],
      ['x', true]
    ])
    expect(supprimerServeurMcp('x', f).ok).toBe(true)
    expect(supprimerServeurMcp('x', f).ok).toBe(false)
    expect(lireServeursMcp(f).map((s) => s.id)).toEqual(['blender', 'images'])
  })

  it('fichier corrompu : retombe sur la liste par défaut', () => {
    const f = fichier()
    writeFileSync(f, '{pas du json')
    expect(lireServeursMcp(f).map((s) => s.id)).toEqual(['blender', 'images'])
  })

  it('fusion : un actif est ajouté et autorisé, un inactif non, le serveur interne reste', () => {
    const r = fusionnerServeursMcp(interne, [blender, { ...blender, id: 'off', actif: false }])
    const c = JSON.parse(r.config)
    expect(Object.keys(c.mcpServers)).toEqual(['autowin', 'blender'])
    expect(c.mcpServers.blender).toEqual({
      type: 'stdio',
      command: 'uvx',
      args: ['blender-mcp'],
      env: {}
    })
    expect(r.autorises).toEqual(['mcp__blender__*'])
    expect(fusionnerServeursMcp(interne, [{ ...blender, actif: false }])).toEqual({
      config: interne,
      autorises: []
    })
  })

  it('argumentsMcpNoeudSkill garde --strict-mcp-config et fusionne les serveurs actifs', () => {
    const opts = {
      skillNodeTools: { mcpConfig: interne, allowedTools: ['mcp__autowin__a'] }
    } as never
    const a = argumentsMcpNoeudSkill(opts, [blender])
    expect(a.strict).toEqual(['--strict-mcp-config'])
    expect(JSON.parse(a.mcp[1]!).mcpServers.blender.command).toBe('uvx')
    expect(a.autorises).toEqual(['mcp__autowin__a', 'mcp__blender__*'])
    expect(argumentsMcpNoeudSkill(opts, []).mcp[1]).toBe(interne)
  })

  /*
   * Garde d'expéditeur (conv-1575) : les 4 canaux étaient enregistrés SANS garde, mesuré par
   * `security-critical-fixes.test.ts` (« ne laisse AUCUN canal hors d'index.ts échapper au
   * garde », rouge sur ces 4 noms). Or `save` déclare une COMMANDE que le CLI lancera, et `list`
   * rend les clés d'API saisies dans `env`. Le garde est INJECTÉ, comme pour tickets et veille :
   * le module reste testable sans Electron. Ce faux garde accepte la seule fenêtre `fiable`.
   */
  const fiable = { expediteur: 'fenetre-autowin' }
  const hostile = { expediteur: 'page-etrangere' }
  const brancher = (f: string, vus: unknown[] = []) => {
    const h = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    enregistrerIpcServeursMcp({
      ipc: { handle: (c, fn) => h.set(c, fn) },
      assertTrusted: (event, portee) => {
        vus.push(event)
        if (event !== fiable) throw new Error(`expéditeur refusé (${portee})`)
      },
      chemin: () => f
    })
    return h
  }

  it('IPC : un expéditeur non fiable est refusé AVANT toute lecture ou écriture', () => {
    const f = fichier()
    const vus: unknown[] = []
    const h = brancher(f, vus)
    // État de départ ÉCRIT par la fenêtre fiable : blender désactivé, images présent.
    h.get('os:mcpServers:toggle')!(fiable, 'blender', false)
    const avant = readFileSync(f, 'utf8')
    // Chaque appel CHANGERAIT le fichier (ou lirait les clés) sans garde : un appel inoffensif
    // passerait même avec un garde placé après l'action, et ce test ne prouverait rien.
    const appels: [string, unknown[]][] = [
      ['os:mcpServers:list', []],
      ['os:mcpServers:save', [{ id: 'piege', commande: 'calc.exe', actif: true }]],
      ['os:mcpServers:delete', ['images']],
      ['os:mcpServers:toggle', ['blender', true]]
    ]
    for (const [canal, args] of appels) {
      // Le refus doit REMONTER (invoke rejeté), pas être avalé en `{ ok: false }` par `proteger`.
      expect(() => h.get(canal)!(hostile, ...args), canal).toThrow(/expéditeur refusé/)
    }
    expect(readFileSync(f, 'utf8')).toBe(avant)
    // Le garde a vu l'événement REÇU, une fois par canal : pas un événement fabriqué.
    expect(vus.filter((e) => e === hostile)).toHaveLength(4)
  })

  it('IPC : list/save/toggle/delete branchés', async () => {
    const f = fichier()
    const h = brancher(f)
    expect([...h.keys()].sort()).toEqual([
      'os:mcpServers:delete',
      'os:mcpServers:list',
      'os:mcpServers:save',
      'os:mcpServers:toggle'
    ])
    expect(await h.get('os:mcpServers:toggle')!(fiable, 'blender', true)).toMatchObject({
      ok: true
    })
    expect(
      await h.get('os:mcpServers:save')!(fiable, { id: 'autowin', commande: 'x' })
    ).toMatchObject({ ok: false })
    expect(await h.get('os:mcpServers:list')!(fiable)).toMatchObject({
      ok: true,
      // fix-ok: la liste par défaut compte désormais 2 serveurs (blender, images), mesuré par le rouge à cette ligne
      serveurs: [
        { id: 'blender', actif: true },
        { id: 'images', actif: false }
      ]
    })
  })
})
