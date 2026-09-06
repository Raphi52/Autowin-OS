import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { racineDepot } from './racine-depot.mjs'

/*
 * LES SONDES NAVIGUENT PAR LA PASTILLE, JAMAIS PAR UN LIBELLE.
 *
 * Cause commune prouvee TROIS fois le 2026-09-06, sur trois sondes differentes :
 *  - « Memory » est le TITRE de la vue, l'entree de menu s'appelle « Knowledge » ;
 *  - le texte de l'entree Chat vaut « 💬Chat » a cause de l'icone, jamais « Chat ».
 * Dans les deux cas le clic ne partait PAS, et la sonde echouait plus loin sur une absence de
 * contenu — en laissant croire a un defaut du produit. Deux d'entre elles etaient rouges depuis des
 * semaines pour cette seule raison.
 *
 * Un identifiant de test ne suit ni le libelle ni l'icone. Cette garde empeche la prochaine sonde
 * de repartir sur un texte de navigation.
 */
const racine = racineDepot()
const dossier = join(racine, 'scripts')

/** Les vues de la barre de navigation : ce sont ELLES qui doivent se cliquer par pastille. */
const VUES = [
  'Accueil',
  'Chat',
  'Agent Studio',
  'Knowledge',
  'Memory',
  'Observatory',
  'Task Manager',
  'Worktrees',
  'Tickets',
  'Tests',
  'Settings'
]

describe('navigation des sondes cdp-*', () => {
  it('aucune sonde ne clique une VUE par son libelle', () => {
    const fautifs = []
    for (const nom of readdirSync(dossier)) {
      if (!nom.startsWith('cdp-') || !nom.endsWith('.mjs') || nom.includes('.test.')) continue
      const lignes = readFileSync(join(dossier, nom), 'utf8').split('\n')
      lignes.forEach((ligne, index) => {
        // On ne vise que la recherche d'un BOUTON par son texte : le reste (libelles de
        // conversation, boutons d'action comme « Créer la tâche ») n'est pas de la navigation.
        if (!/querySelectorAll\('button'\)/.test(ligne)) return
        const voisinage = lignes.slice(index, index + 4).join(' ')
        const vue = VUES.find((v) => voisinage.includes(`'${v}'`) || voisinage.includes(`"${v}"`))
        if (vue) fautifs.push(`${nom}:${index + 1} → ${vue}`)
      })
    }

    expect(fautifs).toEqual([])
  })
})
