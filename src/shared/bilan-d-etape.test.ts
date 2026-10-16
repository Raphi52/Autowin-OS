import { describe, expect, it } from 'vitest'
import { BILAN_MAX, extraireBilan } from './bilan-d-etape'
import { formatOrchestrationOutcome } from './orchestration-outcome'

/**
 * LE BLOC FIXE DE FIN D'ETAPE (conv-989, 2026-10-16) : une etape termine sa sortie par
 * `### Bilan de l'étape` (verdict, fichiers touches, preuves, reste a faire). Le code le reconnait
 * et le remonte EN ENTIER quand il coupe la sortie — bulle affichee, agregat du juge.
 */
const BILAN = [
  '### Bilan de l’étape',
  '- Verdict : fait — 6 pistes classées',
  '- Fichiers touchés : aucun',
  '- Preuves : src/main/orchestrator.ts:1141 lu',
  '- Reste à faire : choisir la piste'
].join('\n')

describe('extraireBilan', () => {
  it('trouve le DERNIER bilan, et s’arrête aux lignes techniques finales', () => {
    const texte = `${'corps '.repeat(50)}\n### Bilan de l'étape\n- Verdict : ancien\n\nsuite\n${BILAN}\nSUITE: fin\nAUTOWIN_PARI_V1: {"confiance":0.6}`
    const trouve = extraireBilan(texte)
    expect(trouve?.bilan).toBe(BILAN)
    expect(trouve?.sansBilan).toContain('SUITE: fin')
    expect(trouve?.sansBilan).toContain('AUTOWIN_PARI_V1')
    expect(trouve?.sansBilan).not.toContain('6 pistes classées')
    expect(trouve?.sansBilan).toContain('- Verdict : ancien')
  })

  it('accepte l’apostrophe droite et un niveau de titre voisin', () => {
    expect(extraireBilan(`x\n## Bilan de l'étape\n- Verdict : fait`)?.bilan).toContain(
      'Verdict : fait'
    )
  })

  it('sans bilan : rien n’est extrait', () => {
    expect(extraireBilan('juste un texte\n### Bilan général\n- autre chose')).toBeUndefined()
  })

  it('un bilan démesuré est borné, et le dit', () => {
    const trouve = extraireBilan(`### Bilan de l’étape\n- Verdict : ${'x'.repeat(BILAN_MAX * 2)}`)
    expect(trouve?.bilan.length).toBeLessThanOrEqual(BILAN_MAX + 40)
    expect(trouve?.bilan).toMatch(/bilan coupé/)
  })
})

describe('la bulle affichée garde le bilan quand elle coupe le résultat', () => {
  it('résultat de 20 000 caractères : coupé, mais son bilan reste lisible en entier', () => {
    const texte = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      runPath: 'C:/runs/conv/pistes-workspace/RUN.md',
      result: `${'| 1 | piste longue |\n'.repeat(1_000)}${BILAN}\nSUITE: fin`
    })
    expect(texte).toContain('[tronqué')
    expect(texte).toContain(BILAN)
    // La bulle ne grossit que du bilan : la coupe d'affichage reste une coupe.
    expect(texte.length).toBeLessThan(4_000 + 1_500)
  })

  it('résultat court : affiché tel quel, le bilan n’est pas dupliqué', () => {
    const texte = formatOrchestrationOutcome(true, {
      status: 'succeeded',
      valid: true,
      gateBlocked: false,
      reused: false,
      result: `trois pistes\n${BILAN}`
    })
    expect(texte.split('### Bilan de l’étape')).toHaveLength(2)
  })
})
