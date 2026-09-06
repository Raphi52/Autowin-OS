import { describe, expect, it } from 'vitest'
import type { Msg } from './chat-view-types'
import { deciderRelanceAuto, lireCiblesScout } from './chat-auto-mode'

/*
 * MULTI-PISTES — `CIBLES:` fait ce que le bouton « Lancer le workflow complet sur la selection »
 * fait a la main : engager PLUSIEURS pistes d'un scout en un seul envoi.
 *
 * Le mot-cle est DISTINCT de `CIBLE:` a dessein : la regle en vigueur est « la premiere ligne
 * CIBLE: fait foi », donc empiler des `CIBLE:` produirait un choix unique et du bruit ignore.
 *
 * Toutes les portes se testent sur la FORME, jamais sur la qualite du choix : producteur et juge
 * sont le meme modele.
 */

const scout = (...lignes: string[]): string => lignes.join('\n')

describe('lireCiblesScout — la ligne CIBLES:', () => {
  it('lit plusieurs pistes separees par des virgules', () => {
    expect(lireCiblesScout(scout('CIBLES: durcir la porte, ranger les journaux'))).toEqual({
      statut: 'cibles',
      cibles: ['durcir la porte', 'ranger les journaux']
    })
  })

  it('accepte les autres separateurs et les decorations de mise en forme', () => {
    expect(lireCiblesScout('**CIBLES :** `relire le cache` · ranger les journaux ; trier')).toEqual({
      statut: 'cibles',
      cibles: ['relire le cache', 'ranger les journaux', 'trier']
    })
  })

  it('une seule piste reste valide', () => {
    expect(lireCiblesScout('CIBLES: durcir la porte')).toEqual({
      statut: 'cibles',
      cibles: ['durcir la porte']
    })
  })

  it('AUCUNE ligne CIBLES: → « absente », pour que la lecture de CIBLE: garde la main', () => {
    expect(lireCiblesScout('CIBLE: durcir la porte')).toEqual({ statut: 'absente' })
  })

  it('`CIBLES: aucune` est une FIN, pas une piste', () => {
    expect(lireCiblesScout('CIBLES: aucune')).toEqual({ statut: 'aucune-cible' })
  })

  it('UNE seule piste destructrice arrete le LOT entier', () => {
    expect(
      lireCiblesScout('CIBLES: ranger les journaux, supprimer les dossiers de run')
    ).toEqual({ statut: 'cible-destructrice', cible: 'supprimer les dossiers de run' })
  })

  it('des NUMEROS seuls ne nomment rien hors du tableau → refus nomme', () => {
    expect(lireCiblesScout('CIBLES: 1, 3, 4')).toEqual({ statut: 'cibles-non-nommees' })
  })

  it('la PREMIERE ligne CIBLES: fait foi', () => {
    expect(lireCiblesScout(scout('CIBLES: a, b', 'CIBLES: c'))).toEqual({
      statut: 'cibles',
      cibles: ['a', 'b']
    })
  })
})

const agent = (texte: string): Msg =>
  ({ role: 'assistant', content: texte, parts: [{ kind: 'text', text: texte }] }) as unknown as Msg
const humain = (texte: string): Msg => ({ role: 'user', content: texte }) as Msg

const base = {
  actif: true,
  occupe: false,
  dernierTourTraite: null,
  dernierPromptEnvoye: null,
  brouillonPresent: false
}

const CLOTURE = '👉 Recommandé — enchaîne sur les pistes retenues'

describe('deciderRelanceAuto — CIBLES: n’agit QUE sous mode auto', () => {
  it('mode auto ETEINT : aucune ligne CIBLES: ne declenche quoi que ce soit', () => {
    const fil = [humain('scout'), agent(`CIBLES: a, b\n${CLOTURE}`)]
    expect(deciderRelanceAuto({ ...base, actif: false, fil, tourEstUnScout: true })).toEqual({
      action: 'attendre',
      raison: 'inactif'
    })
  })

  it('la suite PART et porte les pistes retenues, numerotees', () => {
    const fil = [humain('scout'), agent(`CIBLES: durcir la porte, ranger les journaux\n${CLOTURE}`)]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision.action).toBe('envoyer')
    expect(decision).toHaveProperty('texte', expect.stringContaining('CIBLES RETENUES'))
    expect(decision).toHaveProperty('texte', expect.stringContaining('1. durcir la porte'))
    expect(decision).toHaveProperty('texte', expect.stringContaining('2. ranger les journaux'))
  })

  it('un lot contenant une piste destructrice ne part JAMAIS tout seul', () => {
    const fil = [humain('scout'), agent(`CIBLES: ranger, supprimer les runs\n${CLOTURE}`)]
    expect(deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })).toMatchObject({
      action: 'arreter',
      raison: 'cible-destructrice'
    })
  })

  it('des numeros seuls arretent la chaine avec une raison NOMMEE', () => {
    const fil = [humain('scout'), agent(`CIBLES: 1, 3, 4\n${CLOTURE}`)]
    expect(deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })).toMatchObject({
      action: 'arreter',
      raison: 'cibles-non-nommees'
    })
  })

  it('NON-REGRESSION : sans CIBLES:, la ligne CIBLE: commande comme avant', () => {
    const fil = [humain('scout'), agent(`CIBLE: durcir la porte\n${CLOTURE}`)]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision.action).toBe('envoyer')
    expect(decision).toHaveProperty('texte', expect.stringContaining('CIBLE RETENUE : durcir la porte'))
  })

  it('CIBLES: prime sur une ligne CIBLE: presente dans le meme livrable', () => {
    const fil = [humain('scout'), agent(`CIBLE: durcir la porte\nCIBLES: a, b\n${CLOTURE}`)]
    const decision = deciderRelanceAuto({ ...base, fil, tourEstUnScout: true })
    expect(decision).toHaveProperty('texte', expect.stringContaining('CIBLES RETENUES'))
    expect(decision).toHaveProperty('texte', expect.not.stringContaining('CIBLE RETENUE :'))
  })
})
