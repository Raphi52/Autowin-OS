import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { autorisationsLuesDans, decisionDeCommande } from '../autorisation-commande'
import {
  cheminRegistreAutorisations,
  lireAutorisationsPermanentes,
  memoriserAutorisations
} from './autorisations-permanentes'

const racine = (): string => mkdtempSync(join(tmpdir(), 'autorisations-'))

describe('autorisations permanentes', () => {
  it('une autorisation donnée dans une conversation vaut dans les suivantes', () => {
    const dossier = racine()
    memoriserAutorisations(dossier, autorisationsLuesDans(['autorise les commandes git']))
    // Nouvelle conversation : AUCUN message utilisateur ne redonne le droit.
    const decision = decisionDeCommande('git status', [], lireAutorisationsPermanentes(dossier))
    expect(decision.autorise).toBe(true)
  })

  it('un binaire jamais nommé part quand même — plus aucune phrase à retaper', () => {
    const dossier = racine()
    memoriserAutorisations(dossier, autorisationsLuesDans(['autorise les commandes git']))
    expect(decisionDeCommande('curl x', [], lireAutorisationsPermanentes(dossier)).autorise).toBe(
      true
    )
  })

  it('un registre illisible referme le droit au lieu de l’ouvrir', () => {
    const dossier = racine()
    writeFileSync(cheminRegistreAutorisations(dossier), '{ pas du json', 'utf8')
    expect(lireAutorisationsPermanentes(dossier)).toEqual({ general: false, binaires: [] })
  })

  it('un enchaînement reste refusé même autorisé pour toujours', () => {
    const permanentes = { general: true, binaires: ['git'] }
    expect(decisionDeCommande('git status && rm -rf /', [], permanentes).autorise).toBe(false)
  })
})
