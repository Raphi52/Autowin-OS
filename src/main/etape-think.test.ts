import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { messageEmpreinteBrain } from './brain-empreinte-message'

/**
 * L'ÉTAPE QUI CHARGE LE CONTEXTE S'APPELLE `think`, et celle qui capitalise `learn`.
 *
 * SIGNALÉ par l'utilisateur le 2026-08-25 : le fil des sous-agents affichait « load : empreinte
 * chargée » alors que l'étape porte le nom `think`. Ce n'était pas qu'un libellé : en vérifiant, les
 * skills `load` et `save` N'EXISTENT PAS sur disque (`skills/` contient `think` et `learn`), et le
 * même message renvoyait l'utilisateur vers `/save` — une commande supprimée. Le déclenchement
 * automatique de la capitalisation a été retiré le 2026-08-20 à sa demande, et le code lui-même
 * renvoie depuis vers `learn`. Le fil montrait donc deux noms morts.
 *
 * POURQUOI UN TEST PLUTÔT QU'UN SIMPLE RENOMMAGE : un nom qui pointe vers une commande inexistante
 * est un mensonge qui ne se voit qu'à l'usage. La garde ci-dessous relie le texte affiché aux skills
 * RÉELLEMENT présentes sur disque — elle aurait attrapé `/save` le jour de sa suppression.
 */

const RACINE = join(__dirname, '..', '..')
const orchestrateur = readFileSync(join(__dirname, 'orchestrator.ts'), 'utf8')

describe('l’étape de chargement de contexte s’appelle `think`', () => {
  it('le fil des sous-agents affiche `think`, pas `load`', () => {
    expect(orchestrateur).toContain("role: 'think'")
    expect(orchestrateur).not.toContain("role: 'load'")
  })

  it('les détails affichés portent le même nom, quel que soit le sort du Brain', () => {
    /*
     * TESTÉ SUR LA SORTIE, plus sur le texte source de l'orchestrateur.
     *
     * Ce test cherchait `/think : empreinte chargée/` DANS `orchestrator.ts`. Le libellé a
     * déménagé dans `brain-empreinte-message.ts` le 2026-08-31 (le message distingue désormais
     * « la base ne sait rien » d'« on n'a pas pu lui demander ») : le test est tombé rouge alors
     * que le comportement qu'il protège était intact, et il serait resté vert si le libellé avait
     * été renommé `load` à l'intérieur du nouveau module.
     *
     * Ce qu'il garde, c'est l'invariant : CHAQUE détail affiché nomme l'étape `think`, et aucun ne
     * ressuscite `load`. Le vérifier sur les quatre sorts possibles du Brain couvre les trois
     * branches ajoutées, qu'un grep de source ne voyait pas.
     */
    const sorts = [
      messageEmpreinteBrain('found', 1_200),
      messageEmpreinteBrain('empty', 0),
      messageEmpreinteBrain('unavailable', 0),
      messageEmpreinteBrain('invalid', 0)
    ]
    expect(sorts).toHaveLength(4)
    for (const sort of sorts) {
      expect(sort.detail).toMatch(/^think : /)
      expect(sort.detail).not.toMatch(/load/)
      expect(sort.text).not.toMatch(/\/save\b/)
    }
    // Le cas nominal reste nommé explicitement : c'est la ligne que l'utilisateur lit le plus.
    expect(messageEmpreinteBrain('found', 1_200).detail).toBe('think : empreinte chargée')
  })
})

describe('les noms d’étape affichés correspondent à des skills RÉELLES', () => {
  it('`think` et `learn` existent sur disque', () => {
    expect(existsSync(join(RACINE, 'skills', 'think'))).toBe(true)
    expect(existsSync(join(RACINE, 'skills', 'learn'))).toBe(true)
  })

  it('`load` et `save` n’existent PAS — les nommer serait renvoyer vers du vide', () => {
    // La mesure qui a motivé ce test : ces deux dossiers ont disparu, et le code les citait encore.
    expect(existsSync(join(RACINE, 'skills', 'load'))).toBe(false)
    expect(existsSync(join(RACINE, 'skills', 'save'))).toBe(false)
  })

  it('aucune commande citée dans ce message ne pointe vers une skill absente', () => {
    // La garde GÉNÉRALE, celle qui survit au prochain renommage : on relie le texte au disque.
    const commandes = [...orchestrateur.matchAll(/\/(think|learn|load|save)\b/g)].map((m) => m[1])
    for (const commande of new Set(commandes)) {
      expect(existsSync(join(RACINE, 'skills', commande))).toBe(true)
    }
  })
})
