import { readFileSync } from 'node:fs'
import postcss from 'postcss'
import { describe, expect, it } from 'vitest'
import { THEMES, baseDuTheme } from '../theme-mode'

/**
 * THEME « HOLOGRAPHIQUE BLANC » (id `holographique-clair`, conv-212, 2026-10-10).
 * Demande : « un theme holographique blanc qui ressemble au holographique noir mais en gerant les
 * pbms de lisibilite », « il faut baser tous les nouveaux theme en prenant holographique noir en
 * template ». Choisi sur maquette (/draft) : « Feuille holo » + « Halo nacre » + « go le plus blanc ».
 * La feuille est DERIVEE de theme-nebuleuse-verre.css par
 * `node scripts/theme-nebuleuse-verre.mjs holographique-clair`.
 */
const lire = (fichier: string): string => readFileSync(new URL(fichier, import.meta.url), 'utf8')
const css = lire('./theme-holographique-clair.css')
const app = lire('../App.tsx')
const PREFIXE = ":root[data-theme='holographique-clair']"

/** Le premier bloc de jetons du theme (section 1 de la source). */
function blocRacine(): string {
  const debut = css.indexOf(`${PREFIXE} {`)
  if (debut < 0) throw new Error('bloc des jetons introuvable')
  return css.slice(debut, css.indexOf('\n}', debut))
}
function enHex(valeur: string): string {
  const v = valeur.trim()
  if (/^#[0-9a-f]{6}$/i.test(v)) return v.toLowerCase()
  const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(v)
  if (!m) throw new Error(`couleur opaque attendue, recu : ${v}`)
  return '#' + m.slice(1).map((n) => Number(n).toString(16).padStart(2, '0')).join('')
}
function jeton(nom: string): string {
  const m = new RegExp(`\\n\\s*${nom}:\\s*([^;]+);`).exec(blocRacine())
  if (!m) throw new Error(`${nom} absent du bloc des jetons`)
  return enHex(m[1])
}
function lum(c: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(c.slice(i, i + 2), 16) / 255)
    .map((x) => (x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
function contraste(a: string, b: string): number {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p)
  return (x + 0.05) / (y + 0.05)
}
/** Les deux fonds sous le texte : la nacre des panneaux et la page. */
const NACRE = '#f8f7fb'
const PAGE = '#f6f5f9'

describe('theme Holographique blanc', () => {
  it('est propose dans la liste sous le nom « Holographique blanc », en base claire', () => {
    expect(THEMES.find((t) => t.id === 'holographique-clair')?.libelle).toBe('Holographique blanc')
    expect(baseDuTheme('holographique-clair')).toBe('clair')
  })

  it('est importe APRES les couches claires communes et apres Holographique noir', () => {
    const position = (f: string): number => app.indexOf(`import './assets/${f}'`)
    const blanc = position('theme-holographique-clair.css')
    expect(blanc).toBeGreaterThan(position('theme-modes.css'))
    expect(blanc).toBeGreaterThan(position('theme-clair-gris.css'))
    expect(blanc).toBeGreaterThan(position('theme-nebuleuse-verre.css'))
  })

  /* La regle de l'utilisateur : tout nouveau theme part d'Holographique noir. Si la feuille du noir
     change sans regeneration, ce test echoue (meme garde que la doree). */
  it('est a jour : la feuille est exactement celle que derive le generateur depuis le noir', async () => {
    const { genererMainClair } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererMainClair()).toBe(css)
  })

  /* conv-223 (2026-10-11, capture : texte de l'agent sur un fond gris a lisere rose) : « ecris juste en
     noir sur blanc sans liserais et sans fond gris sous le texte ». La couche generee peint le meme
     selecteur (lisere rose, voile gris) avec le MEME poids : seul l'ordre d'import la faisait perdre,
     et une feuille ajoutee a chaud passe en dernier. La regle du blanc doit donc gagner par son POIDS. */
  it("ecrit la reponse de l'agent en noir sur blanc, sans lisere ni fond, quel que soit l'ordre des feuilles", () => {
    const poids = (s: string): number => (s.match(/\[[^\]]+\]|\.[\w-]+|:(?!:)[\w-]+/g) ?? []).length
    let poidsCouche = 0
    postcss.parse(lire('./theme-holographique-clair.genere.css')).walkRules((regle) => {
      const peint = regle.nodes.some((d) => d.type === 'decl' && /^(border|background)/.test(d.prop))
      if (!peint) return
      for (const s of regle.selectors) if (/\.msg-body$/.test(s) && !/\.msg\.user/.test(s)) poidsCouche = Math.max(poidsCouche, poids(s))
    })
    expect(poidsCouche).toBeGreaterThan(0)
    const decl: Record<string, string> = {}
    let poidsBlanc = 0
    postcss.parse(css).walkRules((regle) => {
      for (const s of regle.selectors) {
        if (!/\[data-base='clair'\] \.cosmic-outline \.msg\.assistant \.msg-body$/.test(s)) continue
        poidsBlanc = Math.max(poidsBlanc, poids(s))
        regle.walkDecls((d) => {
          decl[d.prop] = d.value
        })
      }
    })
    expect(poidsBlanc).toBeGreaterThan(poidsCouche)
    expect(decl).toMatchObject({ border: '0', background: 'transparent', color: '#000000' })
  })

  it('ne peint rien hors du theme', () => {
    const fautifs: string[] = []
    postcss.parse(css).walkRules((regle) => {
      if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name)) return
      for (const s of regle.selectors) if (!s.trim().startsWith(PREFIXE)) fautifs.push(s)
    })
    expect(fautifs).toEqual([])
  })

  /* Contraste WCAG calcule. Entree qui doit faire echouer : le texte lilas clair du noir (#ece8f7)
     recopie tel quel, ou le rose clair #ff8cc8 garde comme couleur de texte (2,3:1). */
  it('texte courant et secondaire >= 7:1 sur la nacre et sur la page', () => {
    for (const fond of [NACRE, PAGE]) {
      expect(contraste(jeton('--text'), fond)).toBeGreaterThanOrEqual(7)
      expect(contraste(jeton('--text-dim'), fond)).toBeGreaterThanOrEqual(7)
    }
  })
  it.each([
    '--text-faint',
    '--gold',
    '--gold-bright',
    '--cyan',
    '--ok',
    '--warn',
    '--err',
    '--chat-conv-titre',
    '--chat-conv-meta',
    '--chat-corps',
    '--chat-tete-titre',
    '--chat-role-agent',
    '--chat-role-vous'
  ])('%s >= 4,5:1 sur la nacre et sur la page', (v) => {
    for (const fond of [NACRE, PAGE]) expect(contraste(jeton(v), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le titre des modules (bloc .shell) >= 4,5:1 sur la nacre et sur la page', () => {
    const m = /--module-title-color:s*([^;]+);/.exec(css)
    expect(m, '--module-title-color absent').not.toBeNull()
    for (const fond of [NACRE, PAGE]) expect(contraste(enHex(m![1]), fond)).toBeGreaterThanOrEqual(4.5)
  })

  it('le texte pose sur le degrade reste blanc, et le blanc y passe 4,5:1 sur toute la bulle', () => {
    expect(jeton('--on-accent')).toBe('#ffffff')
    expect(jeton('--chat-corps-vous')).toBe('#ffffff')
    const bulle = css.slice(css.indexOf(`${PREFIXE} .cosmic-outline .msg.user .msg-body.msg-bulle {`))
    expect(bulle).toMatch(/background: linear-gradient\(135deg, #3c6eeb, #d02b8c\)/)
    for (const extremite of ['#3c6eeb', '#d02b8c']) expect(contraste('#ffffff', extremite)).toBeGreaterThanOrEqual(4.5)
  })

  /* conv-229 (2026-10-11, capture : « Actives », « Compacte », « Mosaique » illisibles) : « dans le
     menu en bas des conv les textes deviennent blanc quand je click dessus sur fond blanc ». Le pied
     n'a plus de fond depuis le /draft du 2026-10-10 (« rien ne s'y allume ») : aucune de ses cases,
     quel que soit son reglage, ne doit recevoir une couleur de texte illisible sur la nacre. */
  it('pied de liste : le texte de chaque case reste lisible sur la nacre, reglage change ou non', () => {
    const couleurs: string[] = []
    postcss.parse(css).walkRules((r) => {
      if (!r.selectors.some((s) => s.startsWith(PREFIXE) && s.includes('.conv-foot'))) return
      r.walkDecls('color', (d) => void couleurs.push(`${r.selectors.find((s) => s.includes('.conv-foot'))} -> ${d.value}`))
    })
    expect(couleurs.length).toBeGreaterThan(0)
    for (const c of couleurs) {
      const valeur = c.split(' -> ')[1]
      expect(contraste(enHex(valeur), NACRE), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  /* conv-229, suite (capture : « Graph » blanc sur blanc) : « pareil pour les headers du menu
     Details ». Sous le cadre a coins coupes, l'onglet actif n'a plus de pastille (conv-180) : un
     simple trait sous le mot, sur la nacre. Son texte doit donc etre lisible sur la nacre. */
  it('panneau Details : l onglet actif en trait seul reste lisible sur la nacre', () => {
    const couleurs: string[] = []
    postcss.parse(css).walkRules((r) => {
      const sel = r.selectors.find((s) => s.startsWith(PREFIXE) && s.includes('.runs-pane .workflow-section-tab'))
      if (sel) r.walkDecls('color', (d) => void couleurs.push(`${sel} -> ${d.value}`))
    })
    expect(couleurs.some((c) => c.includes('.is-active'))).toBe(true)
    for (const c of couleurs) {
      const valeur = c.split(' -> ')[1]
      expect(contraste(enHex(valeur), NACRE), c).toBeGreaterThanOrEqual(4.5)
    }
  })

  /* Ce que l'utilisateur a choisi sur maquette (conv-212). */
  it('« Le plus blanc » : satin nacre #f8f7fb, page #f6f5f9 unie', () => {
    // Teintes NOMMEES depuis conv-987 (l'entree des cadres les reprend une a une) : 0 %, 18 %,
    // 42/48/80 % et 64 % du satin.
    expect(css).toContain('--nv-satin-a: #f8f7fb;')
    expect(css).toContain('--nv-satin-b: #ffffff;')
    expect(css).toContain('--nv-satin-c: #f5f4f9;')
    expect(css).toContain('--nv-satin-d: #fcfbfe;')
    expect(css).toContain('--nv-entree-lumiere: rgba(255, 255, 255, 0.97);')
    expect(css).toMatch(new RegExp(`${PREFIXE.replace(/[[\]]/g, '\\$&')} body \\{\\s*background: #f6f5f9;`))
  })
  it('« Feuille holo » : coins bleu et rose, lisere irise en haut des panneaux', () => {
    expect(css).toContain('--nv-chanfrein-haut: #3c6eeb;')
    expect(css).toContain('--nv-chanfrein-bas: #e63ca0;')
    expect(css).toContain('--nv-holo-lisere: linear-gradient(90deg, #3c6eeb, #9b8cff 35%, #e63ca0 70%, #cfd6e4);')
    expect(css.match(/var\(--nv-holo-lisere\) left top \/ 100% 3px no-repeat/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })
  /* conv-987 (2026-10-16, capture) : pendant l'entree des cadres a chanfrein, le lisere flottait seul
     en haut de cadres encore vides. Il se pose desormais avec le satin, dans les MEMES teintes que le
     lisere de repos (sinon il sauterait a la fin de l'entree). */
  it('pose le lisere avec le satin pendant l entree des cadres, dans ses teintes de repos', () => {
    const debut = css.indexOf(`${PREFIXE} :is(.view-page, .home-tile__panel, .home-view__masthead)[data-entree-chanfrein],\n${PREFIXE} .cosmic-outline :is(.conv-pane, .chat, .runs-pane)[data-entree-chanfrein] {\n  --nv-holo-lisere:`)
    expect(debut).toBeGreaterThan(-1)
    const entree = css.slice(debut, css.indexOf('}', debut))
    const teintes = [...entree.matchAll(/color-mix\(in srgb, (#[0-9a-f]{6}) calc\(var\(--ch-fond\) \* 100%\), transparent\)( \d+%)?/g)].map(
      (m) => `${m[1]}${m[2] ?? ''}`
    )
    expect(teintes.join(', ')).toBe('#3c6eeb, #9b8cff 35%, #e63ca0 70%, #cfd6e4')
  })
  it('« Halo nacre » : la lumiere de la souris est un blanc a 97 %, le neon Brume entoure la bulle', () => {
    expect(css).toContain('--nv-lumiere-couleur: rgba(255, 255, 255, 0.97);')
    const brume = css.slice(css.indexOf(`${PREFIXE} .cosmic-outline .msg.user .msg-body.msg-bulle::before {`))
    expect(brume).toMatch(/background: inherit;\s*filter: blur\(22px\);\s*opacity: 0\.45;/)
  })

  /* 2026-10-11 (conv-212, capture de l'utilisateur) : les reponses du bloc ASK restaient des barres
     #202020 sous un texte devenu encre. Entree qui doit faire echouer : `.askd-item` remis dans la
     liste des regles « posees sur le degrade ». */
  it('bloc ASK : les reponses sont des plaques nacrees, plus aucun fond #202020 / #2c2c2c', () => {
    const regles: string[] = []
    postcss.parse(css).walkRules((r) => {
      if (/\.askd-item/.test(r.selector)) r.walkDecls(/^background/, (d) => void regles.push(d.value))
    })
    expect(regles.length).toBeGreaterThan(0)
    expect(regles.join(' ')).not.toMatch(/#202020|#2c2c2c|#222222/i)
  })
  /* conv-225 (2026-10-11, /draft du bloc ASK en blanc, tour 1 : « go : fais le 3 »). La plaque grise
     #eceaf2 du cadre irise (conv-202) jurait sur la page #f6f5f9. Version 3 « Liseré du haut » : nacre,
     contour gris fin, lisere irise de 3 px en haut ; reponses en capsules blanches, l'irise ne revient
     qu'au survol, au focus et sur la recommandee. Entree qui doit faire echouer : ces regles retirees du
     complement (le gris du cadre derive du noir revient), ou ecrites a UN seul attribut (elles ne
     pesent alors pas plus que les regles derivees du noir). */
  it('bloc ASK « Liseré du haut » : nacre, contour gris, lisere irise en haut, irise des reponses au survol seulement', () => {
    const P = `${PREFIXE}[data-base='clair']`
    const regle = (selecteur: string): Record<string, string> => {
      const decl: Record<string, string> = {}
      postcss.parse(css).walkRules((r) => {
        if (!r.selectors.includes(`${P} ${selecteur}`)) return
        r.walkDecls((d) => void (decl[d.prop] = d.value))
      })
      return decl
    }
    expect(regle('.askd')).toMatchObject({
      border: '1px solid rgba(20, 15, 40, 0.13)',
      background: 'var(--nv-holo-lisere) left top / 100% 3px no-repeat, #fdfdff'
    })
    expect(regle('.askd .askd-item')).toMatchObject({
      border: '1px solid rgba(20, 15, 40, 0.12)',
      background: '#ffffff'
    })
    expect(regle('.askd:not(.est-repondu) .askd-item:is(:hover, :focus-within, .est-reco)').background).toBe(
      'linear-gradient(#ffffff, #ffffff) padding-box, var(--nv-askd-holo) border-box'
    )
    expect(regle('.askd .askd-pied')).toMatchObject({
      'border-image': 'none',
      'border-top': '1px solid rgba(20, 15, 40, 0.1)'
    })
    // La reponse cochee ou retenue garde le degrade de la bulle (conv-201) : rien ne doit la repeindre en blanc.
    expect(regle('.askd .askd-item:has(.askd-coche input:checked)').background).toContain('var(--nv-degrade) padding-box')
  })
  it('capsule d actions terminee : trait vert du theme et teinte verte, plus le sarcelle de la base claire', () => {
    const i = css.indexOf(`${PREFIXE} .cosmic-outline .activity-group[data-state='done'] {`)
    expect(i).toBeGreaterThan(0)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toContain('border-left-color: #09712c;')
    expect(regle).toMatch(/rgba\(0, 190, 70, 0\.14\)/)
    expect(contraste('#09712c', NACRE)).toBeGreaterThanOrEqual(4.5)
  })

  /* /draft du bloc de fin de tour (conv-212, 2026-10-11) : « Cadre holo », puis « go met le 5 »
     (titre et filet). Entree qui doit faire echouer : le cadre or bruni recolore du noir revenu,
     ou l'emoji du titre laisse en encre transparente (il disparaitrait). */
  it('bloc Fait : cadre holo du bloc ASK, « Fait » en degrade, emoji garde, filet irise sous la liste', () => {
    const P = `${PREFIXE}[data-base='clair'] .md-final-summary`
    const bloc = (suffixe: string): string => {
      const i = css.indexOf(`${P}${suffixe}`)
      expect(i, `${P}${suffixe} absent`).toBeGreaterThan(0)
      return css.slice(i, css.indexOf('}', i))
    }
    expect(bloc(' {')).toMatch(
      /repeating-linear-gradient\(100deg, #3c6eeb 0, #d02b8c 60px, #d9d9d9 120px, #ff8cc8 180px, #3c6eeb 240px\)/
    )
    expect(bloc(' {')).toContain('box-shadow: none;')
    // Le titre garde l'encre (l'emoji reste en couleur) ; un calque « eclaircir » colore le mot seul.
    // Un decoupage background-clip: text reduisait l'emoji a un carre bleu (capture du 2026-10-11).
    const titre = bloc(' > span:first-child > span:first-child,')
    expect(titre).toContain('color: #1c172b;')
    expect(titre).not.toMatch(/text-fill-color: transparent|background-clip: text/)
    const calque = bloc(' > span:first-child > span:first-child::after,')
    expect(calque).toMatch(/mix-blend-mode: lighten;/)
    expect(calque).toMatch(/left: 1.5em;/)
    expect(bloc(' > span:first-child > .md-list:nth-child(2) {')).toMatch(/border-image: linear-gradient\(90deg, #3c6eeb/)
    for (const c of ['#2f56c9', '#b01d7c']) expect(contraste(c, '#fdfdff')).toBeGreaterThanOrEqual(4.5)
  })
})

/*
 * COUCHE GENEREE (2026-10-11, conv-212 : « corrige les elements sombres »). Comme le noir, le blanc
 * a une couche qui retraduit les couleurs ecrites en dur dans les composants.
 */
describe('theme Holographique blanc — couche generee des composants', () => {
  const couche = lire('./theme-holographique-clair.genere.css')

  it('est a jour avec les feuilles des composants', async () => {
    const { genererCoucheClaire } = await import('../../../../scripts/theme-nebuleuse-verre.mjs')
    expect(genererCoucheClaire().css).toBe(couche)
  })

  /* Importee APRES la base claire, elle l'ecrasait a specificite egale : decor etoile revenu, menu
     actif efface (captures du 2026-10-11). Entree qui doit faire echouer : l'import remis apres
     theme-modes.css. */
  it('est importee AVANT la base claire commune et avant la feuille du theme', () => {
    const position = (f: string): number => app.indexOf(`import './assets/${f}'`)
    const genere = position('theme-holographique-clair.genere.css')
    expect(genere).toBeGreaterThan(0)
    expect(genere).toBeLessThan(position('theme-modes.css'))
    expect(genere).toBeLessThan(position('theme-holographique-clair.css'))
  })

  it('ne peint rien hors du theme et ne recopie aucune image', () => {
    const fautifs: string[] = []
    postcss.parse(couche).walkRules((regle) => {
      if (regle.parent?.type === 'atrule' && /keyframes/i.test((regle.parent as postcss.AtRule).name)) return
      for (const s of regle.selectors) if (!s.trim().startsWith(PREFIXE)) fautifs.push(s)
    })
    expect(fautifs).toEqual([])
    // La galaxie de theme.css revenait derriere les panneaux quand sa valeur etait recopiee.
    expect(couche).not.toMatch(/url\(/i)
  })

  it('les fonds d encre des vues deviennent nacre (Knowledge, Agent Studio)', () => {
    const fond = (selecteur: string): string => {
      const i = couche.indexOf(`${PREFIXE} ${selecteur} {`)
      expect(i, `${selecteur} absent de la couche`).toBeGreaterThan(0)
      return couche.slice(i, couche.indexOf('}', i))
    }
    expect(fond('.graph-refresh')).toMatch(/rgba\(253, 253, 255, 0\.95\)/)
    expect(fond('.theme-cluster-label')).toMatch(/rgba\(253, 253, 255, 0\.9\)/)
  })
})

/**
 * ASCENSEURS VISIBLES SUR LA NACRE (conv-250, 2026-10-11 : « corrige dans le generateur du theme
 * Holographique blanc la couleur du curseur des barres de defilement, pour qu'elles soient visibles
 * sur la nacre dans toute l'app »). Le generateur classait `scrollbar-color` et le fond du curseur
 * `::-webkit-scrollbar-thumb` en « fond » : le blanc a 16 % d'Holographique noir restait blanc, donc
 * invisible -- releve dans les huit zones qui defilent de l'app, toutes regies par la regle `*`.
 * ENTREE QUI DOIT FAIRE ECHOUER : un curseur qui redevient blanc (ou toute couleur claire), ou un
 * curseur dont l'ecart a la nacre tombe sous celui du noir sur son fond.
 */
describe('ascenseurs du theme Holographique blanc', () => {
  const regleDe = (selecteur: string): Record<string, string> => {
    const valeurs: Record<string, string> = {}
    postcss.parse(css).walkRules((regle) => {
      if (!regle.selectors.some((s) => s.replace(/\s+/g, ' ').trim() === selecteur)) return
      regle.walkDecls((d) => {
        valeurs[d.prop] = d.value.replace(/\s+/g, ' ').trim()
      })
    })
    return valeurs
  }
  /** Premiere couleur rgba() d'une valeur. */
  const rgba = (valeur: string): [number, number, number, number] => {
    const m = /rgba\((\d+), (\d+), (\d+), ([\d.]+)\)/.exec(valeur)
    if (!m) throw new Error(`rgba() attendu en tete, recu : ${valeur}`)
    return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
  }
  /** La couleur VUE : le curseur translucide pose sur le fond donne. */
  const compose = ([r, g, b, a]: [number, number, number, number], fond: string): string => {
    const f = [1, 3, 5].map((i) => parseInt(fond.slice(i, i + 2), 16))
    return (
      '#' +
      [r, g, b]
        .map((c, i) => Math.round(f[i] + (c - f[i]) * a).toString(16).padStart(2, '0'))
        .join('')
    )
  }
  const curseurs = (): [string, [number, number, number, number]][] => [
    ['scrollbar-color de *', rgba(regleDe(`${PREFIXE} *`)['scrollbar-color'])],
    ['::-webkit-scrollbar-thumb', rgba(regleDe(`${PREFIXE} ::-webkit-scrollbar-thumb`).background)]
  ]

  it('peint le curseur en encre, la meme que l ascenseur du fil (--chat-ascenseur)', () => {
    const fil = /--chat-ascenseur:\s*([^;]+);/.exec(blocRacine())?.[1].trim()
    expect(fil, '--chat-ascenseur derive dans le blanc').toBeDefined()
    for (const [ou, couleur] of curseurs()) {
      const [r, g, b] = couleur
      // Une encre : chaque canal sous la moitie (le defaut : 255, 255, 255).
      expect(Math.max(r, g, b), ou).toBeLessThan(128)
      expect(`rgba(${couleur.join(', ')})`, ou).toBe(fil)
    }
    // La piste reste transparente : seul le curseur se voit.
    expect(regleDe(`${PREFIXE} *`)['scrollbar-color']).toMatch(/ transparent$/)
  })

  it('detache le curseur de la nacre au moins autant que le noir detache le sien', () => {
    // Holographique noir : blanc a 16 % sur #0a0a0a -> environ 1,5:1 (discret par choix).
    const noir = contraste(compose([255, 255, 255, 0.16], '#0a0a0a'), '#0a0a0a')
    for (const [ou, couleur] of curseurs()) {
      for (const fond of [NACRE, PAGE]) {
        expect(contraste(compose(couleur, fond), fond), `${ou} sur ${fond}`).toBeGreaterThan(
          noir * 0.9
        )
      }
    }
  })
})

/*
 * LE DETAIL DU COUT N'EST PAS COUPE (conv-981, 2026-10-15). La ligne d'en-tete coupe ses elements
 * trop longs (`.chat-runtime > * { overflow: hidden }`). Le cout du fil y vit depuis qu'il a quitte
 * la zone de saisie, et son detail s'ouvre en position absolue SOUS lui : coupe, il etait invisible
 * (mesure : clic sur « 8,55 $ », aucun panneau a l'ecran, a 900 comme a 1600 px de large).
 */
describe('Holographique blanc : le detail du cout de la ligne d en-tete', () => {
  it('laisse deborder le bloc du cout, et lui seul', () => {
    let debordement: string | undefined
    postcss.parse(css).walkRules((regle) => {
      if (regle.selectors.some((s) => /\.chat-runtime\s*>\s*\.conv-cost$/.test(s))) {
        regle.walkDecls('overflow', (d) => {
          debordement = d.value
        })
      }
    })
    expect(debordement).toBe('visible')
  })
})
