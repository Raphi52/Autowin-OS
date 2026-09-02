import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createConvRun, populateConvRunSections } from './conv-runs'
import { parseRun } from '../dashboards/runs'

/**
 * `## Défauts` était créé VIDE et jamais écrit : `dashboards/runs.ts` compte ses lignes et
 * `RunInspector` affiche « Défauts N » — donc TOUJOURS 0, y compris sur un run qui a listé ses
 * défauts dans le texte de ses phases. Le compteur mentait.
 *
 * Piège : le remplissage des autres sections remplace un commentaire gabarit `<!-- … -->`.
 * `## Défauts` n'en a pas, donc l'ajouter à cette boucle ne changerait RIEN : il faut écrire
 * SOUS le titre.
 */
describe('## Défauts — alimenté depuis le texte des phases', () => {
  const racine = () => mkdtempSync(join(tmpdir(), 'aos-convruns-defauts-'))

  it('recopie les défauts listés par une phase et le compteur cesse d’afficher 0', () => {
    const chemin = createConvRun('conv-1', 'Corrige le compteur de défauts.', racine())
    populateConvRunSections(chemin, [
      {
        phase: 'build',
        text: '## Journal\n[2026-09-02] fait\n\n## Défauts\n- compteur toujours à 0\n- section morte\n'
      }
    ])
    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('- compteur toujours à 0')
    expect(md).toContain('- section morte')
    expect(parseRun(md).defauts).toBe(2)
  })

  it('laisse la section vide quand aucune phase ne déclare de défaut', () => {
    const chemin = createConvRun('conv-2', 'Tâche sans défaut.', racine())
    populateConvRunSections(chemin, [{ phase: 'build', text: '## SOP\n1. faire\n' }])
    expect(parseRun(readFileSync(chemin, 'utf8')).defauts).toBe(0)
  })

  it('ne duplique pas les défauts quand une phase suivante repeuple le RUN', () => {
    const chemin = createConvRun('conv-3', 'Tâche répétée.', racine())
    const phase = { phase: 'build', text: '## Défauts\n- un seul défaut\n' }
    populateConvRunSections(chemin, [phase])
    populateConvRunSections(chemin, [phase])
    const md = readFileSync(chemin, 'utf8')
    expect(md.match(/- un seul défaut/g)?.length).toBe(1)
    expect(parseRun(md).defauts).toBe(1)
  })
})
