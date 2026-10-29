import { describe, expect, it } from 'vitest'
import {
  classeDeLaValeur,
  classeDuTrace,
  cssDuPersonnage,
  ecartsDesBras,
  reglesDuPersonnage,
  svgDuPersonnage,
  visageDeLaBille
} from './mascotte-personnage'

const COMPTES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '9+']
/**
 * Un sort par couleur des yeux, dans leur ordre : [dégradé des yeux de lumière, cœur de l'encre du
 * chiffre écrit, couleur vive (iris des yeux, halo de l'encre, étoile du chapeau)] (conv-1247).
 */
const SORTS = [
  ['gE', '#9fe2ff', '#58c8ff'],
  ['gEr', '#ff8a7e', '#ff3b2f'],
  ['gEj', '#ffe680', '#ffd21f'],
  ['gEv', '#8ff09f', '#3ee05a']
] as const
/** La suite des commandes d'un tracé, sans ses nombres (« M26 57.6Q… » -> « M Q L Q Z »). */
const forme = (p: string): string => p.replace(/[-\d.\s]+/gu, ' ').trim()

describe('le personnage de la mascotte — Filament blanc · Le chiffre (conv-1227)', () => {
  it('la baguette écrit vraiment chaque chiffre : sa pointe ne s’écarte jamais du tracé', () => {
    const ecarts = ecartsDesBras()
    for (const v of COMPTES) {
      // Mesuré sur les images clés que la page joue (simplifiées, arrondies au degré), en pixels.
      expect(ecarts[`trace ${v}`], `trace ${v}`).toBeLessThan(1)
    }
    expect(ecarts['gauche au travail']).toBeLessThan(1)
    expect(ecarts['bras pour toi']).toBeLessThan(1)
  })

  it('un groupe d’écriture et un chiffre dessinés par compte, « ! » en plus pour l’échec', () => {
    const svg = svgDuPersonnage()
    for (const v of COMPTES) {
      expect(svg).toContain(`class="${classeDuTrace(v)}"`)
      expect(svg).toContain(`class="ch nb ${classeDeLaValeur(v)}"`)
    }
    expect(svg).toContain('class="ch nr vx"')
    expect(classeDeLaValeur('!')).toBe('vx')
    expect(classeDuTrace('!')).toBeNull()
    expect(classeDeLaValeur('9+')).toBe('vp')
    for (const autre of [null, '10', '0', 'x', '"}'])
      expect(classeDeLaValeur(autre), String(autre)).toBeNull()
  })

  it('tout ce qu’un état rallume est éteint par la page, d’une règle qu’il peut battre', () => {
    const page = cssDuPersonnage() + svgDuPersonnage() + visageDeLaBille()
    const css = cssDuPersonnage()
    const etats = ['calme', 'travail', 'attente', 'probleme'] as const
    for (const etat of etats)
      for (const pastille of [null, '1', '3', '9+', '!']) {
        for (const [selecteur, declarations] of reglesDuPersonnage(etat, pastille)) {
          const classe = selecteur.slice(1)
          expect(page, `${etat} ${pastille} ${selecteur}`).toContain(classe)
          if (declarations === 'display:inline')
            // Une seule classe : `body .x` (posé par insertCSS, qui passe AVANT la page) l'emporte.
            expect(css, `${selecteur} éteint par la page`).toContain(`\n.${classe}{display:none}`)
        }
      }
  })

  it('chaque état a ses gestes : écrire au travail, bras levés pour toi, repos sinon', () => {
    const allume = (etat: Parameters<typeof reglesDuPersonnage>[0], p: string | null): string[] =>
      reglesDuPersonnage(etat, p)
        .filter(([, d]) => d === 'display:inline')
        .map(([s]) => s)
    expect(allume('travail', '9+')).toEqual(['.vp', '.ET', '.tp', '.fT'])
    expect(allume('attente', '2')).toEqual(['.v2', '.EA', '.fA'])
    expect(allume('calme', null)).toEqual(['.ER', '.fR', '.GF'])
    expect(allume('probleme', '!')).toEqual(['.vx', '.ER', '.fP'])
  })

  it('le visage vit : chaque état a son visage, et chaque visage s’anime (conv-1227)', () => {
    const visage = visageDeLaBille()
    const css = cssDuPersonnage()
    for (const groupe of ['fT', 'fA', 'fR', 'fP']) {
      const debut = visage.indexOf(`<g class="${groupe}">`)
      expect(debut, groupe).toBeGreaterThan(-1)
      // Chaque visage porte des classes animées de la feuille du visage (`.y .xv…{animation:…}`).
      const classes = [...visage.slice(debut).matchAll(/class="(xv[0-9a-z]+)"/gu)].map((m) => m[1])
      expect(classes.length, groupe).toBeGreaterThanOrEqual(4)
      for (const c of classes)
        expect(css, `${groupe} .${c}`).toMatch(new RegExp(`\\.y \\.${c}\\{animation:`, 'u'))
    }
    // Les bouches se transforment l'une en l'autre : même tracé (M C C Z) dans toutes les images
    // du visage (ses animations portent le préfixe `xv`).
    const visageCss = css
      .split('\n')
      .filter((l) => l.startsWith('@keyframes xv'))
      .join('\n')
    const bouches = [...visageCss.matchAll(/d:path\("([^"]+)"\)/gu)].map((m) => m[1])
    expect(bouches.length).toBeGreaterThan(10)
    for (const b of bouches) expect(forme(b)).toBe('M C C Z')
  })

  it('les pages du grimoire se tournent toutes seules, en se soulevant (conv-1227)', () => {
    const css = cssDuPersonnage()
    const svg = svgDuPersonnage()
    // Trois pages par grimoire (travail et pour toi), chacune animée.
    const pages = [
      ...svg.matchAll(
        /<path class="(a[0-9a-z]+)" d="M26 57\.6Q[^"]+" fill="#[0-9a-f]{6}" stroke="#b8955a"/gu
      )
    ]
    expect(pages.length).toBe(6)
    // Toutes les images d'une page gardent le même tracé (la propriété `d` s'interpole) ; au milieu
    // du tour, la page se dresse au-dessus du livre (son bord monte plus haut que y = 50).
    const images = [...css.matchAll(/d:path\("(M26 57\.6Q[^"]+)"\)/gu)].map((m) => m[1])
    expect(images.length).toBeGreaterThan(12)
    for (const d of images) expect(forme(d)).toBe('M Q L Q Z')
    const hauts = images.map((d) => Number(/L[-\d.]+ ([-\d.]+)/u.exec(d)?.[1]) - 5.6)
    expect(Math.min(...hauts)).toBeLessThan(50)
  })

  it('au calme le grimoire est fermé ; au travail il s’ouvre, une seule fois (conv-1227)', () => {
    const css = cssDuPersonnage()
    const svg = svgDuPersonnage()
    // Fermé : un groupe éteint par la page, que seul le calme rallume.
    expect(css).toContain('\n.GF{display:none}')
    for (const etat of ['travail', 'attente', 'probleme'] as const)
      expect(reglesDuPersonnage(etat, '1').map(([s]) => s)).not.toContain('.GF')
    const ferme = svg.slice(svg.indexOf('<g class="GF">'))
    expect(ferme).toContain('translate(-8 0)')
    // L'ouverture : des animations jouées une fois et figées sur leur fin (« 1 both »), dont la
    // couverture qui bascule (même tracé à chaque image) et le livre qui glisse de -8 px à 0.
    // Posées par la feuille du TRAVAIL, pas par la page : dans ce SVG, une animation tourne dès le
    // chargement même dans un groupe éteint, elle serait finie avant le passage au travail.
    expect(css).not.toContain('1 both')
    const uneFois = reglesDuPersonnage('travail', '2').filter(
      ([, d]) => d.startsWith('animation:') && d.endsWith(' 1 both')
    )
    expect(uneFois.length).toBeGreaterThanOrEqual(5)
    for (const [selecteur] of uneFois) expect(svg).toContain(selecteur.slice(1))
    for (const etat of ['calme', 'attente', 'probleme'] as const)
      expect(reglesDuPersonnage(etat, '1').some(([, d]) => d.endsWith(' 1 both'))).toBe(false)
    const couverture = [...css.matchAll(/d:path\("(M26 55\.1Q[^"]+)"\)/gu)].map((m) => m[1])
    expect(couverture.length).toBeGreaterThan(10)
    for (const d of couverture) expect(forme(d)).toBe('M Q L Q Z')
    expect(css).toMatch(/0%\{translate:-8px 0\}/u)
  })

  it('un grimoire remplace les pantins, la main gauche invoque, les yeux s’allument (conv-1227)', () => {
    const svg = svgDuPersonnage()
    // Plus aucun pantin : un grimoire au travail (bleu), un pour toi (or), un fermé au calme.
    expect(svg).not.toMatch(/mP[BPV]/u)
    expect(svg.match(/class="grim /gu)?.length).toBe(3)
    // L'invocation de la capture : sphère d'énergie, trois cercles magiques couchés en perspective,
    // une main ouverte aux cinq doigts. Plus de colonnes de runes qui montent (« c'est trop »).
    expect(svg).toContain('url(#oS)')
    expect(svg.match(/scale\(1 \.3\)/gu)?.length).toBe(3)
    expect(svg).not.toMatch(/gK[123]/u)
    expect(svg).toContain('M.6 .4Q-3.4 2.8-7.6-.4')
    // Les yeux de lumière n'appartiennent qu'au visage du travail, et s'allument par une animation.
    const visage = visageDeLaBille()
    const travail = visage.slice(visage.indexOf('<g class="fT">'), visage.indexOf('<g class="fA">'))
    expect(travail).toContain('url(#gE)')
    expect(travail).toContain('url(#gEh)')
    expect(visage.match(/url\(#gE\)/gu)?.length).toBe(2)
    // Un sort sur deux, ils s'allument en rouge.
    expect(travail).toContain('url(#gEr)')
    expect(travail).toContain('url(#gEhr)')
  })

  it('le chiffre écrit est grand et coloré, celui du chapeau blanc et grand (conv-1227)', () => {
    const svg = svgDuPersonnage()
    // Chaque trait écrit par la baguette est à l'encre d'une couleur des yeux (rouge seul avant
    // conv-1247), plus épais qu'avant (1,5).
    const traits = [
      ...svg.matchAll(
        /<path class="[^"]*" d="[^"]+" stroke="([^"]+)" stroke-width="([\d.]+)" stroke-dasharray/gu
      )
    ]
    expect(traits.length).toBeGreaterThanOrEqual(COMPTES.length)
    for (const [, couleur, largeur] of traits) {
      expect(SORTS.map(([, encre]) => encre)).toContain(couleur)
      expect(Number(largeur)).toBeGreaterThan(1.5)
    }
    // Le 1 écrit fait au moins 20 px de haut (16 avant).
    const un = svg.slice(svg.indexOf('class="t1"'))
    const ys = [
      ...(/d="M([^"]+)" stroke="#ff8a7e"/u.exec(un)?.[1] ?? '').matchAll(/[\d.]+ ([\d.]+)/gu)
    ].map((m) => Number(m[1]))
    expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThanOrEqual(20)
    // Le chiffre du chapeau : blanc, 26 px (16 avant), il peut déborder de l’étoile.
    expect(svg).toMatch(/<text class="ch nb v1"[^>]*font-size="26" fill="#ffffff">1<\/text>/u)
  })

  it('les bras sont noirs et mats : aucune lueur, mains d’encre (conv-1227)', () => {
    const svg = svgDuPersonnage()
    // Chaque segment de bras est un trait d'encre noire, doublé d'un reflet discret.
    expect(svg).toContain('stroke="#0c0a16" stroke-width="2.6"')
    expect(svg).not.toMatch(/stroke="#d8f0ff"|stroke="#fff3c4" stroke-width="2.4"/u)
    // Les mains sont des boules d'encre ; les anciennes mains de lumière ont disparu.
    expect(svg).toContain('fill="url(#mNr)"')
    // (La comète de « pour toi », `boule`, garde son cœur de lumière : elle n'est pas une main.)
    expect(svg).not.toMatch(/<circle cx="[^"]+" cy="[^"]+" r="4\.4" fill="url\(#o[AB]\)"/u)
  })

  it('étoile du chapeau jaune ; yeux cyan, rouges, jaunes puis verts ; symboles tracés autour (conv-1227)', () => {
    const svg = svgDuPersonnage()
    const css = cssDuPersonnage()
    // L'étoile du chapeau est pleine et jaune (« l'étoile du chapeau fais-la jaune »).
    expect(svg).toMatch(/<path d="M25 -?[\d.]+[^"]*" fill="#ffd23f"/u)
    // La lueur du chiffre la rendait gris-bleu : la copie lumineuse passe derrière l'étoile, et le
    // chiffre net, sans lueur, devant.
    const etoile = svg.indexOf('fill="#ffd23f"')
    expect(svg.indexOf('<text class="ch nb v3"')).toBeLessThan(etoile)
    expect(svg.indexOf('<text class="ch nr vx"')).toBeLessThan(etoile)
    expect(svg.indexOf('<text class="ch v3"')).toBeGreaterThan(etoile)
    expect(svg.indexOf('<text class="ch vx"')).toBeGreaterThan(etoile)
    // Les yeux de lumière passent par quatre couleurs, un sort chacune, chacune avec son halo.
    const visage = visageDeLaBille()
    const travail = visage.slice(visage.indexOf('<g class="fT">'), visage.indexOf('<g class="fA">'))
    for (const id of ['gE', 'gEr', 'gEj', 'gEv']) {
      expect(visage, id).toContain(`id="${id}"`)
      expect(travail, id).toContain(`url(#${id})`)
      expect(travail, `${id}h`).toContain(`url(#${id.replace('gE', 'gEh')})`)
    }
    // « des symboles qui se dessinent comme ce losange un peu partout autour » : le losange et
    // au moins sept autres symboles, chacun tracé par son pointillé (pathLength 30) qui se dévoile.
    const symboles = svg.match(
      /pathLength="30" stroke="#fff" stroke-width="1" stroke-dasharray="30"/gu
    )
    expect(symboles?.length).toBeGreaterThanOrEqual(8)
    expect(svg).toContain('M0-5L4 0 0 5-4 0Z')
    expect(css).toMatch(/0%\{stroke-dashoffset:30;opacity:1\}/u)
  })

  it('le chiffre écrit a la couleur dont les yeux vont s’allumer, et teint l’étoile en l’atteignant (conv-1247)', () => {
    const svg = svgDuPersonnage()
    const css = cssDuPersonnage()
    const visage = visageDeLaBille()
    /** Ce que joue une classe animée : sa durée et le corps de ses images clés. */
    const joue = (classe: string): { duree: number; images: string } => {
      const regle = new RegExp(`\\.[py] \\.${classe}\\{animation:([0-9a-z]+) ([\\d.]+)s`, 'u').exec(
        css
      )
      expect(regle, classe).not.toBeNull()
      const corps = new RegExp(`^@keyframes ${regle?.[1]}\\{(.*)\\}$`, 'mu').exec(css)
      expect(corps, regle?.[1]).not.toBeNull()
      return { duree: Number(regle?.[2]), images: corps?.[1] ?? '' }
    }
    // L'instant où le chiffre écrit se pose sur l'étoile (fin du vol, avant qu'il s'efface), en %
    // d'un sort ; un sort par couleur des yeux, le cycle des couleurs dure donc quatre sorts.
    const arrivee = Number(/([\d.]+)%\{translate:-40px -29px;scale:\.4;opacity:1\}/u.exec(css)?.[1])
    expect(arrivee).toBeGreaterThan(70)
    const n = SORTS.length
    const travail = visage.slice(visage.indexOf('<g class="fT">'), visage.indexOf('<g class="fA">'))
    const etoiles =
      /<g class="ET">((?:<g class="a[0-9a-z]+"><path d="M25 [^"]+"[^>]*\/><\/g>)+)<\/g>/u.exec(svg)
    expect(etoiles, 'étoiles de couleur, allumées au travail seulement').not.toBeNull()
    SORTS.forEach(([yeux, encre, vif], k) => {
      // L'encre de ce sort : allumée exactement pendant le même sort que les yeux de cette couleur.
      const classeYeux = new RegExp(
        `<g class="(xv[0-9a-z]+)"><ellipse [^>]*fill="url\\(#${yeux}\\)"`,
        'u'
      ).exec(travail)?.[1]
      const trace = new RegExp(
        `<g class="(a[0-9a-z]+)"><g class="a[0-9a-z]+"><path class="[^"]*gl${vif.slice(1)}[^"]*" d="[^"]+" stroke="${encre}"`,
        'u'
      ).exec(svg)?.[1]
      expect(classeYeux, yeux).toBeDefined()
      expect(trace, encre).toBeDefined()
      expect(joue(trace ?? ''), `encre ${encre} = yeux ${yeux}`).toEqual(joue(classeYeux ?? ''))
      // Chaque compte s'écrit dans cette encre.
      for (const v of COMPTES) {
        const groupe = svg.slice(svg.indexOf(`<g class="${classeDuTrace(v)}">`))
        expect(groupe.slice(0, groupe.indexOf('class="jt ')), `${v} en ${encre}`).toContain(
          `stroke="${encre}"`
        )
      }
      // L'étoile prend cette couleur quand le chiffre de ce sort l'atteint, et la garde jusqu'au suivant.
      const etoile = new RegExp(
        `<g class="(a[0-9a-z]+)"><path d="M25 [^"]+" fill="${vif}"`,
        'u'
      ).exec(etoiles?.[1] ?? '')?.[1]
      expect(etoile, `étoile ${vif}`).toBeDefined()
      const { duree, images } = joue(etoile ?? '')
      expect(duree).toBe(joue(trace ?? '').duree)
      const pct = (s: number): string =>
        `${Math.round((((100 * s + arrivee) / n) % 100) * 100) / 100}`
      expect(images, `étoile ${vif}`).toContain(`${pct(k)}%{opacity:1}`)
      expect(images, `étoile ${vif}`).toContain(`${pct(k + 1)}%{opacity:0}`)
    })
    // Hors travail, l'étoile reste jaune : les étoiles de couleur sont posées dans un groupe `ET`,
    // entre la lueur du chiffre et le chiffre net.
    const debut = etoiles?.index ?? -1
    expect(svg.indexOf('fill="#ffd23f"')).toBeLessThan(debut)
    expect(svg.indexOf('<text class="ch nb v3"')).toBeLessThan(debut)
    expect(svg.indexOf('<text class="ch v3"')).toBeGreaterThan(debut)
  })

  it('aucun script ni ressource extérieure dans le dessin', () => {
    const page = svgDuPersonnage() + visageDeLaBille() + cssDuPersonnage()
    expect(page).not.toMatch(/<script|javascript:|\son\w+=|url\((?!#)/iu)
  })
})
