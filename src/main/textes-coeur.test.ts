import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { configureAutowinAppDataBase } from './app-data'
import { ecrireLangueReglee } from './langue-reglage'
import { TEXTES_COEUR_EN, TEXTES_COEUR_FR, traduireCoeur, type CleCoeur } from './textes-coeur'

/**
 * LA TABLE DES TEXTES DU PROCESSUS PRINCIPAL (conv-1170, lot 18). Une racine de données à soi : la
 * racine des tests est partagée entre fichiers joués en parallèle, un `langue.json` à `en` laissé là
 * ferait parler anglais les tests des autres.
 */
let racine: string
beforeEach(() => {
  racine = mkdtempSync(join(tmpdir(), 'textes-coeur-'))
  configureAutowinAppDataBase(racine)
})
afterEach(() => {
  configureAutowinAppDataBase(undefined)
  rmSync(racine, { recursive: true, force: true })
})

const valeursNommees = (texte: string): string[] =>
  [...texte.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe('table des textes du cœur FR / EN', () => {
  it('les deux langues ont exactement les mêmes clés, et aucun texte vide', () => {
    expect(Object.keys(TEXTES_COEUR_EN).sort()).toEqual(Object.keys(TEXTES_COEUR_FR).sort())
    for (const [cle, texte] of Object.entries(TEXTES_COEUR_EN)) {
      expect(texte.trim(), `anglais vide : ${cle}`).not.toBe('')
    }
  })

  it('chaque texte anglais attend les mêmes {valeurs} que son français', () => {
    for (const cle of Object.keys(TEXTES_COEUR_FR) as CleCoeur[]) {
      expect(valeursNommees(TEXTES_COEUR_EN[cle]), cle).toEqual(
        valeursNommees(TEXTES_COEUR_FR[cle])
      )
    }
  })

  it('sans réglage : le français ; anglais réglé : l’anglais ; relu à chaque appel, sans redémarrage', () => {
    expect(traduireCoeur('carte.etatPret')).toBe('Réponse prête')
    ecrireLangueReglee('en')
    expect(traduireCoeur('carte.etatPret')).toBe('Answer ready')
    ecrireLangueReglee('fr')
    expect(traduireCoeur('carte.etatPret')).toBe('Réponse prête')
  })

  it('un anglais absent ou vide retombe sur le français, jamais sur la clé ni un blanc', () => {
    ecrireLangueReglee('en')
    const tables = {
      fr: TEXTES_COEUR_FR,
      en: { 'carte.etatPret': '  ', 'carte.fermer': undefined }
    }
    expect(traduireCoeur('carte.etatPret', undefined, tables)).toBe('Réponse prête')
    expect(traduireCoeur('carte.fermer', undefined, tables)).toBe('Fermer')
  })

  it('remplace les valeurs nommées, une seule fois, et laisse visible une valeur oubliée', () => {
    expect(traduireCoeur('finDeTour.titrePret', { fil: 'Mon fil {fil}' })).toBe(
      'Mon fil {fil} — réponse prête'
    )
    expect(traduireCoeur('diagnostic.brain.injoignableApres', { secondes: 10 })).toBe(
      'injoignable après 10 s — {detail}'
    )
    ecrireLangueReglee('en')
    expect(traduireCoeur('reparation.impossible', { erreur: 'EPERM' })).toBe('Repair failed: EPERM')
  })
})
