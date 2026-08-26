import { describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { balayerCoquillesVides, estCoquilleVide } from './coquilles-vides'

/**
 * LA VRAIE USINE A RESIDUS : `git worktree remove` laisse la coquille derriere lui.
 *
 * MESURE le 2026-08-25. Apres avoir libere deux bureaux avec `git worktree remove --force`, les
 * DOSSIERS etaient toujours la : 0 fichier utile, un `.git` orphelin, ~1 Mo piece. C'est tres
 * probablement l'origine des douze coquilles trouvees le meme jour dans ce depot — et elles ne sont
 * pas inoffensives : un `git status` lance dedans ne repond pas « vide », git remonte
 * l'arborescence et rapporte l'etat du depot PARENT. Douze coquilles ont ainsi paru porter du
 * travail, et cette fausse lecture a ete propagee jusque dans un message de commit.
 *
 * LA REGLE, heritee du cadrage : on ne purge QUE ce dont l'absence de valeur est DEMONTREE. Ici la
 * demonstration est directe et ne demande aucun jugement — le dossier ne contient AUCUN fichier
 * hors `.git`. Jamais un critere d'age, jamais une heuristique.
 */
function bureauTemporaire(): string {
  return mkdtempSync(join(tmpdir(), 'bureaux-'))
}

function poserCoquille(racine: string, nom: string): string {
  const chemin = join(racine, nom)
  mkdirSync(join(chemin, '.git'), { recursive: true })
  writeFileSync(join(chemin, '.git', 'HEAD'), 'ref: refs/heads/mort')
  return chemin
}

function poserBureauAvecTravail(racine: string, nom: string): string {
  const chemin = poserCoquille(racine, nom)
  mkdirSync(join(chemin, 'src'), { recursive: true })
  writeFileSync(join(chemin, 'src', 'travail.ts'), 'export const x = 1')
  return chemin
}

describe('estCoquilleVide — la demonstration d’absence de valeur', () => {
  it('un dossier sans AUCUN fichier hors .git est une coquille', () => {
    const racine = bureauTemporaire()
    try {
      expect(estCoquilleVide(poserCoquille(racine, 'agent__mort'))).toBe(true)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('UN SEUL fichier utile suffit a ne plus etre une coquille', () => {
    const racine = bureauTemporaire()
    try {
      expect(estCoquilleVide(poserBureauAvecTravail(racine, 'agent__vivant'))).toBe(false)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('un dossier inexistant n’est pas declare coquille — on ne devine pas', () => {
    expect(estCoquilleVide(join(bureauTemporaire(), 'jamais-cree'))).toBe(false)
  })
})

describe('balayerCoquillesVides — purge sans intervention humaine', () => {
  it('supprime les coquilles et NE TOUCHE PAS un bureau porteur de travail', () => {
    const racine = bureauTemporaire()
    try {
      const morte1 = poserCoquille(racine, 'agent__mort-1')
      const morte2 = poserCoquille(racine, 'agent__mort-2')
      const vivant = poserBureauAvecTravail(racine, 'agent__porteur')

      const supprimes = balayerCoquillesVides(racine)

      expect(supprimes.sort()).toEqual(['agent__mort-1', 'agent__mort-2'])
      expect(existsSync(morte1)).toBe(false)
      expect(existsSync(morte2)).toBe(false)
      // LA branche qui compte : le travail non repris n'est JAMAIS purge.
      expect(existsSync(vivant)).toBe(true)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })

  it('racine absente : rend une liste vide au lieu de jeter', () => {
    expect(balayerCoquillesVides(join(tmpdir(), 'racine-qui-n-existe-pas-bureaux'))).toEqual([])
  })

  it('ne descend pas dans les sous-dossiers d’un bureau porteur', () => {
    const racine = bureauTemporaire()
    try {
      const porteur = poserBureauAvecTravail(racine, 'agent__porteur')
      // Un sous-dossier vide DANS un bureau vivant ne doit pas etre confondu avec une coquille.
      mkdirSync(join(porteur, 'vide-interne'), { recursive: true })

      expect(balayerCoquillesVides(racine)).toEqual([])
      expect(existsSync(join(porteur, 'vide-interne'))).toBe(true)
    } finally {
      rmSync(racine, { recursive: true, force: true })
    }
  })
})
