import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { CONSTITUTION } from './constitution'
import { JUGEMENT, REFLEXES_CONTROLES, type LigneReflexe } from './reflexes-controles'

/*
 * CHAQUE RÉFLEXE A SA LIGNE, ET CHAQUE CONTRÔLE CITÉ EXISTE.
 *
 * Entrées qui feraient échouer ce test si le tableau mentait : une ligne retirée (un réflexe sans
 * contrôle ni mention de jugement), un fichier de contrôle renommé ou déplacé, un symbole renommé
 * dans son fichier, un 15e réflexe ajouté à la constitution sans ligne ici.
 */

const RACINE = join(__dirname, '..', '..', '..')

/** Les numéros des réflexes, lus dans la constitution elle-même (section « Les 14 réflexes »). */
function numerosDesReflexes(constitution: string): number[] {
  const debut = constitution.indexOf('## Les 14 réflexes')
  const fin = constitution.indexOf('**Pas de pansement', debut)
  const section = constitution.slice(debut, fin)
  return [...section.matchAll(/^(\d+)\.\s/gm)].map((m) => Number(m[1]))
}

/** Ce qui ne va pas dans un tableau, face aux réflexes attendus et aux fichiers du dépôt. */
function ecartsDuTableau(
  tableau: readonly LigneReflexe[],
  attendus: readonly number[],
  lire: (chemin: string) => string | null
): string[] {
  const ecarts: string[] = []
  const numeros = tableau.map((l) => l.numero)
  for (const n of attendus) if (!numeros.includes(n)) ecarts.push(`réflexe ${n} sans ligne`)
  for (const n of numeros) if (!attendus.includes(n)) ecarts.push(`ligne ${n} sans réflexe`)
  if (new Set(numeros).size !== numeros.length) ecarts.push('numéro en double')
  for (const ligne of tableau) {
    if (!ligne.reflexe.trim()) ecarts.push(`réflexe ${ligne.numero} sans nom`)
    if (!ligne.signe.trim()) ecarts.push(`réflexe ${ligne.numero} sans signe`)
    if (ligne.controles === JUGEMENT) continue
    if (ligne.controles.length === 0)
      ecarts.push(`réflexe ${ligne.numero} : liste de contrôles vide`)
    for (const { fichier, symbole } of ligne.controles) {
      const contenu = lire(fichier)
      if (contenu === null) ecarts.push(`réflexe ${ligne.numero} : ${fichier} absent`)
      else if (!new RegExp(`\\b${symbole}\\b`).test(contenu))
        ecarts.push(`réflexe ${ligne.numero} : ${symbole} absent de ${fichier}`)
    }
  }
  return ecarts
}

const lireDansLeDepot = (chemin: string): string | null => {
  const absolu = join(RACINE, chemin)
  return existsSync(absolu) ? readFileSync(absolu, 'utf8') : null
}

describe('tableau réflexe → contrôle → signe qu’on l’a sauté', () => {
  it('la constitution compte bien 14 réflexes numérotés 1 à 14', () => {
    expect(numerosDesReflexes(CONSTITUTION)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1))
  })

  it('chaque réflexe a sa ligne, et chaque contrôle cité existe dans son fichier', () => {
    expect(
      ecartsDuTableau(REFLEXES_CONTROLES, numerosDesReflexes(CONSTITUTION), lireDansLeDepot)
    ).toEqual([])
  })

  it('les chemins sont écrits depuis la racine du dépôt, sans `\\` ni `..`', () => {
    for (const ligne of REFLEXES_CONTROLES) {
      if (ligne.controles === JUGEMENT) continue
      for (const { fichier } of ligne.controles) expect(fichier).toMatch(/^(src|scripts)\/[^\\]+$/)
    }
  })

  it('au moins un réflexe est tenu par du code : le tableau n’est pas que du jugement', () => {
    expect(REFLEXES_CONTROLES.filter((l) => l.controles !== JUGEMENT).length).toBeGreaterThan(0)
  })

  // Le jumeau : le contrôle ci-dessus MORD sur un tableau faux (sinon il passerait toujours).
  describe('le contrôle refuse un tableau faux', () => {
    const attendus = numerosDesReflexes(CONSTITUTION)
    it('une ligne retirée', () => {
      const sans9 = REFLEXES_CONTROLES.filter((l) => l.numero !== 9)
      expect(ecartsDuTableau(sans9, attendus, lireDansLeDepot)).toContain('réflexe 9 sans ligne')
    })
    it('un fichier de contrôle déplacé', () => {
      const deplace = REFLEXES_CONTROLES.map((l) =>
        l.numero === 14
          ? {
              ...l,
              controles: [{ fichier: 'src/shared/garde-git.ts', symbole: 'refusGitDestructeur' }]
            }
          : l
      )
      expect(ecartsDuTableau(deplace, attendus, lireDansLeDepot)).toContain(
        'réflexe 14 : src/shared/garde-git.ts absent'
      )
    })
    it('un symbole renommé', () => {
      const renomme = REFLEXES_CONTROLES.map((l) =>
        l.numero === 7
          ? { ...l, controles: [{ fichier: 'src/main/gates/hooks.ts', symbole: 'detecterBoucle' }] }
          : l
      )
      expect(ecartsDuTableau(renomme, attendus, lireDansLeDepot)).toContain(
        'réflexe 7 : detecterBoucle absent de src/main/gates/hooks.ts'
      )
    })
    it('un 15e réflexe ajouté à la constitution sans ligne', () => {
      expect(ecartsDuTableau(REFLEXES_CONTROLES, [...attendus, 15], lireDansLeDepot)).toContain(
        'réflexe 15 sans ligne'
      )
    })
  })
})
