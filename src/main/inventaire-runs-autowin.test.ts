import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { GARDES_DU_HOOK, scriptHookGardes } from '../shared/garde-git-destructeur'
import { descriptionDuFrontMatter } from './native-registry'
import { gardesInjecteesAutowin, modsAutowin } from './inventaire-runs-autowin'
import { listClaudeHooks } from './claude-hooks'
import { listCapabilities } from './capability-controls'

describe('vue Skills — description du front-matter (source unique)', () => {
  it('rend la description repliée au lieu de « >- »', () => {
    expect(descriptionDuFrontMatter('---\nname: a\ndescription: >-\n  Prend UNE tâche\n  et la mesure.\n---')).toBe(
      'Prend UNE tâche et la mesure.'
    )
  })
  it("ne coupe plus à l'apostrophe", () => {
    expect(descriptionDuFrontMatter("---\ndescription: À utiliser quand l'utilisateur veut X\n---")).toBe(
      "À utiliser quand l'utilisateur veut X"
    )
  })
  it('absente → undefined', () => expect(descriptionDuFrontMatter('---\nname: a\n---')).toBeUndefined())
})

describe('vue Hooks — gardes réellement injectées dans les runs', () => {
  it("l'inventaire nomme EXACTEMENT les gardes appelées par le script", () => {
    const script = scriptHookGardes(() => undefined)
    const corps = script.slice(script.indexOf("process.stdin.on('end'"))
    const appelees = new Set([...corps.matchAll(/\b(refus\w+)\(/g)].map((m) => m[1]))
    expect(new Set(GARDES_DU_HOOK.map((g) => g.fn))).toEqual(appelees)
  })
  it('listClaudeHooks commence par les 10 gardes Autowin, avec leur matcher', () => {
    const h = listClaudeHooks()
    expect(h.slice(0, 10).map((x) => x.id)).toEqual(gardesInjecteesAutowin().map((x) => x.id))
    expect(h.find((x) => x.id === 'autowin-garde-refusBoucle')!.matcher).toContain('Read')
    expect(h.find((x) => x.id === 'autowin-garde-refusArretHote')!.matcher).toContain('PowerShell')
  })
})

describe('vue Plugins — le mod Autowin', () => {
  // Supprimés même quand une assertion échoue (piège des dossiers temporaires laissés en test).
  const temporaires: string[] = []
  afterEach(() => {
    for (const d of temporaires.splice(0)) rmSync(d, { recursive: true, force: true })
  })
  it('trouvé : description du manifeste et événements lus dans son code', async () => {
    const p = await listCapabilities('plugins')
    const mod = p.find((x) => x.id === 'autowin-mod')!
    expect(mod.enabled).toBe(true)
    expect(mod.description).toContain('bureau caché')
    // Les trois événements du module que nomme hooks.json (register.js), dont le retrait du compte
    // à rebours de tokens (conv-1602, piste 12 du scout).
    expect(mod.description).toContain('Événements : tool.call, prompt.attachment, tool.describe.')
  })
  // fix-ok: 3 édits pour poser un seul cas (imports, afterEach, cas) ; cause mesurée avant correctif : modsAutowin lisait hooks/register.mjs en dur et rendait « leurre.mort » (conv-1602)
  it('lit le module nommé par hooks.json, pas un nom écrit en dur', () => {
    // Leurre : un register.mjs que hooks.json ne nomme pas. Lu en dur, il donnerait « leurre.mort ».
    const racine = mkdtempSync(join(tmpdir(), 'aos-inventaire-mod-'))
    temporaires.push(racine)
    const mod = join(racine, 'mods', 'autowin')
    mkdirSync(join(mod, '.claude-plugin'), { recursive: true })
    mkdirSync(join(mod, 'hooks'))
    writeFileSync(join(mod, '.claude-plugin', 'plugin.json'), '{"description":"Mod d’essai."}')
    writeFileSync(join(mod, 'hooks', 'hooks.json'), '{"modules":["./charge.js"]}')
    writeFileSync(
      join(mod, 'hooks', 'charge.js'),
      "export function register(on) { on('vrai.evenement', () => {}) }"
    )
    writeFileSync(
      join(mod, 'hooks', 'register.mjs'),
      "export function register(on) { on('leurre.mort', () => {}) }"
    )
    const [lu] = modsAutowin([racine])
    expect(lu.description).toContain('Événements : vrai.evenement.')
    expect(lu.description).not.toContain('leurre.mort')
  })
  it('introuvable : dit que les runs partent sans lui', () => {
    const [mod] = modsAutowin([join('Z:', 'nulle-part')])
    expect(mod.enabled).toBe(false)
    expect(mod.description).toMatch(/INTROUVABLE/)
  })
})

describe('vue Gates — contrôles de fin de run', async () => {
  const { GATES_DU_RUN } = await import('./inventaire-runs-autowin')
  const { createDefaultHookBus } = await import('./hooks/default-gate-hooks')
  const { existsSync } = await import('node:fs')
  it('autant de gates « bus » que de contrôles pre-green réellement enregistrés', () => {
    expect(GATES_DU_RUN.filter((g) => g.bus).length).toBe(createDefaultHookBus().count('pre-green'))
  })
  it('chaque source citée existe', () => {
    for (const g of GATES_DU_RUN) expect(existsSync(g.source), g.source).toBe(true)
  })
  it('la vue les liste en lecture seule', async () => {
    const g = await listCapabilities('gates')
    expect(g.length).toBe(GATES_DU_RUN.length)
    expect(g.every((x) => !x.mutable)).toBe(true)
  })
})
