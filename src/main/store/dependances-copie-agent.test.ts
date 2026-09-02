import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { delierLesDependances, lierLesDependances, messageLiaison } from './dependances-copie-agent'

/**
 * LE DÉFAUT, mesuré le 2026-08-25 sur le run `je-vois-toujours-le-fond-d-ecran-…` (conv-1397).
 *
 * Une copie agent est un `git worktree add` : elle ne porte que les fichiers suivis, et
 * `node_modules` est ignoré par git. Mesure directe dans une copie fraîche du dépôt :
 *
 *     npx vitest run <un test>  →  Error: Cannot find module 'vitest/config'  (exit 1)
 *
 * vitest ne chargeait même pas sa configuration. AUCUN agent ne pouvait donc produire une preuve
 * exécutable depuis sa propre copie — et sans preuve, `etatDeCloture` rend `red`, le contrôle final
 * affiche « Échec déjà déclaré », et la boucle de réparation s'arrête (à raison : ce refus est hors
 * de portée d'un rejeu). Un travail réellement fait et prouvé était rendu comme un échec.
 */

// Chaque bac est un dossier jetable dans TEMP. Mesure du 2026-09-02 : 546 dossiers
// `copie-agent-*` s'etaient accumules la (~340 Mo) parce que rien ne les retirait. On les retire
// donc apres chaque test. Un effacement recursif ne traverse PAS la jonction (fait verrouille plus
// bas) : les faux modules du bac partent, rien d'autre. Un echec de retrait n'est jamais fatal --
// le nettoyage ne doit pas pouvoir faire rougir un test.
const bacsAJeter: string[] = []

const bac = (): { base: string; copie: string } => {
  const racine = mkdtempSync(join(tmpdir(), 'copie-agent-'))
  const base = join(racine, 'depot')
  const copie = join(racine, 'copie')
  mkdirSync(base, { recursive: true })
  mkdirSync(copie, { recursive: true })
  bacsAJeter.push(racine)
  return { base, copie }
}

afterEach(() => {
  while (bacsAJeter.length > 0) {
    const racine = bacsAJeter.pop()
    if (racine === undefined) continue
    try {
      rmSync(racine, { recursive: true, force: true })
    } catch {
      // residu laisse : sans effet sur le resultat du test
    }
  }
})

describe('les dépendances suivent la copie agent', () => {
  it('relie node_modules quand le dépôt en a et la copie non', () => {
    const { base, copie } = bac()
    mkdirSync(join(base, 'node_modules'))

    expect(lierLesDependances(base, copie)).toEqual({ fait: 'liees' })
    // Le lien est REELLEMENT utilisable, pas seulement créé : on lit à travers.
    writeFileSync(join(base, 'node_modules', 'marqueur.txt'), 'ok', 'utf8')
    expect(existsSync(join(copie, 'node_modules', 'marqueur.txt'))).toBe(true)
  })

  it('NE TOUCHE PAS à des modules déjà présents dans la copie', () => {
    // Le bord destructeur : remplacer de vrais modules par un lien serait une perte, pas une aide.
    const { base, copie } = bac()
    mkdirSync(join(base, 'node_modules'))
    mkdirSync(join(copie, 'node_modules'))
    writeFileSync(join(copie, 'node_modules', 'a-moi.txt'), 'intact', 'utf8')

    expect(lierLesDependances(base, copie)).toEqual({ fait: 'deja-presentes' })
    expect(existsSync(join(copie, 'node_modules', 'a-moi.txt'))).toBe(true)
  })

  it('ne signale pas une panne quand le dépôt lui-même n’a rien installé', () => {
    const { base, copie } = bac()

    expect(lierLesDependances(base, copie)).toEqual({
      fait: 'rien-a-lier',
      raison: "le depot n'a pas de node_modules"
    })
  })

  it('RETOURNE l’échec au lieu de jeter — une copie sans dépendances reste utilisable', () => {
    // Faire échouer la création de la copie entière parce qu'un lien n'a pas pu être posé
    // transformerait une gêne en panne. L'échec est rendu, donc traçable, jamais avalé.
    const resultat = lierLesDependances('/base', '/copie', {
      existe: (chemin) => chemin.includes('base'),
      lier: () => {
        throw new Error('EPERM: operation not permitted')
      }
    })

    expect(resultat).toEqual({ fait: 'echec', raison: 'EPERM: operation not permitted' })
  })

  it('dit ce qui s’est passé, pour la trace du run', () => {
    // Un lien posé en silence ne s'explique pas le jour où il manque.
    expect(messageLiaison({ fait: 'liees' })).toContain('peut lancer les tests')
    expect(messageLiaison({ fait: 'echec', raison: 'EPERM' })).toContain('EPERM')
    expect(messageLiaison({ fait: 'deja-presentes' })).toContain('intact')
  })
})

describe('le lien est retiré avant qu’une copie ne soit supprimée', () => {
  it('retire le lien, et les modules du dépôt survivent', () => {
    // Mesuré le 2026-08-25 : sans ce retrait, `git worktree remove --force` rend 0 mais laisse la
    // jonction — le dossier de la copie survit en coquille, et le nettoyage conclut « ok ».
    const { base, copie } = bac()
    mkdirSync(join(base, 'node_modules'))
    writeFileSync(join(base, 'node_modules', 'du-depot.txt'), 'precieux', 'utf8')
    expect(lierLesDependances(base, copie)).toEqual({ fait: 'liees' })

    expect(delierLesDependances(copie)).toEqual({ fait: 'retire' })

    expect(existsSync(join(copie, 'node_modules'))).toBe(false)
    // LE point : on n'a pas effacé les modules du dépôt À TRAVERS la jonction.
    expect(existsSync(join(base, 'node_modules', 'du-depot.txt'))).toBe(true)
  })

  it('REFUSE de supprimer un VRAI dossier de modules', () => {
    // L'entrée qui doit faire échouer une garde trop gourmande. Une copie a pu installer les siens ;
    // les effacer serait une destruction. `lstat` distingue, `stat` dirait « dossier » des deux côtés.
    const { copie } = bac()
    mkdirSync(join(copie, 'node_modules'))
    writeFileSync(join(copie, 'node_modules', 'a-moi.txt'), 'intact', 'utf8')

    expect(delierLesDependances(copie)).toEqual({ fait: 'refuse-vrai-dossier' })
    expect(existsSync(join(copie, 'node_modules', 'a-moi.txt'))).toBe(true)
  })

  it('ne se plaint pas quand il n’y a rien à retirer', () => {
    const { copie } = bac()
    expect(delierLesDependances(copie)).toEqual({ fait: 'rien-a-retirer' })
  })

  it('RETOURNE l’échec du retrait au lieu de jeter', () => {
    const resultat = delierLesDependances('/copie', {
      estUnLien: () => true,
      retirer: () => {
        throw new Error('EBUSY: resource busy')
      }
    })
    expect(resultat).toEqual({ fait: 'echec', raison: 'EBUSY: resource busy' })
  })
})

/**
 * CE QUE CE TEST TRANCHE, et pourquoi il existe.
 *
 * Un cadrage du 2026-09-02 (conv-133) affirmait comme PROUVÉ qu'un effacement récursif d'une copie
 * agent « détruirait les 836 Mo de modules du dépôt réel » à travers la jonction. Personne ne
 * l'avait mesuré. Mesure faite : c'est FAUX. Une jonction NTFS n'est pas suivie par un effacement
 * récursif — ni `fs.rmSync({recursive})`, ni `rm -rf`, ni `rmdir /s` : la jonction part, sa cible
 * reste. Le vrai motif du retrait du lien avant nettoyage est ailleurs, et il est écrit dans
 * `dependances-copie-agent.ts` : `git worktree remove --force` rend 0 mais laisse un dossier
 * fantôme contenant encore la jonction.
 *
 * Ce test verrouille le fait mesuré, pour qu'aucun futur cadrage ne réinvente le danger.
 */
describe('effacer une copie ne traverse pas la jonction', () => {
  it('laisse INTACTS les modules du dépôt après un effacement récursif de la copie', () => {
    const { base, copie } = bac()
    mkdirSync(join(base, 'node_modules', 'un-paquet'), { recursive: true })
    writeFileSync(join(base, 'node_modules', 'un-paquet', 'index.js'), 'module.exports=1', 'utf8')

    expect(lierLesDependances(base, copie)).toEqual({ fait: 'liees' })
    // Le lien est réellement traversable : sans ça, la mesure ne prouverait rien.
    expect(existsSync(join(copie, 'node_modules', 'un-paquet', 'index.js'))).toBe(true)

    rmSync(copie, { recursive: true, force: true })

    expect(existsSync(copie)).toBe(false)
    expect(existsSync(join(base, 'node_modules', 'un-paquet', 'index.js'))).toBe(true)
    expect(readdirSync(join(base, 'node_modules'))).toEqual(['un-paquet'])
  })

  it('avec `stat` au lieu de `lstat`, la jonction RESTE — la coquille orpheline, pas la destruction', () => {
    // Ce que coûte VRAIMENT la mauvaise sonde, mesuré : `stat` suit la jonction et répond
    // « dossier », donc la garde croit voir de VRAIS modules et refuse d'y toucher. Le lien
    // survit, le dossier de la copie survit avec lui — exactement la coquille orpheline que
    // `git worktree remove --force` laisse déjà. Rien n'est détruit du côté du dépôt.
    const { base, copie } = bac()
    mkdirSync(join(base, 'node_modules', 'un-paquet'), { recursive: true })
    writeFileSync(join(base, 'node_modules', 'un-paquet', 'index.js'), 'module.exports=1', 'utf8')
    expect(lierLesDependances(base, copie)).toEqual({ fait: 'liees' })

    const avecStat = delierLesDependances(copie, {
      estUnLien: (chemin) => statSync(chemin).isSymbolicLink(),
      retirer: (chemin) => unlinkSync(chemin)
    })

    expect(avecStat).toEqual({ fait: 'refuse-vrai-dossier' })
    expect(existsSync(join(copie, 'node_modules'))).toBe(true)
    expect(existsSync(join(base, 'node_modules', 'un-paquet', 'index.js'))).toBe(true)
  })
})
