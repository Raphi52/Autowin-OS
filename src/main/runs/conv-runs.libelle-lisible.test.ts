import { describe, expect, it } from 'vitest'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createConvRun } from './conv-runs'

/**
 * ROUGE AVANT FIX — le nom d'un run était un bout brut de la phrase de l'utilisateur :
 * « ensuite de la meme maniere si il veut un nouveau skill … » donnait le dossier
 * `ensuite-de-la-meme-maniere-si-il-veut-un-<ts36>-workspace`, illisible en pastille
 * et impossible à recopier derrière `@run:`. Le libellé doit porter les mots PORTEURS.
 */
function sujet(task: string): string {
  const root = mkdtempSync(join(tmpdir(), 'libelle-'))
  createConvRun('conv-test', task, root, () => 0)
  const ws = readdirSync(join(root, 'conv-test'))[0]
  return ws.replace(/-0-workspace$/, '')
}

describe('libellé de run lisible', () => {
  it('écarte le remplissage conversationnel et garde les mots porteurs', () => {
    const s = sujet(
      'ensuite de la meme maniere si il veut un nouveau skill paskil juge ca utile il doit avoir un skill pour ca'
    )
    expect(s).not.toMatch(/^ensuite-de-la-meme-maniere/)
    expect(s).toContain('skill')
    expect(s.split('-').length).toBeLessThanOrEqual(6)
  })

  // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LE FILTRE EST FAUX : une consigne déjà dense.
  // Si le filtrage mordait sur les verbes/objets, ce sujet perdrait sa substance.
  it('ne mutile pas une consigne déjà dense', () => {
    expect(sujet('Corrige le bug de la recherche par terme court')).toBe(
      'corrige-bug-recherche-terme-court'
    )
  })

  it('ne coupe jamais un mot en deux', () => {
    const s = sujet(
      'Refactorise integralement le mecanisme de reconciliation des workspaces orphelins'
    )
    expect(s.endsWith('-')).toBe(false)
    for (const t of s.split('-')) expect(t.length).toBeGreaterThan(1)
  })

  /*
   * ROUGE AVANT FIX (2026-10-14) — une relance « reprend » / « go » part avec l'objectif
   * `<relance>\n\nCIBLE CONTEXTUALISEE : <sujet>` (commands.ts). Le marqueur prenait deux des six
   * mots du libellé : `go-cible-contextualisee-traite-trois-<ts>` (conv-517), et le sujet perdait
   * ses derniers mots porteurs.
   */
  it('une relance ne fait pas entrer le marqueur « CIBLE CONTEXTUALISEE » dans le libellé', () => {
    // Avant le correctif : `reprend-cible-contextualisee-corrige`.
    expect(sujet('reprend\n\nCIBLE CONTEXTUALISEE : Corrige la fuite memoire du journal')).toBe(
      'reprend-corrige-fuite-memoire-journal'
    )
  })

  // ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST SI LE RETRAIT EST TROP LARGE : un sujet qui PARLE de la
  // cible contextualisée garde ses mots — seul le marqueur posé par commands.ts est retiré.
  it('garde « cible contextualisee » quand c’est le sujet lui-même', () => {
    expect(sujet('Preserve la cible contextualisee des relances')).toBe(
      'preserve-cible-contextualisee-relances'
    )
  })

  it('retombe sur la phrase brute quand tout est du remplissage', () => {
    expect(sujet('vazy stp')).not.toBe('')
  })
})
