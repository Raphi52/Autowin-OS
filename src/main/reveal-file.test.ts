import { describe, expect, it } from 'vitest'

/**
 * LES DEUX PROMESSES NON TENUES DU LIEN FICHIER (conv-1427, juge du 2026-08-27).
 *
 * 1. La cible `a.ts:80` était parsée en `{path, line}`, la ligne portée jusqu'au main… puis JETÉE
 *    (`void rawLine`). Le lien ouvrait le fichier, jamais la ligne. Le livrable ne le disait nulle
 *    part : l'écart entre la promesse et le comportement était invisible.
 * 2. La racine de résolution était `AUTOWIN_OS_WORKSPACE ?? process.cwd()`. Or un agent cite des
 *    chemins relatifs à SA copie (`worktrees/<hash>/agent__run-*`), pas au cwd du processus
 *    principal. Le clic rendait `introuvable` — c'est-à-dire exactement la plainte d'origine.
 */
import { commandeEditeur, ligneDemandee, racinesRevelation } from './reveal-file'

describe('racines de résolution d’une référence citée par un agent', () => {
  it('cherche dans le workspace PUIS dans les copies des agents, jamais ailleurs', () => {
    const racines = racinesRevelation({
      workspace: 'C:/repo',
      worktreesRoot: 'C:/data/worktrees',
      lister: (dir) => {
        if (dir === 'C:/data/worktrees') return ['68fe8b08', 'autre']
        if (dir === 'C:/data/worktrees/68fe8b08') return ['agent__run-1', 'integration__run-1__x']
        if (dir === 'C:/data/worktrees/autre') return ['agent__run-2', '.quarantine']
        return []
      }
    })

    expect(racines[0]).toBe('C:/repo') // le workspace d'abord : le cas normal reste le plus rapide
    expect(racines).toContain('C:/data/worktrees/68fe8b08/agent__run-1')
    expect(racines).toContain('C:/data/worktrees/autre/agent__run-2')
    // Une copie d'INTÉGRATION est éphémère et appartient à la publication : rien à révéler dedans.
    expect(racines.some((r) => r.includes('integration__'))).toBe(false)
    expect(racines.some((r) => r.includes('.quarantine'))).toBe(false)
  })

  it('rend le seul workspace quand aucune copie d’agent n’existe', () => {
    expect(
      racinesRevelation({ workspace: 'C:/repo', worktreesRoot: undefined, lister: () => [] })
    ).toEqual(['C:/repo'])
  })
})

describe('honorer le numéro de ligne', () => {
  it('sans ligne, aucune commande d’éditeur : `openPath` suffit', () => {
    expect(
      commandeEditeur({ editeur: 'code -g {file}:{line}', chemin: 'C:/a.ts', ligne: undefined })
    ).toBeNull()
  })

  it('avec une ligne et un éditeur configuré, substitue chemin ET ligne', () => {
    expect(
      commandeEditeur({ editeur: 'code -g {file}:{line}', chemin: 'C:/a.ts', ligne: 80 })
    ).toEqual({
      commande: 'code',
      args: ['-g', 'C:/a.ts:80']
    })
  })

  it('sans éditeur configuré, rend null — et l’appelant devra le DIRE, pas le taire', () => {
    expect(commandeEditeur({ editeur: undefined, chemin: 'C:/a.ts', ligne: 80 })).toBeNull()
  })

  it('refuse un gabarit qui n’emploie pas {file} : ouvrirait autre chose que la cible', () => {
    expect(commandeEditeur({ editeur: 'notepad', chemin: 'C:/a.ts', ligne: 80 })).toBeNull()
  })
})

describe('quelle ligne le renderer demande vraiment', () => {
  /**
   * ATTRAPE PAR UN VRAI CLIC, PAS PAR UN TEST (2026-08-27). Le premier correctif lisait la ligne
   * dans la cible RE-parsee (`cible.line`) et ignorait `rawLine`. Or le renderer appelle
   * `revealFile(ref.path, ref.line)` : le chemin arrive SANS son suffixe `:80`. `cible.line` etait
   * donc toujours `undefined` et la route editeur ne pouvait jamais s'armer. Sonde CDP sur l'app
   * reelle : `revealFile("package.json", 3)` rendait `{ok:true}` au lieu de `ligne-non-honoree`.
   */
  it('prend la ligne passee a part quand le chemin ne la porte pas', () => {
    expect(ligneDemandee(3, undefined)).toBe(3)
  })

  it('prend celle du chemin quand la cible la porte', () => {
    expect(ligneDemandee(undefined, 80)).toBe(80)
  })

  it('refuse ce qui n’est pas un numero de ligne exploitable', () => {
    for (const brut of ['80', 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, {}]) {
      expect(ligneDemandee(brut, undefined)).toBeUndefined()
    }
  })

  it('borne la valeur : un entier absurde ne devient pas un argument d’editeur', () => {
    expect(ligneDemandee(10_000_000, undefined)).toBeUndefined()
  })
})

describe('un chemin d’éditeur avec des espaces', () => {
  /**
   * ATTRAPE PAR LA VERIFICATION DANS L'APP (2026-08-27). Le decoupage se faisait sur les espaces
   * nus : `"C:/Program Files/Microsoft VS Code/Code.exe" -g {file}:{line}` — l'editeur le plus
   * courant sous Windows — se serait scinde en cinq morceaux et n'aurait jamais demarre.
   */
  it('respecte les guillemets autour du chemin', () => {
    expect(
      commandeEditeur({
        editeur: '"C:/Program Files/Microsoft VS Code/Code.exe" -g {file}:{line}',
        chemin: 'C:/repo/a.ts',
        ligne: 80
      })
    ).toEqual({
      commande: 'C:/Program Files/Microsoft VS Code/Code.exe',
      args: ['-g', 'C:/repo/a.ts:80']
    })
  })

  it('substitue aussi a l’interieur d’un argument entre guillemets', () => {
    expect(
      commandeEditeur({
        editeur: 'edit "{file}" --line {line}',
        chemin: 'C:/mes docs/a.ts',
        ligne: 5
      })
    ).toEqual({ commande: 'edit', args: ['C:/mes docs/a.ts', '--line', '5'] })
  })
})
