import { describe, expect, it } from 'vitest'
import { refusLancementGraphique } from './garde-lancement-graphique'

/**
 * conv-597, kaizen du 2026-09-16, turnId 4e502786-4887-4101-85b3-ea2dee304091.
 *
 * Deux editions de fichier refusees d'affilee : le geste etait `node /tmp/fix.cjs` et le TEXTE
 * ecrit dans le document en ligne contenait un motif « ...|commits?|branche|code|travail|... ».
 * Le controle decoupe la commande sur `|` : le morceau « code » devenait le premier mot d'une
 * commande, donc un lancement de VS Code. Le corps d'un heredoc est une DONNEE ; seule la ligne
 * qui le lance, et ce qui suit sa fin, sont des commandes.
 */
describe('garde graphique — le texte d’un heredoc n’est pas une commande', () => {
  it('laisse passer un heredoc dont le CORPS contient un nom d’app graphique', () => {
    const commande = [
      "cat > /tmp/fix.cjs <<'FIN'",
      'const motif = /(?:commits?|branche|code|travail)/',
      'FIN',
      'node /tmp/fix.cjs'
    ].join('\n')
    expect(refusLancementGraphique(commande)).toBeUndefined()
  })

  it('refuse toujours un vrai lancement place APRES la fin du heredoc', () => {
    const commande = ["cat > /tmp/x <<'FIN'", 'texte inoffensif', 'FIN', 'notepad /tmp/x'].join('\n')
    expect(refusLancementGraphique(commande)).toContain('refus')
  })

  it('refuse toujours un vrai lancement sur la ligne qui OUVRE le heredoc', () => {
    const commande = ["mspaint . && cat > /tmp/x <<'FIN'", 'texte', 'FIN'].join('\n')
    expect(refusLancementGraphique(commande)).toContain('refus')
  })

  it('ne coupe rien quand le heredoc n’est jamais termine', () => {
    const commande = ["cat > /tmp/x <<'FIN'", 'mspaint /tmp/x'].join('\n')
    expect(refusLancementGraphique(commande)).toContain('refus')
  })
})
