import { enHexadecimal } from '../theme-mode'

/**
 * LE THÈME DES SCHÉMAS MERMAID, TIRÉ DU THÈME DE L'APP (conv-1235, 2026-10-28 : « on pourrait
 * rendre les graph mermaid plus beau ? »).
 *
 * Avant : `theme: 'dark'` figé. Les schémas gardaient la palette grise de mermaid, sa police
 * Trebuchet en 16 px et ses traits épais — sans rapport avec l'or et la typographie du fil, et
 * franchement faux sur un thème CLAIR (boîtes noires sur fond blanc).
 *
 * Ici : thème `base` de mermaid, dont TOUTES les couleurs sont lues sur les jetons CALCULÉS du
 * thème appliqué (`--gold-doux`, `--text`, `--text-dim`, `--bg-0`). Un thème ajouté demain n'a
 * rien à déclarer. Mermaid dérive ses teintes secondaires avec khroma, qui veut des couleurs
 * opaques : on lui donne donc de l'hexadécimal, et les fonds teintés sont mélangés ICI avec le
 * fond de page.
 *
 * Tout ou rien : un jeton illisible (test sans feuille de style, document détaché) rend `null`,
 * et l'appelant garde le thème sombre de mermaid plutôt qu'un mélange de deux palettes.
 */

/** Les jetons lus. `fond` sert aux mélanges : les boîtes sont un fond de page légèrement teinté. */
const JETONS = {
  fond: '--bg-0',
  texte: '--text',
  texteDoux: '--text-dim',
  or: '--gold-doux',
  orClair: '--gold-clair'
} as const

type Palette = Record<keyof typeof JETONS, string>

/** Mélange linéaire de deux couleurs hexadécimales : `part` de `a`, le reste de `b`. */
export function melanger(a: string, b: string, part: number): string {
  const canaux = (hex: string): number[] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
  const [ca, cb] = [canaux(a), canaux(b)]
  return `#${ca
    .map((v, i) =>
      Math.round(v * part + cb[i] * (1 - part))
        .toString(16)
        .padStart(2, '0')
    )
    .join('')}`
}

/** Configuration mermaid à passer à `initialize`, hors réglages de sécurité (posés par l'appelant). */
export interface ConfigThemeMermaid {
  theme: 'base'
  darkMode: boolean
  fontFamily: string
  /** Couleurs à plat, plus quelques groupes par type de schéma (`xyChart`, `radar`, `packet`…). */
  themeVariables: Record<string, string | boolean | Record<string, string | number>>
  themeCSS: string
  flowchart: { curve: 'basis'; padding: number; nodeSpacing: number; rankSpacing: number }
  sequence: {
    mirrorActors: boolean
    actorMargin: number
    width: number
    height: number
    actorFontSize: number
    messageFontSize: number
    noteFontSize: number
  }
}

/**
 * Lit la palette du thème appliqué et en fait la configuration mermaid. `lire` rend la valeur
 * CALCULÉE d'un jeton (les `var()` déjà résolus) ; `clair` dit si le thème est à fond clair.
 */
export function configMermaidDuTheme(
  lire: (jeton: string) => string,
  clair: boolean
): ConfigThemeMermaid | null {
  const palette = {} as Palette
  for (const [champ, jeton] of Object.entries(JETONS) as [keyof Palette, string][]) {
    const hex = enHexadecimal(lire(jeton).trim())
    if (!hex) return null
    palette[champ] = hex
  }
  const police = lire('--font').trim() || "'Segoe UI', system-ui, sans-serif"
  const { fond, texte, texteDoux, or, orClair } = palette

  // Boîtes : le fond de page à peine teinté d'or, bordées d'or — la même main que les kickers.
  const boite = melanger(or, fond, clair ? 0.1 : 0.14)
  const boite2 = melanger(texteDoux, fond, clair ? 0.08 : 0.12)
  const groupe = melanger(texte, fond, clair ? 0.03 : 0.045)
  const bordGroupe = melanger(texteDoux, fond, 0.4)
  const trait = melanger(texteDoux, fond, 0.85)
  // Douze teintes DISTINCTES, l'or en tête : les couleurs d'accent du thème quand il en a, sinon
  // des tons d'or et de texte. Elles servent aux camemberts, à l'échelle `cScale` (carte mentale,
  // frise, treemap, radar, kanban), aux branches git et aux barres d'histogramme.
  // Un jeton absent, ou égal à une teinte déjà prise (`--info` vaut `--cyan` dans plusieurs thèmes),
  // cède la place à son repli : deux sections voisines ne doivent pas se confondre.
  const prises = new Set<string>([or])
  const facultatif = (jeton: string, repli: string): string => {
    const lue = enHexadecimal(lire(jeton).trim())
    const teinte = lue && !prises.has(lue) ? lue : repli
    prises.add(teinte)
    return teinte
  }
  const teintes = [
    or,
    facultatif('--violet', melanger(or, fond, 0.55)),
    facultatif('--cyan', melanger(texteDoux, or, 0.7)),
    facultatif('--ok', melanger(texteDoux, or, 0.4)),
    facultatif('--rose', melanger(orClair, fond, 0.6)),
    facultatif('--info', melanger(texte, texteDoux, 0.5)),
    facultatif('--warn', melanger(orClair, texteDoux, 0.5)),
    facultatif('--err', melanger(texteDoux, fond, 0.5)),
    texteDoux,
    orClair,
    melanger(or, texte, 0.5),
    melanger(texteDoux, fond, 0.7)
  ]
  // Parts de camembert : éteintes vers le fond pour rester sobres.
  const parts = teintes.map((c) => melanger(c, fond, 0.72))
  // Échelle `cScale` : mermaid l'ASSOMBRIT de 75 % en mode sombre quand on ne la donne pas (boîtes
  // noires constatées au rendu du 2026-10-28). Fond de section = la teinte fondue dans le fond de
  // page, bord = la teinte plus présente, texte = celui du thème.
  const echelle = teintes.map((c) => melanger(c, fond, clair ? 0.2 : 0.3))
  const echelleBord = teintes.map((c) => melanger(c, fond, clair ? 0.55 : 0.65))
  const variablesDeEchelle = Object.fromEntries(
    teintes.flatMap((c, i): [string, string][] => [
      [`cScale${i}`, echelle[i]],
      [`cScalePeer${i}`, echelleBord[i]],
      // `cScaleInv` sert de couleur PLEINE (courbes du radar, barres) : la teinte elle-même.
      [`cScaleInv${i}`, melanger(c, fond, 0.85)],
      [`cScaleLabel${i}`, texte]
    ])
  )

  return {
    theme: 'base',
    darkMode: !clair,
    fontFamily: police,
    themeVariables: {
      darkMode: !clair,
      background: fond,
      fontFamily: police,
      fontSize: '13px',
      primaryColor: boite,
      primaryBorderColor: or,
      primaryTextColor: texte,
      secondaryColor: boite2,
      secondaryBorderColor: texteDoux,
      secondaryTextColor: texte,
      tertiaryColor: groupe,
      tertiaryBorderColor: bordGroupe,
      tertiaryTextColor: texte,
      mainBkg: boite,
      nodeBorder: or,
      nodeTextColor: texte,
      textColor: texte,
      titleColor: orClair,
      lineColor: trait,
      arrowheadColor: trait,
      defaultLinkColor: trait,
      clusterBkg: groupe,
      clusterBorder: bordGroupe,
      edgeLabelBackground: fond,
      labelBackground: fond,
      noteBkgColor: melanger(or, fond, 0.08),
      noteBorderColor: melanger(or, fond, 0.55),
      noteTextColor: texte,
      actorBkg: boite,
      actorBorder: or,
      actorTextColor: texte,
      actorLineColor: bordGroupe,
      signalColor: trait,
      signalTextColor: texte,
      labelBoxBkgColor: boite,
      labelBoxBorderColor: or,
      labelTextColor: texte,
      loopTextColor: texteDoux,
      activationBkgColor: boite2,
      activationBorderColor: texteDoux,
      sequenceNumberColor: fond,
      stateBkg: boite,
      // Mermaid prend sinon `stateBkg` comme couleur du NOM de l'état : texte sur fond identique,
      // donc invisible (constaté au rendu du 2026-10-28).
      stateLabelColor: texte,
      transitionColor: trait,
      specialStateColor: or,
      ...Object.fromEntries(parts.map((c, i) => [`pie${i + 1}`, c])),
      pieOpacity: '0.92',
      pieStrokeColor: fond,
      pieOuterStrokeColor: bordGroupe,
      pieTitleTextColor: texte,
      pieSectionTextColor: texte,
      pieLegendTextColor: texte,
      ...variablesDeEchelle,
      // Parcours utilisateur (journey) : ses sections lisent `fillType0..7`.
      ...Object.fromEntries(echelle.slice(0, 8).map((c, i) => [`fillType${i}`, c])),
      // Branches git : la teinte presque pleine, nom de branche écrit dans le fond pour contraster.
      ...Object.fromEntries(
        teintes.slice(0, 8).flatMap((c, i): [string, string][] => [
          [`git${i}`, melanger(c, fond, 0.85)],
          [`gitBranchLabel${i}`, fond]
        ])
      ),
      commitLabelColor: texteDoux,
      commitLabelBackground: fond,
      tagLabelColor: texte,
      tagLabelBackground: boite,
      tagLabelBorder: or,
      // Matrice effort/valeur : quatre quadrants à peine distincts, points d'or.
      quadrant1Fill: boite,
      quadrant2Fill: melanger(or, fond, clair ? 0.06 : 0.09),
      quadrant3Fill: groupe,
      quadrant4Fill: melanger(texteDoux, fond, clair ? 0.06 : 0.08),
      quadrant1TextFill: texte,
      quadrant2TextFill: texte,
      quadrant3TextFill: texte,
      quadrant4TextFill: texte,
      quadrantPointFill: or,
      quadrantPointTextFill: texte,
      quadrantXAxisTextFill: texteDoux,
      quadrantYAxisTextFill: texteDoux,
      quadrantInternalBorderStrokeFill: bordGroupe,
      quadrantExternalBorderStrokeFill: melanger(or, fond, 0.55),
      quadrantTitleFill: texte,
      // Gantt : mermaid alterne ses bandes de section avec du BLANC pur, même en sombre.
      sectionBkgColor: groupe,
      sectionBkgColor2: groupe,
      altSectionBkgColor: fond,
      excludeBkgColor: groupe,
      gridColor: bordGroupe,
      todayLineColor: or,
      taskBkgColor: boite,
      taskBorderColor: melanger(or, fond, 0.6),
      taskTextColor: texte,
      taskTextLightColor: texte,
      taskTextDarkColor: texte,
      taskTextOutsideColor: texte,
      taskTextClickableColor: orClair,
      activeTaskBkgColor: melanger(or, fond, clair ? 0.3 : 0.4),
      activeTaskBorderColor: or,
      doneTaskBkgColor: melanger(texteDoux, fond, 0.22),
      doneTaskBorderColor: melanger(texteDoux, fond, 0.6),
      critBkgColor: melanger(teintes[7], fond, 0.35),
      critBorderColor: teintes[7],
      ...Object.fromEntries(teintes.slice(0, 8).map((c, i) => [`venn${i + 1}`, c])),
      vennTitleTextColor: texte,
      vennSetTextColor: texte,
      // Les groupes ci-dessous remplacent EN ENTIER ceux de mermaid : toutes leurs clés sont dites.
      xyChart: {
        // Transparent : le graphique se pose sur le fond du fil, sans rectangle noir.
        backgroundColor: 'transparent',
        titleColor: texte,
        dataLabelColor: texte,
        xAxisTitleColor: texteDoux,
        xAxisLabelColor: texte,
        xAxisTickColor: bordGroupe,
        xAxisLineColor: bordGroupe,
        yAxisTitleColor: texteDoux,
        yAxisLabelColor: texte,
        yAxisTickColor: bordGroupe,
        yAxisLineColor: bordGroupe,
        plotColorPalette: teintes.map((_, i) => variablesDeEchelle[`cScaleInv${i}`]).join(',')
      },
      radar: {
        axisColor: bordGroupe,
        axisStrokeWidth: 1,
        axisLabelFontSize: 12,
        curveOpacity: 0.35,
        curveStrokeWidth: 1.5,
        graticuleColor: bordGroupe,
        graticuleStrokeWidth: 1,
        graticuleOpacity: 0.5,
        legendBoxSize: 12,
        legendFontSize: 12
      },
      packet: {
        startByteColor: texteDoux,
        endByteColor: texteDoux,
        labelColor: texte,
        titleColor: texte,
        blockStrokeColor: or,
        blockFillColor: boite
      },
      treeView: {
        labelFontSize: '13px',
        labelColor: texte,
        lineColor: bordGroupe,
        iconColor: texteDoux,
        descriptionColor: texteDoux,
        highlightBg: boite,
        highlightStroke: or
      }
    },
    // Ce que les variables n'atteignent pas : coins arrondis, traits fins, libellés de flèche
    // plus petits. Mermaid préfixe ces règles par l'identifiant du schéma : elles ne sortent pas.
    themeCSS: [
      '.node rect,.node polygon,.node path.basic,.cluster rect{stroke-width:1px}',
      '.node rect.basic,.node rect.label-container,.cluster rect{rx:6px;ry:6px}',
      '.flowchart-link,.edgePath .path,.messageLine0,.messageLine1,.transition{stroke-width:1.25px}',
      '.edgeLabel,.edgeLabel p,.edgeLabel span{font-size:11.5px}',
      `.edgeLabel p,.labelBkg{background-color:${fond}}`,
      `.cluster-label .nodeLabel,.cluster-label span{color:${or};font-size:11px;letter-spacing:.06em;text-transform:uppercase}`,
      '.actor{stroke-width:1px}',
      `.note{stroke-width:1px}`,
      // Le radar peint ses courbes avec `cScale`, ici des FONDS de case presque noirs en sombre :
      // ses courbes prennent la teinte pleine, comme les barres d'histogramme.
      ...teintes.map((_, i) => {
        const plein = variablesDeEchelle[`cScaleInv${i}`]
        return `.radarCurve-${i},.radarLegendBox-${i}{fill:${plein};stroke:${plein};color:${plein}}`
      }),
      // Sankey : mermaid pose `mix-blend-mode: multiply` EN STYLE EN LIGNE sur chaque lien —
      // sur un fond sombre, la multiplication noircit les liens jusqu'à les effacer (rendu du
      // 2026-10-28). D'où le `!important`, seul moyen de passer devant un style en ligne.
      clair ? '' : '.links .link{mix-blend-mode:normal!important}',
      `.links{stroke-opacity:${clair ? 0.45 : 0.4}}`,
      `.node-labels text{fill:${texte}}`
    ].join(''),
    flowchart: { curve: 'basis', padding: 10, nodeSpacing: 34, rankSpacing: 42 },
    // Sans les acteurs répétés en bas : un échange court prend moitié moins de hauteur.
    sequence: {
      mirrorActors: false,
      actorMargin: 40,
      width: 120,
      height: 40,
      actorFontSize: 13,
      messageFontSize: 13,
      noteFontSize: 12
    }
  }
}

/**
 * La palette que mermaid 11.16 écrit EN DUR dans le sankey : d3 `schemeTableau10`
 * (`sankeyDiagram-*.mjs`, `d3scaleOrdinal(d3schemeTableau10)`). Ni `themeVariables` ni `themeCSS`
 * ne l'atteignent : le seul réglage, `sankey.nodeColors`, se donne nœud par nœud et ne couvre pas un
 * schéma inconnu d'avance. Le n-ième nœud rencontré reçoit la n-ième couleur, liens compris (les
 * dégradés reprennent la couleur de leurs deux nœuds).
 */
const PALETTE_FIGEE_DU_SANKEY = [
  '#4e79a7',
  '#f28e2c',
  '#e15759',
  '#76b7b2',
  '#59a14f',
  '#edc949',
  '#af7aa1',
  '#ff9da7',
  '#9c755f',
  '#bab0ab'
]

/**
 * Repeint un sankey dessiné par mermaid aux teintes du thème (conv-1235, 2026-10-28) : chaque
 * couleur figée devient la teinte pleine de même rang (`cScaleInv<rang>`, celle des barres
 * d'histogramme et des courbes du radar). Correspondance un pour un, donc un nœud et ses liens
 * gardent la même couleur. Un autre schéma, une couleur hors palette ou l'absence de thème laissent
 * le dessin intact.
 */
export function teindreSankey(svg: string, theme: ConfigThemeMermaid | null): string {
  if (!theme || !svg.includes('aria-roledescription="sankey"')) return svg
  return svg.replace(
    /(fill|stop-color)="(#[0-9a-f]{6})"/gi,
    (tout, attribut: string, hex: string) => {
      const rang = PALETTE_FIGEE_DU_SANKEY.indexOf(hex.toLowerCase())
      const teinte = rang < 0 ? undefined : theme.themeVariables[`cScaleInv${rang}`]
      return typeof teinte === 'string' ? `${attribut}="${teinte}"` : tout
    }
  )
}

/** La configuration du thème APPLIQUÉ au document, ou `null` hors d'une page stylée. */
export function configMermaidDuDocument(): ConfigThemeMermaid | null {
  const racine = globalThis.document?.documentElement
  if (!racine || !globalThis.getComputedStyle) return null
  const styles = globalThis.getComputedStyle(racine)
  return configMermaidDuTheme(
    (jeton) => styles.getPropertyValue(jeton),
    racine.getAttribute('data-base') === 'clair'
  )
}
