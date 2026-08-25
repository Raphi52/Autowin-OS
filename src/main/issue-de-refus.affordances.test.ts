import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ISSUES_CONNUES } from './issue-de-refus'

/**
 * UN REFUS NE NOMME QUE DES GESTES QUI EXISTENT.
 *
 * DÉFAUT VÉCU le 2026-08-25, quelques heures après la livraison de `issue-de-refus`. Deux sorties
 * renvoyaient l'utilisateur vers un « bouton de nettoyage » et une reprise « depuis le panneau
 * Worktrees ». Ces gestes N'EXISTAIENT PAS : `WorktreeView.tsx` n'exposait que « choisir un dépôt »
 * et « rafraîchir ». Le commit était déjà poussé.
 *
 * Orienter vers un geste impossible coûte PLUS cher qu'un refus nu : on fait chercher l'utilisateur
 * avant de le laisser devant le même mur, et on abîme la confiance dans tous les autres messages.
 * C'est la même famille de défaut qu'un garde qui ne garde plus — un libellé qui ment.
 *
 * Ce test lie le TEXTE au PRODUIT : chaque libellé de bouton cité dans une sortie doit se retrouver
 * dans le composant qui le rend. Il échouera si quelqu'un renomme un bouton sans reprendre le
 * message, ou promet un geste avant de l'avoir construit.
 */
const COMPOSANT = join(__dirname, '..', 'renderer', 'src', 'components', 'BureauxConserves.tsx')

/** Les libellés que les sorties promettent, tels qu'ils doivent apparaître dans le rendu. */
const GESTES_PROMIS = ['Voir le diff', 'Reprendre', 'Purger'] as const

describe('issue-de-refus — les gestes nommés existent vraiment', () => {
  const source = readFileSync(COMPOSANT, 'utf8')
  // Le formateur met le libelle sur sa propre ligne, entre le chevron ouvrant et la balise
  // fermante. On replie donc les espaces AVANT de chercher : sans ca le test passerait a cote du
  // rendu reel, et on serait tente d'assouplir l'assertion en cherchant le texte n'importe ou --
  // y compris dans un commentaire, ce qui ne garderait plus rien.
  const rendu = source.replace(/\s+/g, ' ')

  it('chaque geste promis par une sortie est rendu par un bouton', () => {
    for (const geste of GESTES_PROMIS) {
      expect(rendu, `« ${geste} » est promis mais n'est rendu nulle part`).toContain(
        `> ${geste} </button>`
      )
    }
  })

  it('la section citée par les sorties porte bien ce nom dans le produit', () => {
    const citee = Object.values(ISSUES_CONNUES).some((issue) =>
      issue.includes('Bureaux conserves')
    )
    expect(citee, 'aucune sortie ne cite la section — ce test ne garde plus rien').toBe(true)
    // Accents absents côté message (source ASCII) : on compare sur le nom rendu, pas sur la casse.
    expect(source).toContain('Bureaux conservés')
  })

  it('aucune sortie ne renvoie vers un « bouton de nettoyage », qui n’a jamais existé', () => {
    for (const [motif, issue] of Object.entries(ISSUES_CONNUES)) {
      expect(issue, `« ${motif} » ressuscite un geste inexistant`).not.toMatch(
        /bouton de nettoyage/i
      )
    }
  })
})
