import { describe, expect, it } from 'vitest'
import { SLASH_COMMANDS, matchSlashCommands, skillSlashCommands } from './chat-view-model'

/**
 * La palette `/` n'avait AUCUN test — c'est ce qui a laissé passer le défaut vécu le 2026-08-20 :
 * les skills y étaient écrites à la main, donc une skill ajoutée sur le disque (`think`, `learn`)
 * restait invisible bien qu'invocable. L'utilisateur en concluait qu'elle n'était « pas active ».
 */
describe('palette slash générique', () => {
  const inventaire = [
    { id: 'think', description: 'Charge le contexte. Puis autre chose.', enabled: true },
    { id: 'learn', description: "Écrit l'empreinte du dépôt.", enabled: true }
  ]

  it('propose une skill découverte sur disque, absente de toute liste écrite à la main', () => {
    const noms = matchSlashCommands('/', skillSlashCommands(inventaire)).map((c) => c.name)
    expect(noms).toContain('think')
    expect(noms).toContain('learn')
    // Le test DOIT tomber si quelqu'un revient à une liste figée : aucune de ces deux
    // skills n'est écrite dans SLASH_COMMANDS.
    expect(SLASH_COMMANDS.map((c) => c.name)).not.toContain('think')
  })

  it("n'invente rien quand l'inventaire est vide : la palette est alors vide", () => {
    expect(matchSlashCommands('/')).toEqual([])
  })

  it('ne propose plus /btw — retiré de la palette le 2026-08-27 (la commande reste tap-able)', () => {
    const noms = matchSlashCommands('/b', skillSlashCommands(inventaire)).map((c) => c.name)
    expect(noms).not.toContain('btw')
  })

  it('écarte une skill désactivée — proposer ce qui ne s’exécutera pas serait le même mensonge', () => {
    const noms = skillSlashCommands([
      { id: 'think', description: 'x', enabled: false },
      { id: 'learn', description: 'y', enabled: true }
    ]).map((c) => c.name)
    expect(noms).toEqual(['learn'])
  })

  it('filtre par préfixe et insère la commande complète', () => {
    const items = matchSlashCommands('/th', skillSlashCommands(inventaire))
    expect(items.map((c) => c.name)).toEqual(['think'])
    expect(items[0].insert).toBe('/think ')
  })

  it('ne double pas deux entrées homonymes de la palette', () => {
    const noms = matchSlashCommands(
      '/think',
      skillSlashCommands([
        { id: 'think', description: 'un', enabled: true },
        { id: 'think', description: 'deux', enabled: true }
      ])
    ).map((c) => c.name)
    expect(noms).toEqual(['think'])
  })

  it('borne le libellé à la première phrase : une consigne entière rendrait la palette illisible', () => {
    const [cmd] = skillSlashCommands([
      { id: 'think', description: `${'a'.repeat(200)}. Suite ignorée.`, enabled: true }
    ])
    expect(cmd.hint.length).toBeLessThanOrEqual(90)
    expect(cmd.hint).not.toContain('Suite ignorée')
  })

  it('reste fermée dès qu’un corps est tapé', () => {
    expect(matchSlashCommands('/think quelque chose', skillSlashCommands(inventaire))).toEqual([])
  })
})
