import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * GARDE DU CHANTIER DES COULEURS DU CHAT.
 *
 * Pourquoi ce test existe. `ChatView.css` portait 251 couleurs ECRITES EN DUR. Sur un fond noir
 * elles etaient justes ; le jour ou l'application a eu quatre themes clairs, elles sont devenues
 * un texte quasi blanc sur une page blanche et des blocs noirs au milieu du blanc. Deux tranches
 * ont vide cette dette : l'or (25252fbd), puis les 68 valeurs de secours mortes et les 148
 * couleurs restantes, rattachees a 114 jetons `--chat-*`.
 *
 * Trois choses peuvent defaire ce travail, et ce test les refuse une par une :
 *
 *  1. REECRIRE UNE COULEUR EN DUR dans la feuille. Le seul hex encore tolere est un hex qui n'est
 *     PAS une couleur d'interface : un taux d'eclaircissement dans un `color-mix()`, ou une
 *     etincelle de 1 px d'un `radial-gradient()`. Toute autre forme fait echouer le premier cas.
 *
 *  2. CHANGER LA VALEUR SOMBRE d'un jeton en la remplacant par un renvoi. La valeur sombre de
 *     chaque `--chat-*` est, au caractere pres, celle qui etait en dur : c'est ce qui garantit que
 *     le theme Sombre -- le defaut -- rend exactement les memes pixels. Le deuxieme cas exige donc
 *     un hex LITTERAL dans `theme.css`, jamais un `var(...)`.
 *
 *  3. OUBLIER LE MODE CLAIR. Un jeton sans valeur claire laisse la zone en teinte de nuit sur une
 *     page claire -- le defaut d'origine, revenu par la porte de derriere. Le troisieme cas exige
 *     une valeur sous `[data-base='clair']` pour chaque jeton, sauf les trois qui sont poses sur
 *     un aplat restant sombre dans les deux modes (ils sont nommes ci-dessous).
 *
 * Et le quatrieme cas tient la DECISION PRODUIT du 2026-09-06 : l'or et le rose sont rattaches,
 * jamais alteres. En mode clair ils partent vers la famille or et la famille rose du theme, jamais
 * vers un gris ni vers l'accent inverse.
 *
 * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : remettre `color: #dbe4ec` dans ChatView.css, ou ecrire
 * `--chat-corps: var(--text)` dans theme.css, ou retirer une ligne du bloc clair.
 */

const chat = readFileSync(new URL('./ChatView.css', import.meta.url), 'utf8')
const theme = readFileSync(new URL('../assets/theme.css', import.meta.url), 'utf8')
const modes = readFileSync(new URL('../assets/theme-modes.css', import.meta.url), 'utf8')

/** Les commentaires citent des couleurs pour expliquer d'anciens defauts : ils ne peignent rien. */
const sansCommentaires = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '')

const HEX = /#[0-9a-fA-F]{3,8}\b/g

/**
 * Les trois jetons poses sur un aplat qui reste SOMBRE dans les deux modes. Les eclaircir les
 * rendrait illisibles : le surlignage de recherche est peint sur un or fixe, et le voile de depot
 * de fichier porte son propre fond sombre en dur.
 */
const RESTENT_SOMBRES = [
  '--chat-surlignage-texte',
  '--chat-depot-texte',
  '--chat-depot-detail'
] as const

/** L'IDENTITE d'Autowin : ces jetons appartiennent a la famille rose, ceux d'apres a l'or. */
const FAMILLE_ROSE = [
  '--chat-conv-filet-active',
  '--chat-signal-rose',
  '--chat-wf-trait-rose',
  '--chat-wf-icone-active',
  '--chat-suppr-orbite',
  '--chat-suppr-kicker',
  '--chat-suppr-bouton-survol',
  '--chat-role-vous',
  '--chat-cran-rempli',
  '--chat-cran-vif',
  '--chat-cran-focus',
  '--chat-envoi-rose',
  '--chat-dictee'
] as const

const FAMILLE_OR = [
  '--chat-conv-separateur',
  '--chat-liste-bouton',
  '--chat-wf-trait-or',
  '--chat-etat-question',
  '--chat-etat-non-lu',
  '--chat-consigne-limite',
  '--chat-modele-etat-texte',
  '--chat-file-envoi'
] as const

/** Le bloc de jetons du mode clair, extrait une seule fois. */
const blocClair = ((): string => {
  const debut = modes.indexOf(":root[data-base='clair'] {")
  expect(debut, "le bloc de jetons du mode clair a disparu de theme-modes.css").toBeGreaterThan(-1)
  return modes.slice(debut, modes.indexOf('\n}', debut))
})()

/** Les jetons `--chat-*` reellement appeles par la feuille du chat. */
const appeles = new Set(
  [...sansCommentaires(chat).matchAll(/var\((--chat-[a-z0-9-]+)\)/g)].map((m) => m[1])
)

/** Les jetons `--chat-*` definis dans theme.css, avec leur valeur sombre. */
const definis = new Map(
  [...theme.matchAll(/^\s*(--chat-[a-z0-9-]+):\s*([^;]+);/gm)].map((m) => [m[1], m[2].trim()])
)

describe('les couleurs du Chat passent par des jetons de theme', () => {
  it('ne reecrit AUCUNE couleur d interface en dur dans ChatView.css', () => {
    /*
     * DEUX NOIRS RESTENT ECRITS EN DUR, ET C'EST VOULU.
     *
     * `.conv-menu-pop` et `.cosmic-outline .conv-pane` ont DEJA leur regle de mode clair dans
     * theme-modes.css (`background: #ffffff`), plus specifique que le jeton : les rattacher
     * n'aurait rien reteinte. Et surtout, `assets/ui-system.test.ts` exige la un noir OPAQUE et
     * NEUTRE -- defaut vecu le 2026-08-18 avec `#0b0f14`, un gris-bleu pris pour un noir. Passer
     * par un jeton aurait force a relacher cette garde-la. On garde donc le noir, et on le NOMME
     * ici plutot que de laisser la regle s'assouplir en silence.
     */
    const SELECTEURS_NOIR_ASSUME = ['.conv-menu-pop', '.cosmic-outline .conv-pane']
    const utile = sansCommentaires(chat)
    const fautives: string[] = []
    const assumes: string[] = []
    let selecteur = ''
    utile.split('\n').forEach((ligne, index) => {
      if (/\{\s*$/.test(ligne)) selecteur = ligne.replace(/\s*\{\s*$/, '').trim()
      if (!ligne.match(HEX)) return
      // Seules trois formes sont tolerees, et aucune n'est une couleur d'interface reglable :
      // un TAUX d'eclaircissement dans un color-mix, une etincelle de 1 px d'un radial-gradient,
      // et les deux noirs assumes ci-dessus.
      if (/color-mix\(/.test(ligne) || /radial-gradient\(/.test(ligne)) return
      if (SELECTEURS_NOIR_ASSUME.includes(selecteur) && /^background:\s*#000;$/.test(ligne.trim())) {
        assumes.push(selecteur)
        return
      }
      fautives.push(`l.${index + 1} (${selecteur}) : ${ligne.trim()}`)
    })
    expect(fautives, `couleurs ecrites en dur : \n${fautives.join('\n')}`).toEqual([])
    // Les deux exceptions sont les DEUX attendues, pas une de plus qui se serait glissee dessous.
    expect(assumes.sort()).toEqual([...SELECTEURS_NOIR_ASSUME].sort())
  })

  it('garde la dette a son plancher : pas un hex de plus qu aujourd hui', () => {
    // Cliquet volontaire. 15 = 10 taux d'eclaircissement (boutons Envoyer / Arreter) + 3
    // etincelles de la carte de suppression + 2 noirs assumes. Ce nombre ne doit que DESCENDRE.
    const total = (sansCommentaires(chat).match(HEX) ?? []).length
    expect(total).toBeLessThanOrEqual(15)
  })

  it('donne a chaque jeton une valeur SOMBRE litterale, jamais un renvoi', () => {
    expect(definis.size).toBeGreaterThanOrEqual(114)
    const mauvais = [...definis].filter(([, valeur]) => !/^#[0-9a-fA-F]{3,8}$/.test(valeur))
    expect(
      mauvais.map(([nom, valeur]) => `${nom} = ${valeur}`),
      'la valeur sombre doit rester le hex exact qui etait en dur : un var() la ferait deriver'
    ).toEqual([])
  })

  it('definit tout jeton appele, et n en laisse aucun orphelin', () => {
    const appelesNonDefinis = [...appeles].filter((n) => !definis.has(n))
    expect(appelesNonDefinis, 'appeles par ChatView.css mais absents de theme.css').toEqual([])
    const definisNonAppeles = [...definis.keys()].filter((n) => !appeles.has(n))
    expect(definisNonAppeles, 'definis dans theme.css mais plus utilises').toEqual([])
  })

  it('donne a chaque jeton une valeur pour les themes CLAIRS', () => {
    const oublies = [...definis.keys()].filter(
      (nom) =>
        !(RESTENT_SOMBRES as readonly string[]).includes(nom) &&
        !new RegExp(`^\\s*${nom}:`, 'm').test(blocClair)
    )
    expect(
      oublies,
      'sans valeur claire, ces zones restent en teinte de nuit sur une page claire'
    ).toEqual([])
    // Et les trois exceptions restent des exceptions : elles n en ont PAS.
    for (const nom of RESTENT_SOMBRES) {
      expect(new RegExp(`^\\s*${nom}:`, 'm').test(blocClair), nom).toBe(false)
    }
  })

  it('rattache l or et le rose sans jamais les alterer (decision du 2026-09-06)', () => {
    for (const nom of FAMILLE_ROSE) {
      const clair = new RegExp(`^\\s*${nom}:\\s*([^;]+);`, 'm').exec(blocClair)?.[1]?.trim()
      expect(clair, `${nom} : aucune valeur claire`).toBeTruthy()
      expect(clair, `${nom} doit rester dans la famille rose en mode clair`).toMatch(
        /^var\(--rose(-bright)?\)$/
      )
    }
    for (const nom of FAMILLE_OR) {
      const clair = new RegExp(`^\\s*${nom}:\\s*([^;]+);`, 'm').exec(blocClair)?.[1]?.trim()
      expect(clair, `${nom} : aucune valeur claire`).toBeTruthy()
      expect(clair, `${nom} doit rester dans la famille or en mode clair`).toMatch(
        /^var\(--gold(-bright|-doux|-clair)?\)$/
      )
    }
  })
})
