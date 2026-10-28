/**
 * Les deux boutons de la carte de suppression des fils, dans TOUS les thèmes (conv-1078, 2026-10-22 :
 * « applique a tous les themes mais avec des couleurs en fonction du theme »).
 *
 * Ce que ce test verrouille :
 *  - les couleurs par défaut viennent de l'ACCENT du thème (--accent, --on-accent, --text), jamais
 *    d'une couleur écrite en dur : un thème ajouté demain a ses boutons sans rien écrire ;
 *  - les règles des boutons sont assez LOURDES pour passer devant les `.btn` des thèmes, chargés
 *    après ChatView.css : Ninja Claude rendait les deux boutons gris (capture de l'utilisateur) ;
 *  - aucune feuille de thème ne repeint ces boutons : un thème n'y pose que des réglages (les
 *    propriétés --suppr-* et ce qui les nourrit, et le mouvement d'une animation) ;
 *  - les trois thèmes où l'accent seul ne suffit pas ont leur réglage (texte sombre sur accent vif,
 *    terracotta de bouton plein).
 * ENTRÉE QUI DOIT FAIRE ÉCHOUER CE TEST : écrire un hex dans les valeurs par défaut, alléger un
 * sélecteur de bouton, ou retirer le texte sombre de Machine à écrire.
 */
import { readFileSync, readdirSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'

const lire = (relatif: string): string => readFileSync(new URL(relatif, import.meta.url), 'utf8')
const chat = postcss.parse(lire('./ChatView.css'))

/** Déclarations de la (des) règle(s) dont un sélecteur, espaces normalisés, vaut `selecteur`. */
function declarations(racine: postcss.Root, selecteur: string): Record<string, string> {
  const valeurs: Record<string, string> = {}
  racine.walkRules((regle) => {
    if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
    regle.walkDecls((d) => {
      valeurs[d.prop] = d.value
    })
  })
  return valeurs
}

/** Poids (classes, attributs et pseudo-classes) d'un sélecteur sans identifiant ni élément. */
function poids(selecteur: string): number {
  const sansNot = selecteur.replace(/:not\(([^)]*)\)/g, ' $1')
  return (sansNot.match(/\.[a-z][\w-]*|\[[^\]]+\]|:(?!:)[a-z-]+/gi) ?? []).length
}

const PILE = ':root .delete-confirm-card.delete-confirm-card--fils .delete-confirm-actions--pile >'

describe('carte de suppression des fils — boutons dans tous les thèmes', () => {
  it('tire ses couleurs par défaut de l’accent du thème, sans aucune couleur en dur', () => {
    const carte = declarations(chat, '.delete-confirm-card--fils')
    expect(carte['--suppr-plein']).toBe('linear-gradient(var(--accent), var(--accent))')
    expect(carte['--suppr-plein-texte']).toBe('var(--on-accent)')
    expect(carte['--suppr-lisere']).toBe('linear-gradient(var(--accent), var(--accent))')
    expect(carte['--suppr-garder-texte']).toBe('var(--text)')
    for (const [nom, valeur] of Object.entries(carte).filter(([n]) => n.startsWith('--suppr-')))
      expect(valeur, nom).not.toMatch(/#[0-9a-f]{3,8}\b/i)
  })

  it('peint « Supprimer » plein et « Garder » cerné d’un liseré, par des sélecteurs plus lourds que les `.btn` des thèmes', () => {
    const plein = `${PILE} .btn.delete-confirm-gel`
    const garder = `${PILE} .btn.delete-confirm-cancel`
    expect(declarations(chat, plein).background).toBe('var(--suppr-plein)')
    expect(declarations(chat, plein).color).toBe('var(--suppr-plein-texte)')
    expect(declarations(chat, `${plein}:hover:not(:disabled)`).background).toBe(
      'var(--suppr-plein-vif)'
    )
    expect(declarations(chat, garder).background).toBe('transparent')
    const lisere = declarations(chat, `${garder}::before`)
    expect(lisere.background).toBe('var(--suppr-lisere)')
    expect(lisere.padding).toBe('1px')
    // Le calque évidé est celui du bord dégradé des capsules, par un sélecteur LÉGER : un seul
    // masque écrit dans la feuille (le compteur de couleurs en dur ne monte pas).
    const capsule = declarations(chat, '.delete-confirm-card--fils .delete-confirm-cancel::before')
    expect(capsule['-webkit-mask']).toContain('content-box')
    expect(capsule.background).toContain('--capsule-')
    // Les `.btn` des thèmes pèsent au plus 5 au survol (`:root[data-theme='x'] .btn:hover:not(:disabled)`).
    expect(poids(plein)).toBeGreaterThanOrEqual(6)
    expect(poids(`${plein}:hover:not(:disabled)`)).toBeGreaterThanOrEqual(8)
    expect(poids(`${garder}:hover:not(:disabled)`)).toBeGreaterThanOrEqual(8)
  })

  // Un thème peut viser ces boutons pour y poser des RÉGLAGES -- propriétés personnalisées et
  // mouvement -- jamais une propriété qui peint (fond, couleur, bord, ombre). Depuis conv-1163
  // (2026-10-27, « a mettre aussi sur ces boutons ») Holographique y pose sa lampe à lave : ses
  // gouttes ont des positions animées propres à chaque bouton, qui ne peuvent pas venir de la carte.
  it('aucune feuille de thème ne repeint ces boutons : elles n’y posent que des réglages', () => {
    const dossier = new URL('../assets/', import.meta.url)
    const fautives: string[] = []
    for (const fichier of readdirSync(dossier).filter((f) => f.endsWith('.css'))) {
      postcss.parse(readFileSync(new URL(fichier, dossier), 'utf8')).walkRules((regle) => {
        if (
          !regle.selectors.some((s) =>
            /delete-confirm-gel|delete-confirm-card--fils[^,]*delete-confirm-cancel/.test(s)
          )
        )
          return
        regle.walkDecls((d) => {
          if (!d.prop.startsWith('--') && !/^animation(-delay)?$/.test(d.prop))
            fautives.push(`${fichier} : ${regle.selector} : ${d.prop}`)
        })
      })
    }
    expect(fautives).toEqual([])
  })

  it('règle les thèmes où l’accent seul ne suffit pas', () => {
    const modes = postcss.parse(lire('../assets/theme-modes.css'))
    for (const theme of ['machine-a-ecrire', 'malvoyant-sombre'])
      expect(
        declarations(modes, `:root[data-theme='${theme}'] .delete-confirm-card--fils`)[
          '--suppr-plein-texte'
        ],
        theme
      ).toBe('var(--bg-0)')
    const ninja = postcss.parse(lire('../assets/theme-ninja-claude.css'))
    expect(
      declarations(ninja, ":root[data-theme='ninja-claude'] .delete-confirm-card--fils")[
        '--suppr-plein'
      ]
    ).toBe('linear-gradient(#c96442, #c96442)')
  })
})
