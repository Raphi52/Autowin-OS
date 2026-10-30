import { spawnSync } from 'node:child_process'
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmdirSync,
  symlinkSync,
  truncateSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeEach, describe, expect, it } from 'vitest'
import { supprimerArbre } from '../src/main/fs-supprimer.ts'
import { estCibleDestructrice } from '../src/shared/scout-cible-lecture.ts'
import { purgerLesCorbeilles } from './gc-purger-corbeilles.mjs'

/*
 * UNE SUPPRESSION QUI NE SE RATTRAPE PAS (conv-1341, 2026-10-30) : chaque refus a ici son jumeau
 * accepté, et tous les tests travaillent dans un dossier jetable. Les noms et les contenus viennent
 * des vraies corbeilles : celle du 29/10 porte deux sauvegardes de `conversations.json`, et un calcul
 * en millisecondes donne 14,04 jours du 16/10 au 30/10 à cause du changement d'heure du 25/10.
 */
const SCRIPT = fileURLToPath(new URL('./gc-purger-corbeilles.mjs', import.meta.url))
const MAINTENANT = new Date(2026, 9, 30, 8, 0, 0)
const VIEILLE = '2026-10-15'

let racine
let accord
let journal

beforeEach(() => {
  const donnees = mkdtempSync(join(tmpdir(), 'autowin-gc-purge-'))
  racine = join(donnees, 'gc-corbeille')
  mkdirSync(racine)
  mkdirSync(join(donnees, 'autowin-os'))
  accord = join(donnees, 'autowin-os', 'gc-purge-auto.json')
  journal = join(donnees, 'autowin-os', 'gc-purges.jsonl')
})

function corbeille(nom, { manifeste = 'chemin\t12\tmotif\n', fichiers = {} } = {}) {
  const dossier = join(racine, nom)
  mkdirSync(dossier, { recursive: true })
  if (manifeste !== null) writeFileSync(join(dossier, 'MANIFEST.txt'), manifeste)
  writeFileSync(join(dossier, 'autowin-os-journal.jsonl'), 'contenu')
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    mkdirSync(dirname(join(dossier, chemin)), { recursive: true })
    writeFileSync(join(dossier, chemin), contenu)
  }
  return dossier
}

const accepter = () => writeFileSync(accord, '{"enabled":true}')
const passe = (extra = {}) => purgerLesCorbeilles({ racine, maintenant: MAINTENANT, ...extra })
const lignesDuJournal = () =>
  existsSync(journal)
    ? readFileSync(journal, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : []

function lancer(...args) {
  const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, ...args], { encoding: 'utf8' })
  return { code: r.status, sortie: r.stdout, erreur: r.stderr }
}

describe('gc-purger-corbeilles — paramètres', () => {
  it.each([
    ['absente', []],
    ['vide', ['--racine', '']],
    ['relative', ['--racine', 'gc-corbeille']],
    ['sans valeur', ['--racine']],
    ['d’un autre nom', ['--racine', join(tmpdir(), 'pas-la-corbeille')]]
  ])('racine %s : refus, code 2', (_cas, args) => {
    const r = lancer(...args)
    expect(r.code).toBe(2)
    expect(r.erreur).toMatch(/racine|argument|option/iu)
  })

  it('une racine au mauvais nom ne supprime rien, même avec un accord à côté', () => {
    const autre = join(dirname(racine), 'autre')
    mkdirSync(join(autre, VIEILLE), { recursive: true })
    writeFileSync(join(autre, VIEILLE, 'MANIFEST.txt'), 'x')
    accepter()
    expect(lancer('--racine', autre).code).toBe(2)
    expect(existsSync(join(autre, VIEILLE))).toBe(true)
  })

  it('le seuil ne se règle pas : une option de plus est refusée, rien ne part', () => {
    corbeille(VIEILLE)
    accepter()
    expect(lancer('--racine', racine, '--jours', '0').code).toBe(2)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  it('le jumeau : la bonne racine passe, et le script dit son résultat en JSON', () => {
    corbeille(VIEILLE)
    const r = lancer('--racine', racine)
    expect(r.code).toBe(0)
    expect(JSON.parse(r.sortie).mode).toBe('lecture-seule')
  })

  it('une racine qui est un lien est refusée : on ne purge pas ce qu’elle vise', () => {
    const cible = mkdtempSync(join(tmpdir(), 'autowin-gc-cible-'))
    mkdirSync(join(cible, VIEILLE))
    writeFileSync(join(cible, VIEILLE, 'MANIFEST.txt'), 'x')
    rmdirSync(racine)
    symlinkSync(cible, racine, 'junction')
    accepter()
    const bilan = passe()
    expect(bilan.code).toBe(2)
    expect(existsSync(join(cible, VIEILLE))).toBe(true)
  })

  it.each([
    ['absente', () => rmdirSync(racine)],
    ['vide', () => undefined]
  ])('corbeille générale %s : « Rien à purger », code 0', (_cas, preparer) => {
    preparer()
    accepter()
    expect(passe()).toMatchObject({ code: 0, message: 'Rien à purger', purgees: [], aPurger: [] })
    expect(lignesDuJournal()).toEqual([])
  })
})

describe('gc-purger-corbeilles — accord', () => {
  it('sans accord : la liste et le poids, code 0, rien de supprimé', () => {
    corbeille(VIEILLE)
    const bilan = passe()
    expect(bilan).toMatchObject({ code: 0, mode: 'lecture-seule', purgees: [] })
    expect(bilan.aPurger).toMatchObject([{ nom: VIEILLE, jours: 15 }])
    expect(bilan.aPurger[0].octets).toBeGreaterThan(0)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
    expect(lignesDuJournal()).toEqual([])
  })

  it.each([
    ['chaîne', '{"enabled":"true"}'],
    ['nombre', '{"enabled":1}'],
    ['faux', '{"enabled":false}'],
    ['valeur nue', 'true'],
    ['nul', 'null'],
    ['JSON cassé', '{ enabled'],
    ['vide', '']
  ])('accord illisible ou mal typé (%s) : traité comme absent', (_cas, contenu) => {
    corbeille(VIEILLE)
    writeFileSync(accord, contenu)
    expect(passe()).toMatchObject({ code: 0, mode: 'lecture-seule' })
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  it('le jumeau : un accord écrit avec un BOM reste un accord', () => {
    corbeille(VIEILLE)
    writeFileSync(accord, '\uFEFF{"enabled":true}')
    expect(passe()).toMatchObject({ code: 0, mode: 'purge' })
    expect(existsSync(join(racine, VIEILLE))).toBe(false)
  })

  it('un accord retiré ne vaut plus pour la passe suivante', () => {
    corbeille('2026-10-14')
    accepter()
    passe()
    expect(existsSync(join(racine, '2026-10-14'))).toBe(false)
    corbeille(VIEILLE)
    unlinkSync(accord)
    expect(passe()).toMatchObject({ mode: 'lecture-seule', purgees: [] })
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })
})

/*
 * « OUI, PURGE CETTE FOIS » (conv-1341, 30/10) : cette réponse passait par une suppression tapée à la
 * main, sans ligne au journal et sans aucun contrôle sur le chemin. Elle passe maintenant par la même
 * passe que l'accord permanent, et n'en garde que le geste : elle ne crée aucun accord.
 */
describe('gc-purger-corbeilles — une seule fois', () => {
  // La ligne de commande lit la vraie date : ces corbeilles restent anciennes quel que soit le jour.
  const ANCIENNE = '2024-01-01'

  it('sans fichier d’accord : la vieille corbeille part, avec sa ligne au journal', () => {
    corbeille(ANCIENNE)
    const r = lancer('--racine', racine, '--cette-fois')
    expect(r.code).toBe(0)
    expect(JSON.parse(r.sortie)).toMatchObject({ mode: 'purge', purgees: [{ nom: ANCIENNE }] })
    expect(existsSync(join(racine, ANCIENNE))).toBe(false)
    expect(lignesDuJournal()).toMatchObject([{ corbeille: ANCIENNE, geste: 'purge' }])
  })

  it('le jumeau : la même commande sans l’option ne supprime rien', () => {
    corbeille(ANCIENNE)
    const r = lancer('--racine', racine)
    expect(JSON.parse(r.sortie)).toMatchObject({ mode: 'lecture-seule', purgees: [] })
    expect(existsSync(join(racine, ANCIENNE))).toBe(true)
    expect(lignesDuJournal()).toEqual([])
  })

  it('elle ne vaut que pour cette passe : aucun accord n’est créé', () => {
    corbeille(ANCIENNE)
    lancer('--racine', racine, '--cette-fois')
    expect(existsSync(accord)).toBe(false)
    corbeille('2024-01-02')
    expect(JSON.parse(lancer('--racine', racine).sortie).mode).toBe('lecture-seule')
    expect(existsSync(join(racine, '2024-01-02'))).toBe(true)
  })

  it('elle garde les mêmes contrôles : âge, sauvegardes et manifeste ne se contournent pas', () => {
    corbeille('2026-10-16')
    corbeille('2026-10-14', { fichiers: { 'conversations.json.pre-remake': 'histoire' } })
    corbeille('2026-10-13', { manifeste: null })
    corbeille(VIEILLE)
    const bilan = passe({ cetteFois: true })
    expect(bilan.purgees.map((p) => p.nom)).toEqual([VIEILLE])
    expect(bilan.gardees.map((g) => g.nom)).toEqual(['2026-10-13', '2026-10-14'])
    expect(bilan.recentes).toEqual(['2026-10-16'])
    expect(existsSync(join(racine, '2026-10-14', 'conversations.json.pre-remake'))).toBe(true)
  })

  it('une racine refusée reste refusée, avec ou sans l’option', () => {
    expect(lancer('--racine', 'gc-corbeille', '--cette-fois').code).toBe(2)
  })
})

describe('gc-purger-corbeilles — âge', () => {
  it.each([
    ['date future', '2026-11-02'],
    ['du jour', '2026-10-30'],
    ['de 14 jours pile, malgré le changement d’heure du 25/10', '2026-10-16']
  ])('gardée : %s', (_cas, nom) => {
    corbeille(nom)
    accepter()
    const bilan = passe()
    expect(bilan.purgees).toEqual([])
    expect(bilan.recentes).toContain(nom)
    expect(existsSync(join(racine, nom))).toBe(true)
  })

  it.each([
    ['de 15 jours', VIEILLE],
    ['très ancienne', '2024-01-01']
  ])('purgée : %s', (_cas, nom) => {
    corbeille(nom)
    accepter()
    expect(passe().purgees.map((p) => p.nom)).toEqual([nom])
    expect(existsSync(join(racine, nom))).toBe(false)
  })

  it('la corbeille de 14 jours pile part le lendemain', () => {
    corbeille('2026-10-16')
    accepter()
    passe()
    passe({ maintenant: new Date(2026, 9, 31, 8, 0, 0) })
    expect(existsSync(join(racine, '2026-10-16'))).toBe(false)
  })
})

describe('gc-purger-corbeilles — ce qui n’est pas une corbeille sûre est gardé et signalé', () => {
  const gardee = (nom) => {
    accepter()
    const bilan = passe()
    expect(bilan.purgees).toEqual([])
    expect(bilan.gardees.map((g) => g.nom)).toEqual([nom])
    return bilan.gardees[0].motif
  }

  it.each([['vieux'], ['2026-02-30'], ['2026-13-01'], ['26-10-01'], ['2026-10-15-bis']])(
    'nom sans date valable : %s',
    (nom) => {
      corbeille(nom)
      expect(gardee(nom)).toMatch(/nom/iu)
      expect(existsSync(join(racine, nom))).toBe(true)
    }
  )

  it('une entrée datée qui est un fichier', () => {
    writeFileSync(join(racine, VIEILLE), 'x')
    expect(gardee(VIEILLE)).toMatch(/dossier/iu)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  it('une entrée datée qui est une jonction : elle reste, et sa cible n’est pas lue', () => {
    const cible = mkdtempSync(join(tmpdir(), 'autowin-gc-cible-'))
    writeFileSync(join(cible, 'precieux.txt'), 'garde-moi')
    symlinkSync(cible, join(racine, VIEILLE), 'junction')
    expect(gardee(VIEILLE)).toMatch(/dossier/iu)
    expect(readFileSync(join(cible, 'precieux.txt'), 'utf8')).toBe('garde-moi')
  })

  it.each([
    ['absent', null],
    ['vide', '']
  ])('manifeste %s', (_cas, manifeste) => {
    corbeille(VIEILLE, { manifeste })
    expect(gardee(VIEILLE)).toMatch(/MANIFEST/u)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  it('un MANIFEST.txt qui n’est pas un vrai fichier', () => {
    corbeille(VIEILLE, { manifeste: null })
    mkdirSync(join(racine, VIEILLE, 'MANIFEST.txt'))
    expect(gardee(VIEILLE)).toMatch(/MANIFEST/u)
  })

  it.each([
    ['à la racine', 'conversations.json'],
    ['copie d’avant migration', 'autowin-os/conversations.json.pre-remake'],
    ['sauvegarde profonde', 'a/b/c/d/e/f/g/conversations.json.avant-archive-2026-10-14'],
    ['autre fichier .pre-remake', 'autowin-os/reglages.json.pre-remake'],
    ['casse différente', 'autowin-os/CONVERSATIONS.JSON.PRE-REMAKE']
  ])('sauvegarde de conversations : %s', (_cas, chemin) => {
    corbeille(VIEILLE, { fichiers: { [chemin]: 'histoire' } })
    expect(gardee(VIEILLE)).toMatch(/conversations|pre-remake/iu)
    expect(existsSync(join(racine, VIEILLE, chemin))).toBe(true)
  })

  it('un dossier au nom protégé compte aussi', () => {
    corbeille(VIEILLE, { fichiers: { 'conversations.json.archive/conv-1.json': '{}' } })
    expect(gardee(VIEILLE)).toMatch(/conversations\.json\.archive/u)
  })

  it('la vraie corbeille du 29/10 est gardée, et les deux fichiers sont nommés', () => {
    corbeille(VIEILLE, {
      fichiers: {
        'autowin-os/prompt-observability/conv-914.jsonl': 'journal',
        'autowin-os/conversations.json.avant-archive-2026-10-14': 'sauvegarde',
        'autowin-os/conversations.json.journal.jsonl.avant-archive-2026-10-14': 'sauvegarde'
      }
    })
    const motif = gardee(VIEILLE)
    expect(motif).toContain('conversations.json.avant-archive-2026-10-14')
    expect(motif).toContain('conversations.json.journal.jsonl.avant-archive-2026-10-14')
  })

  it('le jumeau : un nom voisin ne protège rien', () => {
    corbeille(VIEILLE, {
      fichiers: {
        'autowin-os/conversations-liste.txt': 'x',
        'autowin-os/mes.conversations.json': 'x',
        'autowin-os/pre-remake.txt': 'x',
        'autowin-os/prompt-observability/conv-914.jsonl': 'x'
      }
    })
    accepter()
    expect(passe().purgees.map((p) => p.nom)).toEqual([VIEILLE])
  })

  it('un sous-dossier illisible : pas de preuve, pas de purge', () => {
    const dossier = corbeille(VIEILLE, { fichiers: { 'sous/fichier.txt': 'x' } })
    accepter()
    const sous = join(dossier, 'sous')
    const bilan = passe({
      lireDossier: (chemin, options) => {
        if (chemin === sous) throw new Error('EACCES')
        return readdirSync(chemin, options)
      }
    })
    expect(bilan.purgees).toEqual([])
    expect(bilan.gardees[0].motif).toMatch(/illisible/iu)
    expect(existsSync(sous)).toBe(true)
  })
})

describe('gc-purger-corbeilles — suppression', () => {
  it('une jonction à l’intérieur est retirée, et sa cible reste intacte', () => {
    const cible = mkdtempSync(join(tmpdir(), 'autowin-gc-cible-'))
    writeFileSync(join(cible, 'module.js'), 'precieux')
    // Un nom protégé DANS la cible : si le parcours suivait le lien, la corbeille serait gardée.
    writeFileSync(join(cible, 'conversations.json'), 'hors corbeille')
    const dossier = corbeille(VIEILLE)
    symlinkSync(cible, join(dossier, 'node_modules'), 'junction')
    accepter()
    expect(passe().purgees.map((p) => p.nom)).toEqual([VIEILLE])
    expect(existsSync(dossier)).toBe(false)
    expect(readFileSync(join(cible, 'module.js'), 'utf8')).toBe('precieux')
  })

  /*
   * LE TEST DE JONCTION NE SUFFIT PAS À PROUVER QUE `supprimerArbre` EST UTILISÉE : `rmSync` ne vide
   * la cible d'une jonction que sous le Node d'Electron (`fs-supprimer.ts`), pas sous le Node qui lance
   * ce script (mesuré en 24.19, 30/10). Ce qui les distingue partout : seule `supprimerArbre` refuse le
   * dossier courant. Remettre un `rmSync` ici fait tomber ce test.
   */
  it('la suppression passe par supprimerArbre : lancé depuis la corbeille, il n’y touche pas', () => {
    const dossier = corbeille(VIEILLE)
    accepter()
    const r = spawnSync(process.execPath, ['--no-warnings', SCRIPT, '--racine', racine], {
      encoding: 'utf8',
      cwd: dossier
    })
    expect(r.status).toBe(1)
    expect(JSON.parse(r.stdout).echecs[0].erreur).toMatch(/dossier courant/u)
    expect(existsSync(join(dossier, 'MANIFEST.txt'))).toBe(true)
  })

  it('aucun plafond de poids : une corbeille énorme passe par les mêmes contrôles', () => {
    const dossier = corbeille(VIEILLE)
    const gros = join(dossier, 'gros.bin')
    writeFileSync(gros, '')
    truncateSync(gros, 200 * 1024 * 1024)
    accepter()
    const [purgee] = passe().purgees
    expect(purgee.octets).toBeGreaterThanOrEqual(200 * 1024 * 1024)
    expect(existsSync(dossier)).toBe(false)
  })

  it('chaque purge laisse une ligne, et un second lancement n’en ajoute aucune', () => {
    corbeille('2026-10-14')
    corbeille(VIEILLE)
    accepter()
    expect(passe().code).toBe(0)
    expect(lignesDuJournal()).toMatchObject([
      { corbeille: '2026-10-14', jours: 16, geste: 'purge' },
      { corbeille: VIEILLE, jours: 15, geste: 'purge' }
    ])
    expect(lignesDuJournal()[0].quand).toBe(MAINTENANT.toISOString())
    expect(lignesDuJournal()[0].fichiers).toBe(2)
    expect(passe()).toMatchObject({ code: 0, message: 'Rien à purger', purgees: [] })
    expect(lignesDuJournal()).toHaveLength(2)
  })

  it('un fichier verrouillé : les suivantes sont tentées, le reste demeure, code 1', () => {
    corbeille('2026-10-13')
    const bloquee = corbeille('2026-10-14')
    corbeille(VIEILLE)
    accepter()
    const bilan = passe({
      supprimer: (chemin) => {
        if (chemin === bloquee) throw new Error('EBUSY: fichier verrouillé')
        supprimerArbre(chemin)
      }
    })
    expect(bilan.code).toBe(1)
    expect(bilan.purgees.map((p) => p.nom)).toEqual(['2026-10-13', VIEILLE])
    expect(bilan.echecs).toMatchObject([{ nom: '2026-10-14' }])
    expect(bilan.echecs[0].erreur).toContain('EBUSY')
    expect(existsSync(bloquee)).toBe(true)
    expect(lignesDuJournal().map((l) => [l.corbeille, l.geste])).toEqual([
      ['2026-10-13', 'purge'],
      ['2026-10-14', 'purge'],
      ['2026-10-14', 'purge-echouee'],
      [VIEILLE, 'purge']
    ])
  })

  it('un journal impossible à écrire : rien n’est supprimé, code 1', () => {
    corbeille('2026-10-14')
    corbeille(VIEILLE)
    accepter()
    mkdirSync(journal)
    const bilan = passe()
    expect(bilan.code).toBe(1)
    expect(bilan.purgees).toEqual([])
    expect(bilan.echecs[0].erreur).toMatch(/journal/iu)
    expect(existsSync(join(racine, '2026-10-14'))).toBe(true)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  /*
   * UNE PASSE REND TOUJOURS SON BILAN (conv-1341, 30/10) : deux `/gc` peuvent se croiser, et la liste
   * des corbeilles se lit avant leur examen. Le script promet un bilan en JSON : sans lui, le `/gc`
   * ne saurait pas ce qui vient de partir.
   */
  it('une corbeille disparue pendant la passe : le bilan sort et les suivantes sont traitées', () => {
    const premiere = corbeille('2026-10-13')
    const disparue = corbeille('2026-10-14')
    corbeille(VIEILLE)
    accepter()
    const bilan = passe({
      supprimer: (chemin) => {
        supprimerArbre(chemin)
        if (chemin === premiere) supprimerArbre(disparue)
      }
    })
    expect(bilan.code).toBe(0)
    expect(bilan.purgees.map((p) => p.nom)).toEqual(['2026-10-13', VIEILLE])
    expect(bilan.gardees).toEqual([])
    expect(bilan.echecs).toEqual([])
  })

  it('le jumeau : une corbeille présente mais illisible reste gardée et signalée', () => {
    const illisible = corbeille('2026-10-14')
    corbeille(VIEILLE)
    accepter()
    const bilan = passe({
      lireInfos: (chemin) => {
        if (chemin === illisible)
          throw Object.assign(new Error('EPERM: accès refusé'), { code: 'EPERM' })
        return lstatSync(chemin)
      }
    })
    expect(bilan.code).toBe(0)
    expect(bilan.purgees.map((p) => p.nom)).toEqual([VIEILLE])
    expect(bilan.gardees).toMatchObject([{ nom: '2026-10-14' }])
    expect(bilan.gardees[0].motif).toMatch(/illisible/iu)
    expect(existsSync(illisible)).toBe(true)
  })

  it('une corbeille générale illisible : code 1 et bilan, jamais une sortie muette', () => {
    corbeille(VIEILLE)
    accepter()
    const bilan = passe({
      lireDossier: (chemin, options) => {
        if (chemin === racine)
          throw Object.assign(new Error('EPERM: accès refusé'), { code: 'EPERM' })
        return readdirSync(chemin, options)
      }
    })
    expect(bilan).toMatchObject({ code: 1, purgees: [] })
    expect(bilan.message).toMatch(/illisible/iu)
    expect(existsSync(join(racine, VIEILLE))).toBe(true)
  })

  it('les corbeilles gardées n’empêchent pas de purger les autres', () => {
    corbeille('2026-10-14', { fichiers: { 'conversations.json': 'x' } })
    corbeille(VIEILLE)
    corbeille('2026-10-30')
    accepter()
    const bilan = passe()
    expect(bilan.code).toBe(0)
    expect(bilan.purgees.map((p) => p.nom)).toEqual([VIEILLE])
    expect(bilan.gardees.map((g) => g.nom)).toEqual(['2026-10-14'])
    expect(bilan.recentes).toEqual(['2026-10-30'])
  })
})

describe('skills/gc/SKILL.md — l’accord de purge reste réservé à un humain', () => {
  const skill = readFileSync(new URL('../skills/gc/SKILL.md', import.meta.url), 'utf8')

  it('propose une réponse que le mode auto ne peut pas choisir à la place de l’utilisateur', () => {
    const option = 'Oui, purge et vide seul à l’avenir'
    expect(skill).toContain(`« ${option} »`)
    expect(estCibleDestructrice(option)).toBe(true)
    expect(skill).toContain('« Oui, purge cette fois »')
    expect(estCibleDestructrice('Oui, purge cette fois')).toBe(true)
    expect(estCibleDestructrice('Non, garde')).toBe(false)
  })

  it('nomme le script et le fichier d’accord que le code lit vraiment', () => {
    expect(skill).toContain('scripts/gc-purger-corbeilles.mjs')
    expect(skill).toContain('gc-purge-auto.json')
    expect(skill).toContain('gc-purges.jsonl')
    expect(skill).toContain('AUTOWIN_FIN_V1')
  })

  it('dit comment purger une seule fois : sans cela, un /gc retomberait sur un rm à la main', () => {
    const consigne = skill.slice(skill.indexOf('**Réponse « Oui, purge cette fois »**'))
    expect(consigne.slice(0, 400)).toContain('--cette-fois')
    expect(consigne.slice(0, 400)).toContain('jamais `rm -rf`')
  })

  it('toute purge passe par le script : plus aucune suppression écrite à la main', () => {
    expect(skill).not.toContain('supprimerArbre')
    expect(skill).not.toContain('fs-supprimer')
  })
})
