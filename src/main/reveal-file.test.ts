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
import { commandeEditeur, racinesRevelation } from './reveal-file'

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
