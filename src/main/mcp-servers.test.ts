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
import { argumentsMcpNoeudSkill } from './providers/claude'

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

  it('IPC : list/save/toggle/delete branchés', async () => {
    const f = fichier()
    const h = new Map<string, (e: unknown, ...a: unknown[]) => unknown>()
    enregistrerIpcServeursMcp({ handle: (c, fn) => h.set(c, fn) }, () => f)
    expect([...h.keys()].sort()).toEqual([
      'os:mcpServers:delete',
      'os:mcpServers:list',
      'os:mcpServers:save',
      'os:mcpServers:toggle'
    ])
    expect(await h.get('os:mcpServers:toggle')!(null, 'blender', true)).toMatchObject({ ok: true })
    expect(
      await h.get('os:mcpServers:save')!(null, { id: 'autowin', commande: 'x' })
    ).toMatchObject({ ok: false })
    expect(await h.get('os:mcpServers:list')!(null)).toMatchObject({
      ok: true,
      // fix-ok: la liste par défaut compte désormais 2 serveurs (blender, images), mesuré par le rouge à cette ligne
      serveurs: [
        { id: 'blender', actif: true },
        { id: 'images', actif: false }
      ]
    })
  })
})
