import { existsSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOSSIER_A_EPARGNER,
  nettoyerDossiersTemporairesDeTest
} from './temp-cleanup'

/**
 * Ces tests décrivent le nettoyage sur une racine JOUET, jamais sur le vrai dossier temporaire :
 * un test qui balaye `os.tmpdir()` pour de bon détruirait le travail des autres workers.
 */
function racineJouet(): string {
  return mkdtempSync(join(tmpdir(), 'autowin-nettoyage-harnais-'))
}

function dossier(racine: string, nom: string): string {
  const chemin = join(racine, nom)
  mkdirSync(chemin, { recursive: true })
  writeFileSync(join(chemin, 'residu.txt'), 'x'.repeat(64), 'utf8')
  return chemin
}

describe('nettoyage des dossiers temporaires de la suite de tests', () => {
  it('supprime un dossier de test créé pendant le run', () => {
    const racine = racineJouet()
    const debut = Date.now()
    const cible = dossier(racine, 'autowin-trace-large-AbCdEf')

    const resultat = nettoyerDossiersTemporairesDeTest(racine, debut)

    expect(resultat.supprimes).toContain('autowin-trace-large-AbCdEf')
    expect(existsSync(cible), 'le résidu du run doit être parti').toBe(false)
  })

  /**
   * LA GARDE QUI COMPTE. Sans elle, lancer la suite pendant qu'une autre copie de travail teste
   * effacerait ses dossiers sous ses pieds — un faux rouge impossible à diagnostiquer.
   */
  it('épargne un dossier ANTÉRIEUR au run : il appartient à quelqu’un d’autre', () => {
    const racine = racineJouet()
    const etranger = dossier(racine, 'autowin-trace-dun-autre-run')
    // Daté d'une heure avant le run courant.
    const ancien = new Date(Date.now() - 3_600_000)
    utimesSync(etranger, ancien, ancien)

    const resultat = nettoyerDossiersTemporairesDeTest(racine, Date.now() + 1_000)

    expect(resultat.supprimes).toEqual([])
    expect(existsSync(etranger), 'le dossier d’un autre run doit survivre').toBe(true)
  })

  it('épargne la racine de données isolée des tests, même créée pendant le run', () => {
    const racine = racineJouet()
    const debut = Date.now()
    const donnees = dossier(racine, DOSSIER_A_EPARGNER)

    const resultat = nettoyerDossiersTemporairesDeTest(racine, debut)

    expect(resultat.epargnes).toContain(DOSSIER_A_EPARGNER)
    expect(existsSync(donnees), 'la racine de données des tests n’est pas un résidu').toBe(true)
  })

  it('ne touche pas ce qui ne porte pas le préfixe de la suite', () => {
    const racine = racineJouet()
    const debut = Date.now()
    const voisin = dossier(racine, 'vscode-cache-XyZ')

    nettoyerDossiersTemporairesDeTest(racine, debut)

    expect(existsSync(voisin), 'un dossier étranger à Autowin doit rester intact').toBe(true)
  })

  it('une racine absente ne fait pas échouer la suite', () => {
    const resultat = nettoyerDossiersTemporairesDeTest(
      join(tmpdir(), 'autowin-racine-qui-nexiste-pas-000'),
      Date.now()
    )

    expect(resultat).toEqual({ supprimes: [], epargnes: [], echecs: [] })
  })
})
