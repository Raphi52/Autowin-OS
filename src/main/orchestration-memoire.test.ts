import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findingsDuJuge, memoireDesRunsPrecedents, resumeDesTours } from './orchestration-memoire'

/**
 * Défaut mesuré (conv-1405) : les objections du juge d'un run meurent avec ce run. Le run SUIVANT
 * de la même conversation ne reçoit que la phrase-tâche + la fin du fil ; il refait donc les mêmes
 * erreurs. Ces tests sont écrits ROUGE avant le module.
 */
function runMd(
  besoin: string,
  status: string,
  phases: Array<{ phase: string; text: string }>
): string {
  return `status: ${status}
session: conv-1405
regime: standard

## Besoin
${besoin}

**Critere de succes (DoD cochable)** :
- [ ] mutation produite

## Livrable des phases
${phases.map((p) => `### phase ${p.phase}\n${p.text}`).join('\n\n')}

## Reprise
Goal:
`
}

describe('findingsDuJuge', () => {
  it('extrait le verdict et les objections de la SEULE section juge', () => {
    const md = runMd('cadrer la mémoire', 'red', [
      {
        phase: 'build',
        text: '## Défauts\n- le build note un défaut à lui, qui n’est pas un finding de juge'
      },
      {
        phase: 'judge',
        text: 'VERDICT: REJET\n- F1 aucun test rouge fourni\n- F2 le wiring n’est pas prouvé'
      }
    ])
    const f = findingsDuJuge(md)
    expect(f.verdict).toBe('REJET')
    expect(f.findings).toEqual(['F1 aucun test rouge fourni', 'F2 le wiring n’est pas prouvé'])
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER UNE FAUSSE CORRECTION : une puce de la phase `build`
    // contenant le mot « défaut ». Un ramassage naïf sur tout le markdown la remonterait
    // comme un finding de juge — elle n'en est pas un.
    expect(f.findings.join(' ')).not.toContain('build note un défaut')
  })

  it('rend une mémoire vide quand aucune phase juge n’a tourné', () => {
    expect(
      findingsDuJuge(runMd('x', 'green', [{ phase: 'frame', text: '## Besoin\nrien' }]))
    ).toEqual({
      findings: []
    })
  })
})

describe('memoireDesRunsPrecedents', () => {
  it('remonte les findings des runs passés de la conversation, récents d’abord et bornés', () => {
    const root = mkdtempSync(join(tmpdir(), 'memoire-'))
    const ecrire = (workspace: string, md: string): string => {
      const dir = join(root, 'conv-1405', workspace)
      mkdirSync(dir, { recursive: true })
      const p = join(dir, 'RUN.md')
      writeFileSync(p, md, 'utf8')
      return p
    }
    ecrire(
      'a-1-workspace',
      runMd('run A', 'red', [{ phase: 'judge', text: 'VERDICT: REJET\n- FA objection A' }])
    )
    ecrire(
      'b-2-workspace',
      runMd('run B', 'green', [{ phase: 'judge', text: 'VERDICT: VALIDE\n- FB objection B' }])
    )
    const courant = ecrire(
      'c-3-workspace',
      runMd('run courant', 'open', [{ phase: 'judge', text: 'VERDICT: REJET\n- FC' }])
    )
    // Une AUTRE conversation ne doit jamais fuiter ici.
    mkdirSync(join(root, 'conv-autre', 'z-workspace'), { recursive: true })
    writeFileSync(
      join(root, 'conv-autre', 'z-workspace', 'RUN.md'),
      runMd('autre', 'red', [{ phase: 'judge', text: 'VERDICT: REJET\n- FZ fuite interdite' }]),
      'utf8'
    )

    const memoire = memoireDesRunsPrecedents(root, 'conv-1405', { exclureRunPath: courant, max: 2 })
    expect(memoire.map((e) => e.besoin)).toEqual(['run B', 'run A'])
    expect(memoire[0].verdict).toBe('VALIDE')
    expect(memoire[1].findings).toEqual(['FA objection A'])
    // ENTRÉES QUI DOIVENT FAIRE ÉCHOUER UNE FAUSSE CORRECTION : le run COURANT (ses findings
    // n'existent pas encore) et une AUTRE conversation.
    const texte = JSON.stringify(memoire)
    expect(texte).not.toContain('run courant')
    expect(texte).not.toContain('fuite interdite')
  })

  it('ne jette jamais quand la conversation n’a aucun run', () => {
    expect(
      memoireDesRunsPrecedents(mkdtempSync(join(tmpdir(), 'memoire-vide-')), 'conv-x')
    ).toEqual([])
  })
})

describe('resumeDesTours', () => {
  it('résume les tours ANTÉRIEURS à la fenêtre reprise, un par ligne et bornés', () => {
    const messages = Array.from({ length: 26 }, (_, i) => ({
      role: (i % 2 === 0 ? 'user' : 'assistant') as 'user' | 'assistant',
      content: `message ${i} ${'x'.repeat(400)}`
    }))
    const resume = resumeDesTours(messages, 10)
    expect(resume).toHaveLength(16)
    expect(resume[0]).toContain('message 0')
    expect(resume[15]).toContain('message 15')
    // ENTRÉE QUI DOIT FAIRE ÉCHOUER UNE FAUSSE CORRECTION : un message DANS la fenêtre (le 16e),
    // déjà transmis intégralement — le résumé ne doit pas le doubler.
    expect(resume.join('\n')).not.toContain('message 16')
    expect(resume.every((l) => l.length <= 200)).toBe(true)
  })

  it('ne résume rien quand tout le fil tient dans la fenêtre', () => {
    expect(resumeDesTours([{ role: 'user', content: 'a' }], 10)).toEqual([])
  })
})
