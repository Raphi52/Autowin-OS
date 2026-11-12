/**
 * `tests-des-feuilles.mjs` retient les garde-fous qui lisent les feuilles sur disque sans les
 * importer — ceux que `vitest related` ne trouve pas.
 */
import { describe, expect, it } from 'vitest'
import { testsLies } from './tests-des-feuilles.mjs'

const GARDE_FLOU = {
  chemin: 'src/renderer/src/assets/aucun-flou.test.ts',
  contenu: 'readdirSync(RACINE, { recursive: true }); fichiers(/\\.css$/)'
}
const GARDE_COMPOSANTS = {
  chemin: 'src/renderer/src/spinner-partout.test.ts',
  contenu: "readdirSync(dossier).filter((f) => f.endsWith('.tsx'))"
}
const NOMME = {
  chemin: 'src/renderer/src/single-dark-theme.test.ts',
  contenu: "read('./components/AgentsTopologyView.css')"
}
const SANS_RAPPORT = {
  chemin: 'src/renderer/src/components/BoardView.test.tsx',
  contenu: "import { BoardView } from './BoardView'"
}
const VOISIN = {
  chemin: 'src/renderer/src/components/OrchestratorModelSelector.test.tsx',
  contenu: "import { OrchestratorModelSelector } from './OrchestratorModelSelector'"
}
const PAR_GENERATEUR = {
  chemin: 'src/renderer/src/assets/theme-ninja-claude.test.ts',
  contenu: "await import('../../../../scripts/theme-nebuleuse-verre.mjs')"
}
const TESTS = [GARDE_FLOU, GARDE_COMPOSANTS, NOMME, SANS_RAPPORT, VOISIN]

describe('tests-des-feuilles', () => {
  it('une feuille modifiée retient le garde-fou qui balaie les feuilles et le test qui la nomme', () => {
    expect(
      testsLies({ modifies: ['src/renderer/src/components/AgentsTopologyView.css'], tests: TESTS })
    ).toEqual([GARDE_FLOU.chemin, NOMME.chemin])
  })

  it('un composant modifié retient son test voisin et le garde-fou qui balaie les composants', () => {
    expect(
      testsLies({
        modifies: ['src/renderer/src/components/OrchestratorModelSelector.tsx'],
        tests: TESTS
      })
    ).toEqual([VOISIN.chemin, GARDE_COMPOSANTS.chemin])
  })

  it('un chemin Windows est reconnu comme son équivalent à barres obliques', () => {
    expect(
      testsLies({
        modifies: ['src\\renderer\\src\\components\\OrchestratorModelSelector.tsx'],
        tests: [VOISIN]
      })
    ).toEqual([VOISIN.chemin])
  })

  it('une feuille modifiée retient le test qui passe par un script balayant les feuilles', () => {
    const modifies = ['src/renderer/src/components/WorkflowProfilesView.css']
    const tests = [...TESTS, PAR_GENERATEUR]
    expect(testsLies({ modifies, tests, balayeurs: ['theme-nebuleuse-verre.mjs'] })).toContain(
      PAR_GENERATEUR.chemin
    )
    // Sans feuille modifiée, le générateur n'a rien de neuf à relire : le test n'est pas retenu.
    expect(
      testsLies({
        modifies: ['src/renderer/src/components/BoardView.tsx'],
        tests,
        balayeurs: ['theme-nebuleuse-verre.mjs']
      })
    ).not.toContain(PAR_GENERATEUR.chemin)
  })

  it('un fichier sans rapport ne retient rien', () => {
    expect(testsLies({ modifies: ['docs/notes.md'], tests: TESTS })).toEqual([])
  })
})
