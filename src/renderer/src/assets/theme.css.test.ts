import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * LES CONTROLES NATIFS DE L'APPLICATION SONT SOMBRES, DECLARE UNE SEULE FOIS.
 *
 * Sans `color-scheme`, Chromium peint listes deroulantes, champs et barres de defilement en theme
 * CLAIR : le blanc du controle transparait sous les fonds semi-opaques et le texte clair devient
 * illisible (constat utilisateur du 2026-09-02 sur la liste des voix de l'assistant).
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer `color-scheme: dark` de la racine du theme — le
 * defaut redeviendrait latent sur TOUS les controles natifs de l'application.
 */
describe('theme.css — les contrôles natifs suivent le thème sombre', () => {
  const css = readFileSync(new URL('./theme.css', import.meta.url), 'utf8').replace(
    /\/\*[\s\S]*?\*\//g,
    ''
  )

  it('déclare color-scheme: dark sur la racine', () => {
    const racine = css.slice(css.indexOf(':root {'), css.indexOf('}', css.indexOf(':root {')))
    expect(racine).toMatch(/color-scheme:\s*dark/)
  })

  /*
   * LA LISTE DES THEMES SE LISAIT BLANC SUR BLANC (constat utilisateur du 2026-10-10, theme
   * Holographique). `color-scheme` ne suffit pas : la liste deroulante d'un `select` natif est une
   * fenetre a part, qui ne sait pas peindre la transparence. Elle reprend le fond du `select`
   * (`--bg-3`, blanc a 7,5 %) et le pose sur du BLANC — le texte clair du theme y disparait.
   * Le meme defaut avait deja ete rustine widget par widget (voix de l'assistant, `.select` du
   * theme Holographique) ; ici il est traite une fois pour toutes les listes : chaque ligne
   * prend le fond OPAQUE du theme.
   *
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer la regle `select option`, ou lui donner un
   * jeton de fond translucide (`--bg-1`, `--bg-3`…).
   */
  it('donne aux lignes de toute liste déroulante native le fond opaque du thème', () => {
    const regle = css.match(/(?:^|\})\s*select option\s*\{([^}]*)\}/)
    expect(regle, 'règle `select option` absente de theme.css').not.toBeNull()
    expect(regle![1]).toMatch(/background(?:-color)?:\s*var\(--bg-0\)/)
    expect(regle![1]).toMatch(/color:\s*var\(--text\)/)
  })

  it('--bg-0 est opaque dans chaque thème, sinon la liste retomberait sur du blanc', () => {
    const fichiers = [
      './theme.css',
      './theme-modes.css',
      './theme-nebuleuse-verre.css',
      './theme-nebuleuse-doree.css',
      './theme-holographique-clair.css'
    ]
    const translucides: string[] = []
    for (const f of fichiers) {
      const texte = readFileSync(new URL(f, import.meta.url), 'utf8')
      for (const m of texte.matchAll(/--bg-0:\s*([^;]+);/g)) {
        if (!/^#[0-9a-f]{6}$/i.test(m[1].trim())) translucides.push(`${f}: ${m[1].trim()}`)
      }
    }
    expect(translucides).toEqual([])
  })
})
