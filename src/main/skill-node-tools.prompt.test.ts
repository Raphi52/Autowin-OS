import { describe, expect, it } from 'vitest'
import { AppCommandBus } from './commands'
import { OUTILS_NOEUD_SKILL, promptOutilsNoeudSkill } from './skill-node-tools'

/**
 * Le prompt d'outillage doit décrire la commande QUE LE MODÈLE VA VRAIMENT APPELER.
 *
 * Écrit à la main, il annonçait `brain_query {"query": …}` alors que la commande attend `question`,
 * et `remember` sans `scope` ni `source` — tous deux obligatoires. Mesuré sur le run réel conv-1339 :
 * le nœud a émis sa commande, le bus l'a reçue, et elle est revenue « question manquante ou
 * invalide ». L'outil était branché, testé, et strictement inutilisable.
 *
 * Ce test confronte le prompt à la SPEC, pas à mon souvenir de la spec.
 */
const specs = (): Array<{ name: string; description: string; args: Record<string, unknown> }> =>
  new AppCommandBus({} as never, () => undefined)
    .catalog()
    .filter((c) => (OUTILS_NOEUD_SKILL as readonly string[]).includes(c.name))
    .map((c) => ({ name: c.name, description: c.description, args: c.args }))

describe('prompt d’outillage d’un nœud skill', () => {
  it('la liste blanche correspond à des commandes qui EXISTENT', () => {
    expect(specs().map((s) => s.name).sort()).toEqual([...OUTILS_NOEUD_SKILL].sort())
  })

  it('annonce le nom EXACT de chaque argument déclaré par la commande', () => {
    const rendu = promptOutilsNoeudSkill(specs())
    for (const s of specs()) {
      for (const arg of Object.keys(s.args ?? {})) {
        expect(rendu, `${s.name}.${arg} doit apparaître dans le prompt`).toContain(`"${arg}"`)
      }
    }
  })

  it('n’invente aucun argument que la commande ne connaît pas', () => {
    const rendu = promptOutilsNoeudSkill(specs())
    const connus = new Set(specs().flatMap((s) => Object.keys(s.args ?? {})))
    const annonces = [...rendu.matchAll(/^\s{4}"([^"]+)"\s:/gmu)].map((m) => m[1])
    expect(annonces.length).toBeGreaterThan(0)
    for (const a of annonces) expect(connus, `argument inconnu annoncé : ${a}`).toContain(a)
  })

  it('le cas historique : `question` et non `query`', () => {
    const rendu = promptOutilsNoeudSkill(specs())
    expect(rendu).toContain('"question"')
    expect(rendu).not.toMatch(/^\s{4}"query"\s:/mu)
  })

  it('sans catalogue, il DÉGRADE au lieu de mentir : aucun argument annoncé', () => {
    const rendu = promptOutilsNoeudSkill([])
    expect(rendu).toContain('brain_query')
    expect(rendu).not.toMatch(/^\s{4}"[^"]+"\s:/mu)
  })
})
