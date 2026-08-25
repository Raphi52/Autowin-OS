import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { memoireDesRunsPrecedents, phasesAvecJuge } from './orchestration-memoire'
import { populateConvRunSections } from './runs/conv-runs'

/**
 * LE CHAÎNON MANQUANT (mesuré sur conv-1405, 2026-08-25).
 *
 * `orchestration-memoire.ts` lit la section `### phase judge` du RUN.md. Or AUCUN RUN.md de
 * conv-1405 n'en contient : les 5 RUN.md du dossier ne portent que `### phase build` / `think`.
 * Cause : `orchestrator.ts` garde le verdict dans `lastJudgeText` et ne le pousse JAMAIS dans
 * `phaseOutputs`, seul tableau passé à `populateConvRunSections` (`commands.ts:1807`). La mémoire
 * inter-runs est donc structurellement TOUJOURS vide en production — preuve directe : le bloc
 * « COLLECTE DE CONTEXTE » reçu par ce run ne contient aucune ligne « FINDINGS DU JUGE » alors que
 * deux runs jugés le précèdent dans la même conversation.
 *
 * Ces tests sont écrits ROUGE avant la correction.
 */
function runMdVierge(besoin: string, status: string): string {
  return `status: ${status}
session: conv-1405
regime: standard

## Besoin
${besoin}

**Critere de succes (DoD cochable)** :
- [ ] mutation produite

## Reprise
Goal:
`
}

function ecrisRun(root: string, convId: string, workspace: string, besoin: string): string {
  const dossier = join(root, convId, workspace)
  mkdirSync(dossier, { recursive: true })
  const chemin = join(dossier, 'RUN.md')
  writeFileSync(chemin, runMdVierge(besoin, 'red'), 'utf8')
  return chemin
}

const VERDICT = `Verdict : DEFAUT
- la preuve de rendu UI manque, aucune capture relue
- le compteur de defauts n est couvert par aucune assertion`

describe('chaînon juge → RUN.md → mémoire inter-runs', () => {
  it('le verdict du juge atterrit dans le RUN.md et ressort en findings pour le run suivant', () => {
    const root = mkdtempSync(join(tmpdir(), 'memoire-juge-'))
    const chemin = ecrisRun(root, 'conv-1405', 'run-a-workspace', 'cadrer la mémoire inter-runs')

    populateConvRunSections(
      chemin,
      phasesAvecJuge([{ phase: 'build', text: '## Défauts\n- un défaut noté par le build' }], VERDICT)
    )

    const md = readFileSync(chemin, 'utf8')
    expect(md).toContain('### phase judge')

    const memoire = memoireDesRunsPrecedents(root, 'conv-1405')
    expect(memoire).toHaveLength(1)
    expect(memoire[0].verdict).toMatch(/DEFAUT/i)
    expect(memoire[0].findings).toContain('la preuve de rendu UI manque, aucune capture relue')
    // le défaut du BUILD ne doit pas être maquillé en objection de juge
    expect(memoire[0].findings.join('\n')).not.toContain('un défaut noté par le build')
  })

  // L'ENTRÉE QUI DOIT FAIRE ÉCHOUER UNE CORRECTION FAUSSE : un fix naïf du type
  // `[...phases, { phase: 'judge', text: judgeText ?? '' }]` fabriquerait une section juge VIDE.
  // Le run suivant hériterait alors d'un « verdict » inexistant — un faux souvenir.
  it('sans verdict, aucune section juge fantôme n’est écrite ni mémorisée', () => {
    const root = mkdtempSync(join(tmpdir(), 'memoire-juge-vide-'))
    const chemin = ecrisRun(root, 'conv-1405', 'run-b-workspace', 'run sans juge')

    populateConvRunSections(chemin, phasesAvecJuge([{ phase: 'build', text: 'travail' }], '   '))

    expect(readFileSync(chemin, 'utf8')).not.toContain('### phase judge')
    expect(memoireDesRunsPrecedents(root, 'conv-1405')).toHaveLength(0)
  })

  it('phasesAvecJuge ne duplique pas une phase judge déjà présente', () => {
    const phases = phasesAvecJuge(
      [
        { phase: 'build', text: 'travail' },
        { phase: 'judge', text: 'Verdict : VALIDE\n- rien à redire' }
      ],
      'Verdict : VALIDE\n- rien à redire'
    )
    expect(phases.filter((p) => p.phase === 'judge')).toHaveLength(1)
  })

  it('le câblage réel passe le verdict à populateConvRunSections (pas seulement le helper)', () => {
    const source = readFileSync(join(__dirname, 'commands.ts'), 'utf8')
    expect(source).toMatch(/populateConvRunSections\(\s*runPath,\s*phasesAvecJuge\(/)
  })
})
