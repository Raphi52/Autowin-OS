import { describe, expect, it } from 'vitest'
import { SEUILS, VUES_CONNUES, resoudreVue, verdictCapture } from '../../scripts/ui-capture.mjs'

/**
 * LE HARNAIS DE CAPTURE DOIT ÊTRE INCAPABLE DE RENDRE UN FAUX VERT.
 *
 * Contexte mesuré le 2026-08-12 : le juge exigeait « une preuve UI live sur un binaire packagé
 * frais » (conv-1135) et « la capture/CDP de l'application réelle » (conv-1137) alors que le
 * producteur in-app ne dispose que de Read/Grep/Glob + Bash/Edit/Write. On met donc la preuve à
 * sa portée — mais une preuve qui peut mentir ne vaut pas mieux que pas de preuve du tout.
 *
 * Ces tests verrouillent le verdict PUR : chaque façon d'obtenir une capture creuse (mauvaise vue,
 * navigation non appliquée, page blanche, PNG vide) doit être NOMMÉE, pas seulement rejetée.
 */
describe('verdict du harnais de capture', () => {
  const bon = {
    vue: 'worktree',
    destinationActive: 'worktree',
    longueurTexte: 800,
    elements: 240,
    octetsPng: 180_000
  }

  it('valide une capture réellement rendue', () => {
    expect(verdictCapture(bon)).toEqual({ ok: true, echecs: [] })
  })

  it('refuse une capture prise sur une AUTRE vue que celle demandée', () => {
    const v = verdictCapture({ ...bon, destinationActive: 'chat' })
    expect(v.ok).toBe(false)
    expect(v.echecs.join()).toContain('navigation-non-appliquee(chat)')
  })

  it('refuse une page blanche même si le PNG est gros', () => {
    // Le cas dangereux : l'écran est noir ou vide, le fichier pèse lourd, tout « a l'air » bon.
    const v = verdictCapture({ ...bon, longueurTexte: 3, elements: 1 })
    expect(v.ok).toBe(false)
    expect(v.echecs).toContain('vue-vide-texte')
    expect(v.echecs).toContain('vue-vide-elements')
  })

  it('refuse un PNG de la taille d’une image vide', () => {
    const v = verdictCapture({ ...bon, octetsPng: 900 })
    expect(v.ok).toBe(false)
    expect(v.echecs).toContain('png-trop-petit')
  })

  it('refuse une vue inconnue au lieu de capturer n’importe quoi', () => {
    expect(verdictCapture({ ...bon, vue: undefined }).echecs).toContain('vue-inconnue')
  })

  it('cumule les motifs plutôt que de s’arrêter au premier', () => {
    const v = verdictCapture({ vue: 'worktree', destinationActive: 'chat', longueurTexte: 0, elements: 0, octetsPng: 0 })
    expect(v.echecs.length).toBeGreaterThanOrEqual(4)
  })
})

describe('résolution du nom de vue', () => {
  it('accepte les identifiants réels du catalogue applicatif', () => {
    for (const vue of VUES_CONNUES) expect(resoudreVue(vue)).toBe(vue)
  })

  it('tolère le pluriel qui traîne dans les scripts et la doc', () => {
    expect(resoudreVue('worktrees')).toBe('worktree')
  })

  it('rejette un nom inventé plutôt que de deviner', () => {
    expect(resoudreVue('dashboard')).toBeUndefined()
    expect(resoudreVue('')).toBeUndefined()
  })
})

describe('seuils', () => {
  it('reste au-dessus d’une capture vide typique', () => {
    // Un PNG 1×1 pèse ~100 octets, une frame noire compressée quelques ko : le seuil doit être
    // franchement au-dessus, sinon il laisse passer exactement ce qu'il prétend attraper.
    expect(SEUILS.octetsPng).toBeGreaterThanOrEqual(4 * 1024)
  })
})
