import { existsSync, mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DOSSIER_A_EPARGNER,
  PREFIXES_VIVANTS_DE_LAPP,
  nettoyerDossiersTemporairesDeTest,
  purgerDossiersTemporairesAnciens
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
  /**
   * MARGE de `TOLERANCE_HORLOGE_MS` : mesure du 2026-09-04, ce test tombait 2 fois sur 5 sans elle.
   * La date de naissance rendue par le systeme de fichiers peut etre arrondie QUELQUES ms EN DESSOUS
   * de `Date.now()` — le dossier passait alors pour anterieur au run. Le defaut etait dans l'horloge
   * du test, pas dans la garde.
   */
  const TOLERANCE_HORLOGE_MS = 1_000

  it('supprime un dossier de test créé pendant le run', () => {
    const racine = racineJouet()
    const debut = Date.now() - TOLERANCE_HORLOGE_MS
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

  /**
   * INCIDENT du 2026-09-04 : l'application tourne sur le MEME poste que la suite. Ses dossiers
   * temporaires d'appel (`autowin-os-settings-…`) naissent donc PENDANT le run de tests, et la
   * garde « né pendant ce run » les livrait a la suppression. Resultat : 10 appels au CLI claude
   * tues en `exit 1` sur « Settings file not found », dont un freeze vu par l'utilisateur.
   */
  it('épargne les dossiers de vie de l’application, même nés pendant le run', () => {
    const racine = racineJouet()
    const debut = Date.now()
    const vivants = PREFIXES_VIVANTS_DE_LAPP.map((prefixe) => dossier(racine, `${prefixe}AbCd12`))

    const resultat = nettoyerDossiersTemporairesDeTest(racine, debut)

    for (const chemin of vivants) {
      expect(existsSync(chemin), 'un appel provider en cours ne doit jamais être amputé').toBe(true)
    }
    expect(resultat.supprimes).toEqual([])
  })

  it('une racine absente ne fait pas échouer la suite', () => {
    const resultat = nettoyerDossiersTemporairesDeTest(
      join(tmpdir(), 'autowin-racine-qui-nexiste-pas-000'),
      Date.now()
    )

    expect(resultat).toEqual({ supprimes: [], epargnes: [], echecs: [] })
  })
})

describe('purge bornee par l age', () => {
  const JOUR = 24 * 60 * 60 * 1000

  /**
   * On ne peut pas VIEILLIR un dossier sous Windows : `utimes` deplace la date de modification, pas
   * la date de NAISSANCE, et la purge retient la plus recente des deux (un dossier ancien mais
   * ecrit a l'instant est vivant). On avance donc l'horloge passee a la fonction — meme calcul,
   * cas limite teste pour de vrai.
   */
  it('supprime un residu `aos-` plus vieux que la borne', () => {
    const racine = racineJouet()
    const cible = dossier(racine, 'aos-chatsess-AbCdEf')

    const resultat = purgerDossiersTemporairesAnciens(racine, Date.now() + 3 * JOUR, JOUR)

    expect(resultat.supprimes).toContain('aos-chatsess-AbCdEf')
    expect(existsSync(cible)).toBe(false)
  })

  it('epargne un dossier recent, meme au bon prefixe', () => {
    const racine = racineJouet()
    const cible = dossier(racine, 'autowin-paris-AbCdEf')

    const resultat = purgerDossiersTemporairesAnciens(racine, Date.now(), JOUR)

    expect(resultat.epargnes).toContain('autowin-paris-AbCdEf')
    expect(existsSync(cible)).toBe(true)
  })

  it('epargne un dossier VIVANT de l application, meme ancien', () => {
    const racine = racineJouet()
    const cible = dossier(racine, `${PREFIXES_VIVANTS_DE_LAPP[0]}AbCdEf`)

    purgerDossiersTemporairesAnciens(racine, Date.now() + 30 * JOUR, JOUR)

    expect(existsSync(cible), 'un reglage de CLI ne doit jamais partir').toBe(true)
  })

  it('epargne la racine de donnees isolee des tests, meme ancienne', () => {
    const racine = racineJouet()
    const cible = dossier(racine, DOSSIER_A_EPARGNER)

    const resultat = purgerDossiersTemporairesAnciens(racine, Date.now() + 30 * JOUR, JOUR)

    expect(resultat.epargnes).toContain(DOSSIER_A_EPARGNER)
    expect(existsSync(cible)).toBe(true)
  })
})
