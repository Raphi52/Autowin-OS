import { mkdirSync, mkdtempSync, existsSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

import {
  nettoyerDossiersTemporairesDeTest,
  prefixesTemporairesDeLaSuite,
  prefixesVivantsDeLapp,
  purgerDossiersTemporairesAnciens
} from './temp-cleanup'

/**
 * LA FUITE QUE CECI FERME — mesuree le 2026-09-04 sur le dossier temporaire du poste :
 * 15 581 dossiers residuels, dont `gel-` (1 582), `cible-` (1 356), `ledger-refus-` (1 169),
 * `moteur-`, `flux-brut-`, `tests-view-`... AUCUN ne commence par `autowin` ni `aos-`, les deux
 * seuls prefixes que le nettoyage connaissait. Allonger la liste a la main rouvre le trou au
 * prochain test ecrit : les prefixes se LISENT donc dans le code de la suite.
 */
describe('prefixes temporaires derives du code de la suite', () => {
  it('trouve un prefixe declare dans un fichier de test, sans liste a maintenir', () => {
    const faux = mkdtempSync(join(tmpdir(), 'autowin-prefixes-derives-'))
    mkdirSync(join(faux, 'src'), { recursive: true })
    writeFileSync(
      join(faux, 'src', 'quelque-chose.test.ts'),
      "const r = mkdtempSync(join(tmpdir(), 'ledger-refus-'))\n"
    )

    const prefixes = prefixesTemporairesDeLaSuite(faux)

    expect(prefixes).toContain('ledger-refus-')
    // Trop generique pour servir de critere : ecarte.
    expect(prefixes).not.toContain('tj-')
    expect(prefixes).not.toContain('...')
    // Les deux prefixes historiques restent couverts meme si aucun fichier ne les cite.
    expect(prefixes).toContain('autowin')
    expect(prefixes).toContain('aos-')
  })

  it('supprime un dossier au prefixe derive, ne pendant le run', () => {
    // RACINE ISOLEE, JAMAIS `tmpdir()`. Mesure du 2026-09-04 : balayer le vrai dossier temporaire
    // depuis un test arrachait les depots git des autres workers en plein travail
    // (« Command failed: git init -q -b main », ~20 rouges). Le nettoyage ne borne que par
    // horodatage : il n'a aucun droit de tourner ailleurs qu'en bac a sable.
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    const cree = mkdtempSync(join(bac, 'ledger-refus-'))
    const nom = cree.slice(bac.length + 1)

    const resultat = nettoyerDossiersTemporairesDeTest(bac, Date.now() - 60_000)

    expect(resultat.supprimes).toContain(nom)
    expect(existsSync(cree)).toBe(false)
  })

  it('epargne un dossier au prefixe derive mais anterieur au run', () => {
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    const cree = mkdtempSync(join(bac, 'ledger-refus-'))
    const nom = cree.slice(bac.length + 1)

    const resultat = nettoyerDossiersTemporairesDeTest(bac, Date.now() + 60_000)

    expect(resultat.supprimes).not.toContain(nom)
    expect(existsSync(cree)).toBe(true)
  })
})

/**
 * INCIDENT du 2026-11-12 : « Le moteur modifié ne compile pas … empreinte illisible : ENOENT …
 * autowin-moteur-2CveHT\main\worktree-operation-worker.js ». Le moteur compilait : c'est la fin d'une
 * suite vitest, jouée par un autre fil, qui a supprimé le dossier de compilation de l'APP, né pendant
 * son run, entre la liste des fichiers et leur lecture. Les dossiers de l'app à épargner s'écrivaient
 * à la main : 7 préfixes, quand son code en créait une vingtaine d'autres.
 */
describe('dossiers temporaires de l application, derives de son code', () => {
  it('epargne le dossier de compilation du moteur ne pendant le run', () => {
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    const noms = [
      'autowin-moteur-2CveHT',
      'autowin-copie-a-la-demande-AbCd12',
      'autowin-photo-AbCd12',
      'image-chatgpt-AbCd12'
    ]
    for (const nom of noms) {
      mkdirSync(join(bac, nom, 'main'), { recursive: true })
      writeFileSync(join(bac, nom, 'main', 'index.js'), 'x', 'utf8')
    }

    const resultat = nettoyerDossiersTemporairesDeTest(bac, Date.now() - 60_000)

    for (const nom of noms) {
      expect(existsSync(join(bac, nom, 'main', 'index.js')), `${nom} appartient à l'app`).toBe(true)
    }
    expect(resultat.supprimes).toEqual([])
  })

  it('les epargne aussi a la purge des residus anciens', () => {
    const bac = mkdtempSync(join(tmpdir(), 'autowin-nettoyage-bac-'))
    mkdirSync(join(bac, 'autowin-moteur-AbCd12'))

    purgerDossiersTemporairesAnciens(bac, Date.now() + 30 * 24 * 60 * 60 * 1000, 1)

    expect(existsSync(join(bac, 'autowin-moteur-AbCd12'))).toBe(true)
  })

  it('lit les prefixes du code qui n est pas un test, toutes formes de mkdtemp', () => {
    const faux = mkdtempSync(join(tmpdir(), 'autowin-prefixes-derives-'))
    mkdirSync(join(faux, 'src', 'main'), { recursive: true })
    mkdirSync(join(faux, 'scripts'), { recursive: true })
    const ecrire = (chemin: string, contenu: string): void =>
      writeFileSync(join(faux, chemin), contenu, 'utf8')
    ecrire('src/main/moteur.ts', "await mkdtemp(join(tmpdir(), 'autowin-moteur-'))\n")
    ecrire('src/main/reglages.ts', "await mkdtempAsync(join(tmpdir(), 'autowin-os-settings-'))\n")
    ecrire('scripts/outil.mjs', "mkdtempSync(join(os.tmpdir(), 'image-chatgpt-'))\n")
    ecrire('src/main/moteur.test.ts', "mkdtempSync(join(tmpdir(), 'ledger-refus-'))\n")
    ecrire('src/main/banc.test-helpers.ts', "mkdtempSync(join(tmpdir(), 'autowin-wm-'))\n")
    ecrire('src/main/chaine.harness.ts', "mkdtempSync(join(tmpdir(), 'autowin-chaine-'))\n")

    const vivants = prefixesVivantsDeLapp(faux)

    expect(vivants).toEqual(
      expect.arrayContaining(['autowin-moteur-', 'autowin-os-settings-', 'image-chatgpt-'])
    )
    // Un dossier de test reste à ranger par la suite.
    expect(vivants).not.toContain('ledger-refus-')
    expect(vivants).not.toContain('autowin-wm-')
    expect(vivants).not.toContain('autowin-chaine-')
  })
})
