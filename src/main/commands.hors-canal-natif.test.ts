import { describe, expect, it } from 'vitest'
import { CATALOG } from './commands'
import { outilsDuChat } from './chat-mcp'

/**
 * L'EXCLUSION DU CANAL DIRECT EST ECRITE SUR LA COMMANDE, PAS DANS UNE SECONDE LISTE.
 *
 * Le chat sert les commandes du catalogue comme outils directs du modele (`chat-mcp.ts`). Deux
 * familles restent au texte `<cmd>` :
 *  - `orchestrate` et `ask` : leurs regles (un seul run par message, la tache = le dernier message
 *    de l'utilisateur, une seule question par tour, le tour se ferme sur la question) ne vivent que
 *    dans la boucle texte du pilote ;
 *  - les sept commandes de fichiers : le modele a deja ses propres outils pour ca, et elles ont
 *    servi 0 fois sur 222 commandes du chat (journaux du 25/09 au 10/10).
 */
const ATTENDUES = [
  'ask',
  'create_file',
  'delete_file',
  'edit_file',
  'find_in_files',
  'list_files',
  'move_file',
  'orchestrate',
  'read_file'
]

describe('catalogue — commandes gardees hors du canal direct', () => {
  it('exactement les neuf commandes prevues portent un motif d exclusion', () => {
    const exclues = CATALOG.filter((c) => c.horsCanalNatif !== undefined)
      .map((c) => c.name)
      .sort()
    expect(exclues).toEqual(ATTENDUES)
  })

  it('chaque motif est une phrase lisible (il est rendu au modele dans le refus)', () => {
    for (const c of CATALOG.filter((s) => s.horsCanalNatif !== undefined)) {
      expect(c.horsCanalNatif!.trim().length).toBeGreaterThan(10)
    }
  })

  it('jumeau : les commandes utiles au chat restent servies en direct', () => {
    const servies = outilsDuChat(CATALOG)
    for (const nom of ['remember', 'brain_query', 'desktop_observe', 'desktop_act', 'get_state']) {
      expect(servies).toContain(nom)
    }
    for (const nom of ATTENDUES) expect(servies).not.toContain(nom)
  })
})
