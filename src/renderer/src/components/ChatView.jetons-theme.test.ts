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
  '--chat-suppr-orbite',
  '--chat-suppr-kicker',
  '--chat-suppr-bouton-survol',
  '--chat-role-vous',
  '--chat-cran-rempli',
  '--chat-cran-vif',
  '--chat-cran-focus',
  '--chat-envoi-rose',
  '--chat-dictee',
  // Liseré rose de la barre de sélection multiple (conv-815), rattaché le 2026-09-28 (conv-770).
  '--chat-lot-rose'
] as const

const FAMILLE_OR = [
  '--chat-conv-separateur',
  '--chat-liste-bouton',
  '--chat-etat-question',
  '--chat-etat-non-lu',
  '--chat-consigne-limite',
  '--chat-modele-etat-texte'
] as const

/** Le bloc de jetons du mode clair, extrait une seule fois. */
const blocClair = ((): string => {
  const debut = modes.indexOf(":root[data-base='clair'] {")
  expect(debut, 'le bloc de jetons du mode clair a disparu de theme-modes.css').toBeGreaterThan(-1)
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
    /*
     * QUATRE AUTRES COULEURS RESTENT EN DUR, PAR DEUX DECISIONS DE L'UTILISATEUR (conv-246, 2026-10-11).
     *
     * Les passer par un jeton a ete essaye : la couche du theme Holographique blanc est GENEREE en
     * relisant ces valeurs litterales (`genererCoucheClaire`). Derriere un jeton, elle perdait la
     * bordure encre de la vignette, la capsule claire du mot « contexte » et le texte encre de la
     * duree -- une capsule noire et un texte blanc sur pastille claire, en theme blanc. Et deux gardes
     * exigent ces valeurs ecrites telles quelles : `ChatView.style.test.ts` (vignette BLANCHE,
     * conv-186) et `ChatContextRule.style.test.ts` (capsule NOIRE, conv-189). On les NOMME ici, a la
     * declaration pres, plutot que de laisser deux gardes se contredire en silence.
     */
    const DECLARATIONS_ASSUMEES = [
      ['.attachment-chip', 'border: 1px solid #ffffff;'],
      ['.attachment-chip > button:not(.attachment-thumb-button)', 'color: #ffffff;'],
      ['.chat-context-rule-libelle', 'background: #000000;'],
      ['.capsule-bouton .thinking-duree', 'color: #fff;']
    ]
    const utile = sansCommentaires(chat)
    const fautives: string[] = []
    const assumes: string[] = []
    const declarationsAssumees: string[] = []
    let selecteur = ''
    let propriete = ''
    // UNE REGLE PEUT LISTER PLUSIEURS SELECTEURS, un par ligne. Seule la DERNIERE ligne etait lue :
    // en ajoutant `.activity-anneau .anneau-l1 .thinking-duree` sous `.capsule-bouton
    // .thinking-duree` (conv-904), la declaration assumee ci-dessus devenait « fautive » sans avoir
    // change. Le groupe entier est donc gardé, et une exception vaut si SON selecteur en fait partie.
    let enCours: string[] = []
    let groupe: string[] = []
    const selecteurDuGroupe = (attendus: readonly string[]): string | undefined =>
      groupe.find((s) => attendus.includes(s))
    utile.split('\n').forEach((ligne, index) => {
      // Aucune ligne n'echappe au controle des couleurs ci-dessous : on ne fait que NOTER le groupe.
      if (/\{\s*$/.test(ligne)) {
        selecteur = ligne.replace(/\s*\{\s*$/, '').trim()
        groupe = [...enCours, selecteur]
        enCours = []
      } else if (/[;{}]/.test(ligne)) enCours = []
      else if (/,\s*$/.test(ligne)) enCours.push(ligne.trim().replace(/,\s*$/, ''))
      const declaration = /^\s*(-?[a-z][a-z-]*)\s*:/.exec(ligne)
      if (declaration) propriete = declaration[1]
      if (!ligne.match(HEX)) return
      // Un MASQUE ne peint rien : seule son opacite compte, sa teinte est ignoree. Le noir plein
      // `linear-gradient(#000 0 0)` du bord degrade des capsules (conv-176) n'est donc pas une
      // couleur d'interface. Toleree dans une declaration `mask` / `-webkit-mask`, et sous CETTE
      // forme seulement (conv-246).
      if (/^(-webkit-)?mask$/.test(propriete) && /^linear-gradient\(#000 0 0\)/.test(ligne.trim()))
        return
      // Seules trois formes sont tolerees, et aucune n'est une couleur d'interface reglable :
      // un TAUX d'eclaircissement dans un color-mix, une etincelle de 1 px d'un radial-gradient,
      // et les deux noirs assumes ci-dessus.
      if (/color-mix\(/.test(ligne) || /radial-gradient\(/.test(ligne)) return
      const noirAssume = selecteurDuGroupe(SELECTEURS_NOIR_ASSUME)
      if (noirAssume && /^background:\s*#000;$/.test(ligne.trim())) {
        assumes.push(noirAssume)
        return
      }
      const assumee = DECLARATIONS_ASSUMEES.find(
        ([s, d]) => groupe.includes(s) && d === ligne.trim()
      )
      if (assumee) {
        declarationsAssumees.push(`${assumee[0]} :: ${ligne.trim()}`)
        return
      }
      fautives.push(`l.${index + 1} (${selecteur}) : ${ligne.trim()}`)
    })
    expect(fautives, `couleurs ecrites en dur : \n${fautives.join('\n')}`).toEqual([])
    // Les deux exceptions sont les DEUX attendues, pas une de plus qui se serait glissee dessous.
    expect(assumes.sort()).toEqual([...SELECTEURS_NOIR_ASSUME].sort())
    // Idem pour les quatre declarations : chacune une fois, aucune de plus.
    expect(declarationsAssumees.sort()).toEqual(
      DECLARATIONS_ASSUMEES.map(([s, d]) => `${s} :: ${d}`).sort()
    )
  })

  it('garde la dette a son plancher : pas un hex de plus qu aujourd hui', () => {
    // Cliquet volontaire. Ce nombre ne doit que DESCENDRE. Descendu de 15 a 8 le 2026-10-11
    // (conv-246) : les taux d'eclaircissement et les etincelles etaient deja partis, les blancs des
    // capsules sont passes par des jetons. Restent les 2 noirs assumes, les 4 declarations assumees
    // et les 2 noirs du MASQUE du bord degrade des capsules (toleres plus haut).
    const total = (sansCommentaires(chat).match(HEX) ?? []).length
    expect(total).toBeLessThanOrEqual(8)
  })

  it('donne a chaque jeton une valeur SOMBRE litterale, jamais un renvoi', () => {
    // Plancher abaisse de 114 a 110 lors de la fusion du 2026-09-11, et voici pourquoi : quatre
    // jetons de ce chantier (--chat-jauge-plein, --chat-stop, --chat-dictee-bouton,
    // --chat-micro-repos) ne faisaient que RENVOYER a des jetons partages que l'arbre utilise
    // deja directement (--voile-rgb, --err, --text). Un alias de plus n'est pas une couleur de
    // plus : les quatre regles concernees suivent toujours les huit themes, par le jeton commun.
    // Ce nombre ne doit pas remonter par ajout de couleurs en dur -- il peut descendre encore si
    // d'autres jetons se reduisent a un alias. Descendu a 108 le 2026-09-17 : --chat-file-envoi et
    // --chat-file-orienter sont partis avec le panneau de file d'attente, retire de l'interface.
    // Descendu a 106 le 2026-10-10 (conv-178) : les six --chat-wf-bascule*/trait-*/icone* sont
    // partis avec le soulignement du bouton Details, desormais dessine par la capsule
    // Raisonnement / Actions.
    expect(definis.size).toBeGreaterThanOrEqual(106)
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
