import { describe, expect, it } from 'vitest'
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
  it('listClaudeHooks commence par les 7 gardes Autowin, avec leur matcher', () => {
    const h = listClaudeHooks()
    expect(h.slice(0, 7).map((x) => x.id)).toEqual(gardesInjecteesAutowin().map((x) => x.id))
    expect(h.find((x) => x.id === 'autowin-garde-refusBoucle')!.matcher).toContain('Read')
    expect(h.find((x) => x.id === 'autowin-garde-refusArretHote')!.matcher).toContain('PowerShell')
  })
})

describe('vue Plugins — le mod Autowin', () => {
  it('trouvé : description du manifeste et événements lus dans son code', async () => {
    const p = await listCapabilities('plugins')
    const mod = p.find((x) => x.id === 'autowin-mod')!
    expect(mod.enabled).toBe(true)
    expect(mod.description).toContain('bureau caché')
    expect(mod.description).toContain('tool.describe, tool.call')
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
