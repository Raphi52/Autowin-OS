import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

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
  it('aucune étape affichée ne s’appelle `load`', () => {
    expect(orchestrateur).not.toContain("role: 'load'")
  })

  it('l’étape « think : empreinte chargée » n’existe plus : c’est le nœud `think` qui cherche', () => {
    /*
     * Retirée le 2026-09-27, choix de l'utilisateur. Cette étape posait une question FIGÉE au Brain
     * à chaque run et affichait « think : empreinte chargée » ; elle ramenait 82 % du temps la même
     * note hors sujet. Le contexte vient désormais du nœud `think` (skills/think), qui reçoit la
     * liste des notes candidates et ouvre en entier celles qu'il juge nécessaires.
     */
    expect(orchestrateur).not.toContain('empreinte chargée')
    expect(existsSync(join(__dirname, 'brain-empreinte-message.ts'))).toBe(false)
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
