import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ISSUES_CONNUES } from './issue-de-refus'
import { TEXTES_FR } from '../renderer/src/textes-ecrans/worktrees-et-bureaux'

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

/**
 * Les libellés que les sorties promettent, et la clé de la table de textes qui les rend.
 * Depuis la traduction anglaise (lot « Worktrees et Bureaux cachés », conv-1186, 2026-10-27), le
 * composant ne porte plus le libellé en dur : il rend `t('<clé>')`, et le français fait foi dans
 * `textes-ecrans/worktrees-et-bureaux.ts`. Le lien TEXTE ↔ PRODUIT se vérifie donc en deux temps :
 * le bouton rend bien cette clé, et cette clé dit bien, en français, le geste promis (salvage conv-1211).
 */
const GESTES_PROMIS = [
  ['Voir le diff', 'conserves.voirDiff'],
  ['Reprendre', 'conserves.reprendre'],
  ['Purger', 'conserves.purger']
] as const

describe('issue-de-refus — les gestes nommés existent vraiment', () => {
  const source = readFileSync(COMPOSANT, 'utf8')
  // Le formateur met le libelle sur sa propre ligne, entre le chevron ouvrant et la balise
  // fermante. On replie donc les espaces AVANT de chercher : sans ca le test passerait a cote du
  // rendu reel, et on serait tente d'assouplir l'assertion en cherchant le texte n'importe ou --
  // y compris dans un commentaire, ce qui ne garderait plus rien.
  const rendu = source.replace(/\s+/g, ' ')

  it('chaque geste promis par une sortie est rendu par un bouton', () => {
    for (const [geste, cle] of GESTES_PROMIS) {
      expect(TEXTES_FR[cle], `la clé ${cle} ne dit plus « ${geste} »`).toBe(geste)
      expect(rendu, `« ${geste} » est promis mais n'est rendu nulle part`).toContain(
        `> {t('${cle}')} </button>`
      )
    }
  })

  it('la section citée par les sorties porte bien ce nom dans le produit', () => {
    const citee = Object.values(ISSUES_CONNUES).some((issue) =>
      issue.includes('Bureaux conserves')
    )
    expect(citee, 'aucune sortie ne cite la section — ce test ne garde plus rien').toBe(true)
    // Accents absents côté message (source ASCII) : on compare sur le nom rendu, pas sur la casse.
    expect(TEXTES_FR['conserves.titre']).toBe('Bureaux conservés')
    expect(source).toContain("{t('conserves.titre')}")
  })

  it('aucune sortie ne renvoie vers un « bouton de nettoyage », qui n’a jamais existé', () => {
    for (const [motif, issue] of Object.entries(ISSUES_CONNUES)) {
      expect(issue, `« ${motif} » ressuscite un geste inexistant`).not.toMatch(
        /bouton de nettoyage/i
      )
    }
  })
})
