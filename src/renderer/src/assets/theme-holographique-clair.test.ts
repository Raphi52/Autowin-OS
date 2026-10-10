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

  /* Ce que l'utilisateur a choisi sur maquette (conv-212). */
  it('« Le plus blanc » : satin nacre #f8f7fb, page #f6f5f9 unie', () => {
    expect(css).toContain('#f8f7fb 0%, #ffffff 18%')
    expect(css).toMatch(new RegExp(`${PREFIXE.replace(/[[\]]/g, '\\$&')} body \\{\\s*background: #f6f5f9;`))
  })
  it('« Feuille holo » : coins bleu et rose, lisere irise en haut des panneaux', () => {
    expect(css).toContain('--nv-chanfrein-haut: #3c6eeb;')
    expect(css).toContain('--nv-chanfrein-bas: #e63ca0;')
    expect(css).toContain('--nv-holo-lisere: linear-gradient(90deg, #3c6eeb, #9b8cff 35%, #e63ca0 70%, #cfd6e4);')
    expect(css.match(/var\(--nv-holo-lisere\) left top \/ 100% 3px no-repeat/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
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
  it('capsule d actions terminee : trait vert du theme et teinte verte, plus le sarcelle de la base claire', () => {
    const i = css.indexOf(`${PREFIXE} .cosmic-outline .activity-group[data-state='done'] {`)
    expect(i).toBeGreaterThan(0)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toContain('border-left-color: #09712c;')
    expect(regle).toMatch(/rgba\(0, 190, 70, 0\.14\)/)
    expect(contraste('#09712c', NACRE)).toBeGreaterThanOrEqual(4.5)
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
