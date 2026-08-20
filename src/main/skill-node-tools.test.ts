import { describe, expect, it, vi } from 'vitest'
import {
  OUTILS_NOEUD_SKILL,
  compteRenduDesOutils,
  demandeUnOutil,
  executerOutilsDuNoeud
} from './skill-node-tools'

/**
 * Un nœud skill recevait « appelle remember » sans disposer de l'outil : il décrivait l'action au
 * lieu de l'accomplir. Ces tests gardent les deux propriétés qui comptent — l'appel a bien lieu, et
 * `orchestrate` ne passe jamais.
 */
const cmd = (name: string, args: Record<string, unknown>): string =>
  `<cmd>${JSON.stringify({ name, args })}</cmd>`

describe('outils d’un nœud skill', () => {
  it('exécute une commande autorisée avec ses arguments', async () => {
    const exec = vi.fn(async () => ({ ok: true, data: 'déposé' }))
    const appels = await executerOutilsDuNoeud(
      `Je capitalise.\n${cmd('remember', { title: 'Empreinte', fact: 'le dépôt fait X' })}`,
      { exec }
    )
    expect(exec).toHaveBeenCalledWith('remember', { title: 'Empreinte', fact: 'le dépôt fait X' })
    expect(appels).toEqual([
      expect.objectContaining({ name: 'remember', refuse: false, ok: true, resultat: 'déposé' })
    ])
  })

  it('REFUSE orchestrate — un nœud ne relance pas un run depuis l’intérieur d’un run', async () => {
    const exec = vi.fn(async () => ({ ok: true }))
    const appels = await executerOutilsDuNoeud(cmd('orchestrate', { task: 'refais tout' }), {
      exec
    })
    expect(exec).not.toHaveBeenCalled()
    expect(appels).toEqual([expect.objectContaining({ name: 'orchestrate', refuse: true })])
    expect(OUTILS_NOEUD_SKILL).not.toContain('orchestrate')
  })

  it('un refus est RENDU, pas avalé : un refus muet ferait croire au modèle qu’il a agi', async () => {
    const appels = await executerOutilsDuNoeud(cmd('edit_file', { path: 'x' }), {
      exec: async () => ({ ok: true })
    })
    expect(compteRenduDesOutils(appels)).toContain('REFUSÉ')
  })

  it('un outil qui jette ne fait pas tomber le run : l’échec devient une information', async () => {
    const appels = await executerOutilsDuNoeud(cmd('brain_query', { query: 'empreinte' }), {
      exec: async () => {
        throw new Error('brain injoignable')
      }
    })
    expect(appels[0]).toMatchObject({ name: 'brain_query', ok: false, erreur: 'brain injoignable' })
    expect(compteRenduDesOutils(appels)).toContain('brain injoignable')
  })

  it('rend le RÉSULTAT au modèle — sans quoi brain_query ne servirait à rien', async () => {
    const appels = await executerOutilsDuNoeud(cmd('brain_query', { query: 'empreinte' }), {
      exec: async () => ({ ok: true, data: 'le dépôt est un cockpit Electron' })
    })
    expect(compteRenduDesOutils(appels)).toContain('le dépôt est un cockpit Electron')
  })

  it('borne un résultat généreux plutôt que de noyer le tour suivant', async () => {
    const appels = await executerOutilsDuNoeud(cmd('brain_query', { query: 'x' }), {
      exec: async () => ({ ok: true, data: 'a'.repeat(20_000) })
    })
    const rendu = compteRenduDesOutils(appels)
    expect(rendu.length).toBeLessThan(6_000)
    expect(rendu).toContain('…')
  })

  it('un texte sans commande ne déclenche aucun tour : la boucle est un no-op sans coût', () => {
    expect(demandeUnOutil('Voici mon livrable, sans commande.')).toBe(false)
    expect(demandeUnOutil(cmd('remember', { title: 't', fact: 'f' }))).toBe(true)
    // Une commande NON autorisée n’ouvre pas non plus de tour d’outil.
    expect(demandeUnOutil(cmd('orchestrate', { task: 't' }))).toBe(false)
  })

  it('aucun appel → compte rendu vide, donc pas de tour supplémentaire', () => {
    expect(compteRenduDesOutils([])).toBe('')
  })
})
