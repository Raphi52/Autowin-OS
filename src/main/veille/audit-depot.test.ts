import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { candidatsInternesDuDepot, lireSourcesDuDepot } from './audit-depot'
import { trierCandidats } from './candidats'
import { PRODUIT_INTERNE } from './audit-interne'

/**
 * Ce module est le SEUL du mécanisme à toucher au disque : ses tests écrivent donc un dépôt jouet
 * dans un dossier temporaire, et le suppriment. Rien n'est lu dans le vrai dépôt — un test qui audite
 * le code du jour rougirait au premier défaut corrigé par quelqu'un d'autre.
 */
const racines: string[] = []
afterEach(() => {
  for (const r of racines.splice(0)) rmSync(r, { recursive: true, force: true })
})

function depotJouet(fichiers: Record<string, string>): string {
  const racine = mkdtempSync(join(tmpdir(), 'audit-depot-'))
  racines.push(racine)
  for (const [chemin, contenu] of Object.entries(fichiers)) {
    const complet = join(racine, chemin)
    mkdirSync(join(complet, '..'), { recursive: true })
    writeFileSync(complet, contenu, 'utf8')
  }
  return racine
}

describe('lecture du dépôt pour l’audit', () => {
  it('rend des chemins RELATIFS en séparateurs POSIX, quel que soit le système', () => {
    // Les détecteurs comparent des chemins (`src/main/…`, `src/renderer/…`) : une antislash de
    // Windows les ferait tous échouer en silence, et l'audit rendrait zéro constat sans erreur.
    const racine = depotJouet({ 'src/main/index.ts': 'const a = 1\n' })
    const lus = lireSourcesDuDepot(racine)
    expect(lus).toHaveLength(1)
    expect(lus[0].chemin).toBe('src/main/index.ts')
  })

  it('lit AUSSI les scripts de pilotage, qui sont des appelants légitimes', () => {
    const racine = depotJouet({
      'src/main/index.ts': 'const a = 1\n',
      'scripts/cdp-preuve.mjs': 'await api.quelqueChose()\n'
    })
    expect(
      lireSourcesDuDepot(racine)
        .map((f) => f.chemin)
        .sort()
    ).toEqual(['scripts/cdp-preuve.mjs', 'src/main/index.ts'])
  })

  it('ignore les dossiers qui ne portent pas le code du produit', () => {
    const racine = depotJouet({
      'src/main/index.ts': 'const a = 1\n',
      'src/node_modules/paquet/index.ts': 'const b = 2\n',
      'src/.cache/x.ts': 'const c = 3\n'
    })
    expect(lireSourcesDuDepot(racine)).toHaveLength(1)
  })

  it('ne tombe pas sur un dossier absent : un dépôt sans scripts reste auditable', () => {
    const racine = depotJouet({ 'src/main/index.ts': 'const a = 1\n' })
    expect(() => lireSourcesDuDepot(racine)).not.toThrow()
    expect(lireSourcesDuDepot(racine)).toHaveLength(1)
  })
})

describe('candidats internes du dépôt', () => {
  const defauts = {
    // Une vue qu'aucun fichier ne monte : un défaut que le détecteur reconnaît.
    'src/renderer/src/components/OrphelineView.tsx':
      'export function OrphelineView(): null {\n  return null\n}\n',
    'src/renderer/src/App.tsx': 'const x = 1\n'
  }

  it('rend des candidats ACCEPTÉS par le tri de la veille, pas seulement bien formés', () => {
    // Le vrai risque n'est pas de mal détecter : c'est de produire des candidats que le tri refuse
    // ensuite (URL non http, citation trop courte). On le vérifie avec le VRAI `trierCandidats`.
    const racine = depotJouet(defauts)
    const bruts = candidatsInternesDuDepot(racine, { maintenant: '2026-08-13T10:00:00.000Z' })
    expect(bruts.length).toBeGreaterThan(0)
    const { retenus, refuses } = trierCandidats(bruts, new Set(), {
      maintenant: '2026-08-13T10:00:00.000Z',
      redigerPrompt: (c) => `corrige ${c.titre}`
    })
    expect(refuses).toEqual([])
    expect(retenus).toHaveLength(bruts.length)
    expect(retenus[0].concurrent).toBe(PRODUIT_INTERNE)
    expect(retenus[0].type).toBe('correction')
  })

  it('borne ce qui part dans une passe, sans perdre les meilleurs', () => {
    // Cinquante entrées d'un coup reproduiraient la colonne illisible qu'on corrige. Les constats
    // étant triés par score, le plafond garde les plus rentables.
    const racine = depotJouet({
      ...defauts,
      'src/renderer/src/components/AutreView.tsx':
        'export function AutreView(): null {\n  return null\n}\n'
    })
    const bornes = candidatsInternesDuDepot(racine, {
      maintenant: '2026-08-13T10:00:00.000Z',
      plafond: 1
    })
    expect(bornes).toHaveLength(1)
  })

  it('rend un tableau vide sur un dépôt sain, sans inventer de défaut', () => {
    // Un audit qui trouve toujours quelque chose ne vaut rien : le vide doit être une issue normale.
    const racine = depotJouet({
      'src/renderer/src/components/VueMontee.tsx':
        'export function VueMontee(): null {\n  return null\n}\n',
      'src/renderer/src/App.tsx': '<VueMontee />\n'
    })
    expect(candidatsInternesDuDepot(racine)).toEqual([])
  })
})

/**
 * DEUX CANDIDATS SORTIS PAR LE SCOUT DE L'APP ELLE-MÊME (2026-08-19, scores 94 et 89), vérifiés
 * dans le code avant d'être traités :
 *
 * 94 — `statSync` SUIT les liens. Une jonction NTFS ou un lien symbolique placé sous `src/` fait
 *      donc sortir l'audit du dépôt : il lit, et remonte comme « code du produit », des fichiers
 *      qui vivent ailleurs — un autre dépôt, un partage réseau, une copie de run. Ce dépôt en
 *      fabrique réellement (worktrees isolés, jonctions temporaires), donc le risque n'est pas
 *      théorique. `lstatSync` ne suit rien : un lien est signalé et sauté.
 *
 * 89 — Aucun plafond ne bornait la lecture : chaque fichier retenu était chargé ENTIER en mémoire,
 *      sans limite de nombre ni de taille. Une passe d'audit sur un arbre pathologique (ou sur un
 *      dossier de données oublié dans les racines) devenait une lecture de plusieurs gigaoctets.
 *      Mesuré le même jour sur ce dépôt : `Audit/` pèse 11 Go pour 21 488 fichiers.
 */
describe('lireSourcesDuDepot — bornes trouvées par le scout de l’app', () => {
  function arbre(): string {
    const racine = mkdtempSync(join(tmpdir(), 'autowin-audit-'))
    mkdirSync(join(racine, 'src/main'), { recursive: true })
    writeFileSync(join(racine, 'src/main/vrai.ts'), 'export const a = 1', 'utf8')
    return racine
  }

  it('94 — un lien symbolique sous `src` n’est pas suivi', () => {
    const racine = arbre()
    const dehors = mkdtempSync(join(tmpdir(), 'autowin-dehors-'))
    try {
      mkdirSync(join(dehors, 'secret'), { recursive: true })
      writeFileSync(join(dehors, 'secret/ailleurs.ts'), 'export const secret = 1', 'utf8')
      try {
        symlinkSync(join(dehors, 'secret'), join(racine, 'src/lien'), 'junction')
      } catch {
        return // sans droit de création de lien, le test ne peut rien prouver : il ne ment pas.
      }
      const fichiers = lireSourcesDuDepot(racine)
      expect(fichiers.map((f) => f.chemin)).toContain('src/main/vrai.ts')
      expect(fichiers.some((f) => f.contenu.includes('secret'))).toBe(false)
    } finally {
      rmSync(racine, { recursive: true, force: true })
      rmSync(dehors, { recursive: true, force: true })
    }
  })

  it('89 — la lecture est bornée en nombre de fichiers', () => {
    const racine = arbre()
    try {
      for (let i = 0; i < 40; i++) {
        writeFileSync(join(racine, `src/main/f${i}.ts`), `export const x${i} = ${i}`, 'utf8')
      }
      expect(lireSourcesDuDepot(racine, ['src'], { plafondFichiers: 10 })).toHaveLength(10)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('89 — un fichier plus gros que le plafond est écarté, pas tronqué', () => {
    const racine = arbre()
    try {
      writeFileSync(join(racine, 'src/main/enorme.ts'), 'x'.repeat(5000), 'utf8')
      const fichiers = lireSourcesDuDepot(racine, ['src'], { plafondOctets: 1000 })
      expect(fichiers.map((f) => f.chemin)).toContain('src/main/vrai.ts')
      expect(fichiers.map((f) => f.chemin)).not.toContain('src/main/enorme.ts')
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('CONTRE-EXEMPLE — sans options, le comportement utile reste identique', () => {
    const racine = arbre()
    try {
      expect(lireSourcesDuDepot(racine).map((f) => f.chemin)).toEqual(['src/main/vrai.ts'])
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
