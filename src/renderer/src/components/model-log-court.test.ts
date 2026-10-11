import { describe, expect, it } from 'vitest'
import { detailCourt, titreCourt } from './model-log-court'

/**
 * Logs « une ligne » (conv-247, 2026-10-11, maquette tour 4 piste 2 « Titres raccourcis » choisie
 * par l'utilisateur) : sur une seule ligne, « Appel modèle — claude-opus-5-5 » prenait toute la
 * place et le détail tombait à « e. ». Le titre et les chiffres sont raccourcis À L'AFFICHAGE ; le
 * texte complet reste dans la ligne dépliée, et le filtre cherche toujours dans le texte complet.
 */
describe('titreCourt — le titre de la ligne', () => {
  it('réduit un appel modèle au nom du modèle, sans le préfixe du fournisseur', () => {
    expect(titreCourt('Appel modèle — claude-opus-5-5', 'Modèle')).toBe('opus-5-5')
    expect(titreCourt('Appel modèle — gpt-5', 'Modèle')).toBe('gpt-5')
  })

  it('ne répète pas deux fois le même morceau', () => {
    expect(titreCourt('judge · judge', 'Coût')).toBe('judge')
    expect(titreCourt('build · judge', 'Coût')).toBe('build · judge')
  })

  it('rend null quand le titre ne fait que répéter la nature du geste', () => {
    expect(titreCourt('Demande', 'Demande')).toBeNull()
    expect(titreCourt('réflexion', 'Réflexion')).toBeNull()
  })

  it('laisse intact un titre ordinaire', () => {
    expect(titreCourt('Bash', 'Action')).toBe('Bash')
    expect(titreCourt('live-logs.png', 'Artefact')).toBe('live-logs.png')
  })
})

describe('detailCourt — le résumé gris de la ligne', () => {
  it('écrit les grands nombres en milliers', () => {
    expect(detailCourt('effort low · in 61204 · cache 58113')).toBe(
      'effort low · in 61 k · cache 58 k'
    )
    expect(detailCourt('in 1250000 tokens')).toBe('in 1,3 M tokens')
  })

  it('garde les petits nombres, les décimales, les identifiants et les horodatages', () => {
    expect(detailCourt('image/png · 493 × 1566 · 412 Ko')).toBe('image/png · 493 × 1566 · 412 Ko')
    expect(detailCourt('coût 1.2034 $')).toBe('coût 1.2034 $')
    expect(detailCourt('conv-24700 · run_12345 · v12345.6')).toBe(
      'conv-24700 · run_12345 · v12345.6'
    )
    expect(detailCourt('ts 1791619766383')).toBe('ts 1791619766383')
  })

  it('retire un morceau que le suivant contient déjà (« claude » puis « claude-opus-5-5 »)', () => {
    expect(detailCourt('claude · claude-opus-5-5 · in 78022 · out 1159')).toBe(
      'claude-opus-5-5 · in 78 k · out 1159'
    )
  })

  it('tient sur une ligne : les retours à la ligne et les blancs répétés deviennent une espace', () => {
    expect(detailCourt('ligne 1\n  ligne 2\tfin')).toBe('ligne 1 ligne 2 fin')
  })
})
