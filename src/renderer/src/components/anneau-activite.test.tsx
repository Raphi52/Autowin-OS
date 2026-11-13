// @vitest-environment happy-dom
/**
 * Le cadre « grand, deux lignes » de la barre d'activite (2026-10-12, /draft : « grand 2 lignes »,
 * « Pleine largeur », « couleur sur l'exception », puis « Rond de verre »).
 *
 * Ce que ces tests verrouillent :
 *  - le ROND DE VERRE porte le nombre et la COULEUR du verdict du groupe (vert, rouge, ambre) — un
 *    groupe « avec erreur » ne peut pas avoir un rond vert (le faux vert refuse depuis le 2026-08-26
 *    sur l'en-tete) ;
 *  - le VERDICT se lit en deux cases (commande, code) sans perdre son texte ;
 *  - la LEGENDE ne colore que l'exception et ne fond jamais un echec dans des reussites voisines ;
 *  - le cadre n'ecrit AUCUNE couleur en dur et aucune feuille de theme ne le repeint : c'est ce qui
 *    le rend juste dans tous les themes (le defaut de l'ancienne carte, repeinte par sept feuilles) ;
 *  - au repos, l'anneau n'est que noir, cerne d'un liseré : la VAGUE, une diagonale qui traverse chaque bloc encadre
 *    par la carte graphique seule, porte seule le reflet, en un seul passage pour tout le groupe
 *    (Actions d'abord, puis Raisonnement, puis Etapes).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegendeDesOutils, VagueDuCadre } from './anneau-activite'
import {
  ANIMATIONS_D_ATTERRISSAGE,
  ANIMATIONS_DE_VAGUE,
  caleSurLHorlogeCommune,
  casesDuVerdict,
  exceptionDuGroupe,
  groupesDeLegende,
  verdictDuRond
} from './anneau-activite-calcul'
import { AssistantActivityGroup } from './ChatView.parts'
import { ThinkingBlock } from './ThinkingBlock'

const ICI = dirname(fileURLToPath(import.meta.url))

describe('verdictDuRond — la couleur du rond', () => {
  // « je preferais voir du vert et rouge la jme rend pas compte si un truc a rate »
  it('un groupe tout reussi est vert, un groupe avec un echec est rouge', () => {
    expect(exceptionDuGroupe(['ok', 'ok', 'ok'])).toBeNull()
    expect(verdictDuRond(['ok', 'ok', 'ok'])).toBe('ok')
    expect(verdictDuRond(['ok', 'ko', 'ok'])).toBe('ko')
  })

  // La plus grave l'emporte : un echec cache dans un groupe qui tourne encore doit se voir.
  it('un echec l emporte sur une attente, une attente sur ce qui tourne', () => {
    expect(exceptionDuGroupe(['ok', 'encours', 'ko'])).toBe('ko')
    expect(exceptionDuGroupe(['encours', 'attente'])).toBe('attente')
    expect(exceptionDuGroupe(['ok', 'encours'])).toBe('encours')
  })
})

describe('casesDuVerdict — commande et code', () => {
  it('coupe « commande → code » en deux cases', () => {
    expect(casesDuVerdict('npm run typecheck → exit 0')).toEqual({
      commande: 'npm run typecheck',
      code: 'exit 0'
    })
  })

  it('garde un verdict sans fleche en une seule case', () => {
    expect(casesDuVerdict('échec : tests rouges')).toEqual({ code: 'échec : tests rouges' })
    expect(casesDuVerdict('succeeded')).toEqual({ code: 'succeeded' })
  })
})

describe('groupesDeLegende — regroupement des repetitions', () => {
  it('regroupe les outils CONSECUTIFS de meme nom et de meme verdict', () => {
    expect(
      groupesDeLegende([
        { nom: 'brain_query', etat: 'ok' },
        { nom: 'brain_read', etat: 'ok' },
        { nom: 'brain_read', etat: 'ok' }
      ])
    ).toEqual([
      { nom: 'brain_query', etat: 'ok', fois: 1 },
      { nom: 'brain_read', etat: 'ok', fois: 2 }
    ])
  })

  // ENTREE QUI FAIT ECHOUER UN REGROUPEMENT PAR NOM SEUL : l'echec du 6e Edit disparaitrait dans
  // « Edit ×4 », alors que c'est la seule chose a voir.
  it('ne fond jamais un echec dans des reussites de meme nom', () => {
    expect(
      groupesDeLegende([
        { nom: 'Edit', etat: 'ok' },
        { nom: 'Edit', etat: 'ko' },
        { nom: 'Edit', etat: 'ok' }
      ]).map((g) => [g.nom, g.etat, g.fois])
    ).toEqual([
      ['Edit', 'ok', 1],
      ['Edit', 'ko', 1],
      ['Edit', 'ok', 1]
    ])
  })
})

let container: HTMLDivElement
let root: Root
beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  container = document.createElement('div')
  document.body.appendChild(container)
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

describe('LegendeDesOutils — couleur sur l exception', () => {
  it('un outil reussi n a pas de point ; en cours, en echec ou en attente, il en a un', () => {
    act(() =>
      root.render(
        createElement(LegendeDesOutils, {
          outils: [
            { nom: 'Read', etat: 'ok' },
            { nom: 'Grep', etat: 'ok' },
            { nom: 'Grep', etat: 'ok' },
            { nom: 'Edit', etat: 'ko' },
            { nom: 'verify', etat: 'encours' },
            { nom: 'run', etat: 'attente' }
          ]
        })
      )
    )
    const items = [...container.querySelectorAll('[data-testid="legende-outil"]')]
    expect(
      items.map((i) => [
        i.textContent,
        i.getAttribute('data-etat'),
        Boolean(i.querySelector('.legende-point'))
      ])
    ).toEqual([
      ['Read', 'ok', false],
      ['Grep ×2', 'ok', false],
      ['Edit', 'ko', true],
      ['verify', 'encours', true],
      ['run', 'attente', true]
    ])
  })
})

type Action = Parameters<typeof AssistantActivityGroup>[0]['actions'][number]
const action = (over: Partial<Action>): Action =>
  ({ kind: 'action', name: 'brain_read', args: {}, ok: true, ...over }) as Action

describe('la barre d activite porte le rond de verre, la legende et le verdict', () => {
  const rendre = (actions: Action[]): void => {
    act(() => root.render(createElement(AssistantActivityGroup, { actions })))
  }
  const couleur = (): string | null =>
    container.querySelector('[data-testid="activity-compte"]')?.getAttribute('data-verdict') ?? null

  it('le nombre dans le rond, a la couleur de ce qui tourne', () => {
    rendre([
      action({ name: 'brain_query' }),
      action({ name: 'brain_read' }),
      action({ name: 'brain_read', ok: undefined })
    ])
    const rond = container.querySelector('[data-testid="activity-compte"]')
    expect(rond?.getAttribute('data-etats')).toBe('ok ok encours')
    expect(rond?.textContent).toBe('3')
    expect(couleur()).toBe('encours')
    // Le cadre porte toujours l'etat du groupe (contrat de B3-γ) et allume son reflet en cours.
    const cadre = container.querySelector('.activity-anneau')
    expect(cadre?.getAttribute('data-state')).toBe('running')
    expect(cadre?.classList.contains('is-live')).toBe(true)
    // La phrase d'etat reste ENTIERE (aucun libelle change).
    expect(cadre?.textContent).toContain('2 actions terminées · 1 action en cours')
  })

  // ENTREE QUI FAIT ECHOUER UNE PASTILLE PERMANENTE : un groupe tout reussi doit rester silencieux.
  it('un groupe tout reussi a un rond VERT', () => {
    rendre([action({ name: 'brain_query' }), action({ name: 'brain_read' })])
    expect(container.querySelector('[data-testid="activity-compte"]')?.textContent).toBe('2')
    expect(couleur()).toBe('ok')
  })

  it('l echec rend le rond ROUGE et colore la legende', () => {
    rendre([action({ name: 'brain_query' }), action({ name: 'brain_read', ok: false })])
    expect(
      container.querySelector('[data-testid="activity-compte"]')?.getAttribute('data-etats')
    ).toBe('ok ko')
    expect(couleur()).toBe('ko')
    const legende = [...container.querySelectorAll('[data-testid="legende-outil"]')]
    expect(legende.map((l) => l.getAttribute('data-etat'))).toEqual(['ok', 'ko'])
    expect(container.querySelector('.activity-anneau')?.getAttribute('data-state')).toBe('failed')
  })

  // ENTREE QUI FAIT ECHOUER UN ETAT TIRE DU SEUL `ok` : un depot Brain refuse REUSSIT a rendre un
  // refus (`ok` reste vrai) — l'en-tete dit « sans effet », le rond ne peut pas etre vert.
  it('un groupe sans effet a un rond ambre, jamais vert', () => {
    rendre([
      action({
        name: 'remember',
        ok: true,
        args: { title: 'Une leçon' },
        data: { allowed: false, stored: false, reason: 'type invalide' }
      } as Partial<Action>)
    ])
    expect(container.querySelector('.activity-anneau')?.getAttribute('data-state')).toBe('failed')
    expect(container.querySelector('[data-testid="activity-group"]')?.textContent).toContain(
      'sans effet'
    )
    expect(couleur()).toBe('attente')
    expect(
      container.querySelector('[data-testid="legende-outil"]')?.getAttribute('data-etat')
    ).toBe('attente')
  })

  // Le verdict d'une verification : deux cases, la commande puis le code. Le texte entier reste
  // lisible tel quel (copie, infobulle, tests existants qui lisent « … → exit 1 »).
  it('le verdict se lit en deux cases, sans perdre son texte', () => {
    rendre([
      action({
        name: 'verify',
        ok: false,
        data: { exitCode: 1, command: 'npm test', ok: false }
      } as Partial<Action>)
    ])
    const verdict = container.querySelector('[data-testid="activity-outcome"]')
    expect(verdict?.querySelector('.verdict-commande')?.textContent).toBe('npm test')
    expect(verdict?.querySelector('.verdict-code')?.textContent).toBe('exit 1')
    expect(verdict?.textContent).toBe('npm test → exit 1')
    expect(verdict?.className).toContain('st-failed')
  })
})

describe('le cadre est dessine par les jetons du theme, et par lui seul', () => {
  const css = readFileSync(join(ICI, 'anneau-activite.css'), 'utf8')

  it('n ecrit aucune couleur en dur (hors masques, ou seule l opacite compte)', () => {
    // Une declaration de masque peut tenir sur plusieurs lignes : on la retire entiere.
    const sansMasques = css
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/(-webkit-)?mask(-composite)?\s*:[^;]*;/g, '')
    expect(sansMasques).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i)
  })

  /**
   * EN COURS, le verre s'allume ; plus d'aura fixe autour du cadre : l'aura passe avec la vague
   * (« de base ya une aura violette […] l'aura lumineuse autour du bouton suit la vague reflet »).
   * ENTREE QUI DOIT FAIRE ECHOUER : une lueur fixe remise sur le cadre en cours, ou un verre en cours
   * qui ne s'allume plus.
   */
  it('allume le verre quand ca tourne, sans aura fixe autour du cadre', () => {
    const i = css.indexOf('.cadre-anneau.is-live {')
    expect(i).toBeGreaterThan(-1)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toMatch(/--chat-capsule-reflet-haut/)
    expect(regle).not.toMatch(/box-shadow/)
  })

  /** Le corps d'une regle de anneau-activite.css, sans ses commentaires. */
  function regleDe(selecteur: string): string {
    const debut = css.indexOf(`${selecteur} {`)
    expect(debut, selecteur).toBeGreaterThan(-1)
    return css.slice(debut, css.indexOf('\n}', debut)).replace(/\/\*[\s\S]*?\*\//g, '')
  }
  /** Les couches de `background:`, coupees aux virgules de premier niveau. */
  function couchesDuFond(regle: string): { valeur: string; couches: string[] } {
    const fond = regle.slice(regle.indexOf('background:') + 'background:'.length)
    const valeur = fond.slice(0, fond.indexOf(';'))
    const couches: string[] = []
    let profondeur = 0
    let courante = ''
    for (const c of valeur) {
      if (c === '(') profondeur++
      if (c === ')') profondeur--
      if (c === ',' && profondeur === 0) {
        couches.push(courante.trim())
        courante = ''
      } else courante += c
    }
    couches.push(courante.trim())
    return { valeur, couches }
  }
  const THEME = readFileSync(join(ICI, '..', 'assets', 'theme.css'), 'utf8')
  const MODES = readFileSync(join(ICI, '..', 'assets', 'theme-modes.css'), 'utf8')

  /**
   * ANNEAU HOLOGRAPHIQUE : un seul dessin pour le bord de tous les blocs encadres du fil, copie de
   * l'anneau d'un bouton de verre choisi par l'utilisateur. AU REPOS, LE NOIR SEUL ET SON LISERE :
   * le point blanc, son spectre et son aura ne passent qu'avec la vague. ENTREE QUI DOIT FAIRE
   * ECHOUER CE TEST : retirer un bloc de la liste, ecrire une couleur en dur, remettre des bandes
   * grises ou teintees (« j'ai un border gris bleu et rouge il devrait juste etre noir de base »),
   * retirer le liseré, reposer un eclat ou un halo fixe sous la vague (« ca fait reflet qui balaye un
   * reflet »), ou animer le calque (il serait repeint a chaque image).
   */
  it('pose au repos un anneau noir et son liseré, sans reflet fixe', () => {
    const regle = regleDe(':is(.cadre-anneau, .look-decode-block, .bloc-3d)::before')
    const { valeur, couches } = couchesDuFond(regle)
    expect(regle).toMatch(/\bpadding: 3px;/)
    expect(couches).toEqual(['var(--chrome-noir)'])
    // Le liseré : 1 px sur le bord exterieur, une ombre interieure que le masque garde dans l'anneau.
    expect(regle).toMatch(/\bbox-shadow: inset 0 0 0 1px var\(--chrome-lisere\);/)
    for (const feuille of [THEME, MODES]) expect(feuille).toMatch(/--chrome-lisere:\s*rgba\(/)
    expect(valeur).not.toMatch(/--chrome-eclat|--prisme-/)
    expect(regle).not.toMatch(/animation/)
    // Plus de halo pose sur le cadre lui-meme : il passe avec la vague.
    expect(css).not.toMatch(/(cadre-anneau|look-decode-block)\)?::after\s*\{/)
    expect(css).not.toContain('--chrome-x')
  })

  /**
   * LE HALO SUIT LA VAGUE : la lumiere du point blanc deborde du bord, dehors sur le fil et dedans
   * sur le verre, la ou le coeur blanc passe (« l'aura lumineuse autour du bouton suit la vague
   * reflet »), en sombre comme en clair. Mesure au pixel sur la video du bouton : derriere un blanc,
   * le halo ajoute +48, +51 et +51 aux trois canaux — une lumiere BLANCHE, pas violette. Il ne
   * deborde qu'en hauteur : un calque qui depasse sur les cotes elargit la zone defilable du fil
   * (barre horizontale possible). ENTREE QUI DOIT FAIRE ECHOUER : un `inset` qui deborde a gauche ou
   * a droite, une lueur non clippee sur les cotes, une couleur en dur, un halo eteint dans un des
   * deux modes, ou un halo teinte (le violet d'avant : 156, 108, 255).
   */
  it('fait deborder un halo blanc avec la vague, sans elargir le fil', () => {
    const lueur = regleDe('.cadre-vague__lueur')
    expect(lueur).toMatch(/\binset: -\d+px 0;/)
    expect(lueur).toMatch(/\boverflow-x: clip;/)
    const { valeur } = couchesDuFond(regleDe('.cadre-vague__lueur::before'))
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(valeur).toContain('var(--chrome-halo)')
    // Neutre : les trois canaux a moins de 40 l'un de l'autre ; jamais transparent.
    for (const feuille of [THEME, MODES]) {
      const m = /--chrome-halo:\s*rgba\((\d+), (\d+), (\d+), ([\d.]+)\);/.exec(feuille)
      expect(m, 'halo').not.toBeNull()
      const [r, v, b, alpha] = m!.slice(1).map(Number)
      expect(Math.max(r!, v!, b!) - Math.min(r!, v!, b!)).toBeLessThanOrEqual(40)
      expect(alpha!).toBeGreaterThan(0)
    }
  })

  /**
   * Teinte (degres) et luminance relative (0-1, celle que l'oeil percoit) d'un jeton `#rrggbb` d'une
   * feuille de theme.
   */
  function teinteDe(feuille: string, jeton: string): { h: number; l: number } {
    const m = new RegExp(`${jeton}:\\s*#([0-9a-f]{6});`, 'i').exec(feuille)
    expect(m, jeton).not.toBeNull()
    const [r, v, b] = [0, 2, 4].map((i) => Number.parseInt(m![1]!.slice(i, i + 2), 16) / 255) as [
      number,
      number,
      number
    ]
    const max = Math.max(r, v, b)
    const d = max - Math.min(r, v, b) || 1e-6
    const h =
      max === r
        ? (((v - b) / d) % 6) * 60
        : max === v
          ? ((b - r) / d + 2) * 60
          : ((r - v) / d + 4) * 60
    const lineaire = (c: number): number =>
      c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
    return {
      h: (h + 360) % 360,
      l: 0.2126 * lineaire(r) + 0.7152 * lineaire(v) + 0.0722 * lineaire(b)
    }
  }

  /**
   * LE SPECTRE DE LA VIDEO, releve au pixel sur ses 150 images (couleur mediane des pixels satures,
   * a distance croissante du blanc) : deux familles et rien d'autre — froide (cyan a 2-8 degres
   * d'anneau du blanc, bleu a 13, indigo a 20) et chaude (jaune a 2-8, or a 10, corail a 16, rouille
   * a 24) —, chacune plus sombre a mesure qu'elle s'eloigne du blanc. Vert et magenta n'y font pas
   * 1 % des pixels. ENTREE QUI DOIT FAIRE ECHOUER : un vert ou un magenta remis dans l'eclat, une
   * frange qui s'eclaircit en s'eloignant du blanc, ou une teinte sortie de sa famille.
   */
  it('a le spectre de la video : deux familles, plus sombres loin du blanc', () => {
    expect(css).not.toMatch(/--prisme-(vert|magenta)/)
    for (const feuille of [THEME, MODES]) {
      expect(feuille).not.toMatch(/--prisme-(vert|magenta)/)
      const froid = ['cyan', 'bleu', 'indigo'].map((t) => teinteDe(feuille, `--prisme-${t}`))
      const chaud = ['jaune', 'or', 'rouge', 'rouille'].map((t) =>
        teinteDe(feuille, `--prisme-${t}`)
      )
      for (const { h } of froid) expect(h).toBeGreaterThanOrEqual(185)
      for (const { h } of froid) expect(h).toBeLessThanOrEqual(240)
      for (const { h } of chaud) expect(h < 65 || h > 350, `teinte chaude ${h}`).toBe(true)
      for (const famille of [froid, chaud])
        for (let i = 1; i < famille.length; i++)
          expect(famille[i]!.l).toBeLessThanOrEqual(famille[i - 1]!.l)
    }
  })

  it('donne aux tranches de la pile d images le meme metal que le bord', () => {
    const pile = readFileSync(join(ICI, 'ArtifactPreview.css'), 'utf8')
    const debut = pile.indexOf('.artifact-pile__tranches > span {')
    expect(debut).toBeGreaterThan(-1)
    const regle = pile.slice(debut, pile.indexOf('\n}', debut))
    for (const jeton of ['eclat', 'clair', 'moyen', 'sombre'])
      expect(regle).toContain(`var(--chrome-${jeton})`)
    expect(regle).not.toMatch(/--capsule-|--prisme-/)
  })

  /** Les etapes d'un `@keyframes` : pourcentage -> declarations. */
  function etapesDe(nom: string): Map<number, string> {
    const debut = css.indexOf(`@keyframes ${nom} {`)
    expect(debut, nom).toBeGreaterThan(-1)
    const corps = css.slice(debut, css.indexOf('\n}', debut))
    const etapes = new Map<number, string>()
    for (const m of corps.matchAll(/((?:\d+(?:\.\d+)?%,?\s*)+)\{([^}]*)\}/g)) {
      for (const p of m[1]!.split(',')) etapes.set(Number.parseFloat(p), m[2]!.trim())
    }
    return etapes
  }
  // Une etape de la vague, telle que scripts/vague-du-cadre.mjs l'ecrit : la position passe TOUJOURS
  // par `100cqw + --vague-avance - --vague-course * p` (c'est ce qui garde une seule diagonale pour
  // le groupe), decalee de quelques pixels pour une frange, puis la pente et, pour le coeur et le
  // second reflet, la largeur ; l'intensite est une opacite ; seule la derniere etape d'un passage
  // saute au depart du suivant. Ce qu'une animation n'ecrit pas vaut `NaN`.
  const ETAT =
    /^(?:transform: translateX\(calc\(100cqw \+ var\(--vague-avance\) - var\(--vague-course\) \* (-?[\d.]+)(?: ([+-]) ([\d.]+)px)?\)\) skewX\((-?[\d.]+)deg\)(?: scaleX\(([\d.]+)\))?; ?)?(?:opacity: ([\d.]+);)?( animation-timing-function: step-end;)?$/
  type Etat = {
    pourcent: number
    p: number
    decalage: number
    pente: number
    largeur: number
    opacite: number
    saut: boolean
  }
  /** Les etats d'une animation de la vague, dans l'ordre du cycle. */
  function etatsDe(nom: string): Etat[] {
    return [...etapesDe(nom)]
      .sort((a, b) => a[0] - b[0])
      .map(([pourcent, declarations]) => {
        // Prettier coupe les longues etapes : on recolle avant de lire.
        const ligne = declarations.replace(/\s+/g, ' ').replace(/\( /g, '(').replace(/ \)/g, ')')
        const m = ETAT.exec(ligne)
        expect(m, `${nom} ${pourcent}% : ${declarations}`).not.toBeNull()
        const signe = m![2] === '-' ? -1 : 1
        return {
          pourcent,
          p: Number(m![1] ?? Number.NaN),
          decalage: m![1] === undefined ? Number.NaN : signe * Number(m![3] ?? 0),
          pente: Number(m![4] ?? Number.NaN),
          largeur: Number(m![5] ?? Number.NaN),
          opacite: Number(m![6] ?? Number.NaN),
          saut: Boolean(m![7])
        }
      })
  }
  /** Les passages d'un reflet : chacun finit sur l'etape qui saute au suivant. */
  function passagesDe(nom: string): Etat[][] {
    const passages: Etat[][] = [[]]
    for (const etat of etatsDe(nom)) {
      passages[passages.length - 1]!.push(etat)
      if (etat.saut) passages.push([])
    }
    return passages.filter((p) => p.length > 0)
  }
  const CYCLE_S = 12
  const COURSE_PX = 1144

  /** Les arrets `var(--prisme-x) Npx` (et le blanc) d'une couche, dans l'ordre, de gauche a droite. */
  function arretsDe(couche: string): Array<{ teinte: string; px: number }> {
    return [...couche.matchAll(/var\(--(?:prisme|chrome)-(\w+)\) (\d+)px/g)].map((m) => ({
      teinte: m[1]!,
      px: Number(m[2])
    }))
  }
  const FROID = ['cyan', 'bleu', 'indigo']
  const CHAUD = ['jaune', 'or', 'rouge', 'rouille']
  /** La famille d'une couche, lue de part et d'autre de son blanc. */
  const familles = (couche: string): { gauche: string[]; droite: string[] } => {
    const arrets = arretsDe(couche)
    const blanc = arrets.findIndex((a) => a.teinte === 'eclat')
    const teintes = (liste: typeof arrets): string[] => [
      ...new Set(liste.filter((a) => a.teinte !== 'eclat').map((a) => a.teinte))
    ]
    return { gauche: teintes(arrets.slice(0, blanc)), droite: teintes(arrets.slice(blanc + 1)) }
  }

  /**
   * LA VAGUE (« une vague qui traverse l'input », puis « la vague doit etre diagonale ») : des bandes
   * penchees glissent sur l'anneau, de droite a gauche, et portent seules le reflet. Le dessin de
   * l'eclat est celui de la video du bouton de verre, releve au pixel : un coeur blanc de 40 px,
   * frange de FROID d'un cote (cyan, bleu, indigo) et de CHAUD de l'autre (jaune, or, corail,
   * rouille), sur 66 px chacune. L'ordre suit le TOUR de l'anneau (sens horaire : froid, blanc,
   * chaud, en haut comme en bas de la video) : sur le bord haut, froid a gauche ; sur le bord bas,
   * froid a droite. ENTREE QUI DOIT FAIRE ECHOUER : une bande droite (sans pente), animee autrement
   * que par `transform` et `opacity` (un degrade ou une propriete enregistree serait repeint a chaque
   * image, le cout de l'ancienne lave), une autre animation revenue sur l'anneau, une couleur en dur
   * dans la bande, un spectre symetrique (le meme de chaque cote du blanc), un bord bas range comme le
   * bord haut, des franges de longueurs differentes, ou un nom d'animation ecrase par le raccourci
   * `animation` de la regle commune.
   */
  it('fait glisser une vague diagonale par transform et opacite seuls, et n anime rien d autre', () => {
    const noms = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!)
    const vagues = noms.filter((n) => n.startsWith('cadre-vague'))
    expect(vagues.sort()).toEqual([...ANIMATIONS_DE_VAGUE].sort())
    for (const nom of vagues)
      for (const etat of etatsDe(nom)) {
        if (nom === 'cadre-vague-intensite') continue
        expect(etat.pente, nom).toBeGreaterThanOrEqual(35)
        expect(etat.pente, nom).toBeLessThanOrEqual(55)
      }
    // Seuls la vague et l'atterrissage du verdict animent quelque chose dans ce fichier.
    for (const n of noms) expect([...vagues, ...ANIMATIONS_D_ATTERRISSAGE], n).toContain(n)
    expect(css).not.toMatch(/@property/)
    const selecteurCommun = [
      '.cadre-vague__lueur::before',
      '.cadre-vague__onde::before',
      '.cadre-vague__onde::after',
      '.cadre-vague__coeur::before',
      '.cadre-vague__trait::before'
    ].join(',\n')
    const bandes = regleDe(selecteurCommun)
    expect(bandes).toMatch(/animation: cadre-vague 12s linear infinite;/)
    expect(bandes).toMatch(/\bwidth: 220px;/)
    expect(bandes).toMatch(/\btransform-origin: 110px 0;/)
    expect(bandes).toContain(
      'transform: translateX(calc(100cqw + var(--vague-avance))) skewX(45deg);'
    )
    // Chaque piece prend son nom APRES la regle commune.
    for (const [piece, nom] of [
      ['.cadre-vague__onde::before', 'cadre-vague-gauche'],
      ['.cadre-vague__onde::after', 'cadre-vague-droite'],
      ['.cadre-vague__trait::before', 'cadre-vague-second']
    ])
      expect(css.indexOf(`${piece} {\n  animation-name: ${nom};`), piece).toBeGreaterThan(
        css.indexOf(`${selecteurCommun} {`)
      )
    // L'intensite estompe le calque de l'eclat et celui du halo, d'un bloc.
    expect(regleDe('.cadre-vague__lueur,\n.cadre-vague__onde')).toMatch(
      /animation: cadre-vague-intensite 12s linear infinite;/
    )
    const vague = regleDe('.cadre-vague')
    // `cqw`/`cqh` lisent la taille de ce calque.
    expect(vague).toMatch(/\bcontainer-type: size;/)

    // Le coeur : 40 px de blanc plein, centre sur la bande.
    const coeur = couchesDuFond(regleDe('.cadre-vague__coeur::before'))
    expect(coeur.couches).toHaveLength(1)
    expect(coeur.valeur).toContain('var(--chrome-eclat) 90px 130px')
    // Les franges : deux couches chacune, la moitie haute puis la moitie basse.
    const gauche = couchesDuFond(regleDe('.cadre-vague__onde::before'))
    const droite = couchesDuFond(regleDe('.cadre-vague__onde::after'))
    const trait = couchesDuFond(regleDe('.cadre-vague__trait::before'))
    for (const piece of [gauche, droite, trait]) {
      expect(piece.valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
      expect(piece.couches).toHaveLength(2)
      expect(piece.couches[0]).toMatch(/\btop \/ 100% 50% no-repeat$/)
      expect(piece.couches[1]).toMatch(/\bbottom \/ 100% 50% no-repeat$/)
    }
    // Bord haut : froid a gauche du blanc, chaud a droite ; bord bas : l'inverse.
    expect(familles(gauche.couches[0]!).gauche).toEqual(['indigo', 'bleu', 'cyan'])
    expect(familles(gauche.couches[1]!).gauche).toEqual(['rouille', 'rouge', 'or', 'jaune'])
    expect(familles(droite.couches[0]!).droite).toEqual(CHAUD)
    expect(familles(droite.couches[1]!).droite).toEqual(FROID)
    expect(familles(trait.couches[0]!)).toEqual({ gauche: [...FROID].reverse(), droite: CHAUD })
    expect(familles(trait.couches[1]!)).toEqual({ gauche: [...CHAUD].reverse(), droite: FROID })
    // Une frange est le miroir de l'autre autour du centre (110 px) : memes longueurs.
    const teintes = (couche: string): Array<{ teinte: string; px: number }> =>
      arretsDe(couche).filter((a) => a.teinte !== 'eclat')
    const miroir = (couche: string): Array<{ teinte: string; px: number }> =>
      teintes(couche)
        .map((a) => ({ teinte: a.teinte, px: 220 - a.px }))
        .reverse()
    expect(miroir(droite.couches[1]!)).toEqual(teintes(gauche.couches[0]!))
    expect(miroir(droite.couches[0]!)).toEqual(teintes(gauche.couches[1]!))
    expect(miroir(trait.couches[1]!)).toEqual(teintes(trait.couches[0]!))
    // Les franges s'eteignent a 66 px du blanc (30 degres d'anneau sur la video).
    expect(gauche.couches[0]).toMatch(/^linear-gradient\(\s*90deg,\s*transparent 24px,/)
    expect(gauche.couches[0]).toContain('var(--chrome-eclat) 90px 94px')

    // Clippes : la bande en attente a droite elargirait la zone defilable du fil.
    const calques = regleDe('.cadre-vague__onde,\n.cadre-vague__trait')
    expect(calques).toMatch(/\boverflow: clip;/)
    // L'arrondi par variable : `inherit` lit l'arrondi nul de l'emplacement cache d'un `<details>`,
    // et la vague debordait de l'anneau en equerre. Chaque bloc encadre declare le sien.
    expect(vague).toMatch(/\bborder-radius: var\(--cadre-rayon\);/)
    expect(calques).toMatch(/\bborder-radius: var\(--cadre-rayon\);/)
    for (const [feuille, rayon] of [
      ['anneau-activite.css', '16px'],
      ['LookDecodeBlock.css', '10px'],
      ['Bloc3D.css', '10px']
    ] as const) {
      const texte = readFileSync(join(ICI, feuille), 'utf8')
      expect(texte, feuille).toContain(`--cadre-rayon: ${rayon};`)
      expect(texte, feuille).toContain('border-radius: var(--cadre-rayon);')
    }
  })

  /**
   * « j'aimerais que l'effet soit moins lineaire, presque chaotique, vraiment comme la video de
   * pinterest » (2026-11-13). Mesure sur la video : plusieurs trainees qui oscillent autour de leur
   * place (jusqu'a revenir en arriere), un blanc qui enfle en eclat puis retombe, une intensite qui
   * varie. Releve au pixel : le blanc couvre 17 degres d'anneau en temps normal et 150 a 200 au plus
   * fort, mais ses franges gardent 21 a 34 degres — seul le BLANC enfle, ses franges s'ecartent sans
   * s'elargir. ENTREE QUI DOIT FAIRE ECHOUER : une vitesse constante (meme vitesse d'une etape a
   * l'autre), aucun retour en arriere, une largeur ou une intensite fixes, trois passages identiques,
   * un second reflet qui ne croise jamais le premier, une lumiere qui reste sur le bloc entre deux
   * passages (le bord est « noir de base »), un eclat qui n'enfle jamais comme celui de la video, des
   * franges etirees avec le blanc, ou des franges qui ne suivent pas le bord du coeur.
   */
  it('n est pas lineaire : la lumiere hesite, revient, enfle et vacille, comme la video', () => {
    const passages = passagesDe('cadre-vague')
    expect(passages).toHaveLength(3)
    const intensites = passagesDe('cadre-vague-intensite')
    const franges = [passagesDe('cadre-vague-gauche'), passagesDe('cadre-vague-droite')]
    // Le coeur est au repos a 40 px : chaque frange s'ecarte de la moitie de ce qu'il gagne.
    franges.forEach((frange, cote) => {
      const sens = cote === 0 ? -1 : 1
      expect(frange).toHaveLength(3)
      frange.forEach((passage, i) =>
        passage.forEach((e, k) => {
          const c = passages[i]![k]!
          expect(e.pourcent).toBe(c.pourcent)
          expect(e.p).toBe(c.p)
          expect(e.pente).toBe(c.pente)
          expect(e.largeur, 'une frange ne s etire pas').toBeNaN()
          expect(Math.abs(e.decalage - sens * 20 * (c.largeur - 1))).toBeLessThanOrEqual(0.25)
        })
      )
    })
    // Au plus fort, le coeur atteint la moitie de l'anneau d'un bloc de 350 x 52 (180 px en haut et
    // en bas sur 777 px de tour) au moins une fois par cycle.
    expect(Math.max(...passages.flat().map((e) => e.largeur))).toBeGreaterThanOrEqual(4)
    let retours = 0
    passages.forEach((passage, i) => {
      // L'intensite suit les memes etapes ; elle seule porte une opacite.
      expect(intensites[i]!.map((e) => e.pourcent)).toEqual(passage.map((e) => e.pourcent))
      for (const e of passage) expect(e.opacite).toBeNaN()
      // Un passage toutes les 4 s : 0, 4 et 8 s dans le cycle de 12 s.
      const depart = (passage[0]!.pourcent / 100) * CYCLE_S
      expect(Math.abs(depart - 4 * Math.round(depart / 4))).toBeLessThan(0.01)
      // Hors du bloc au depart et a la fin : entre deux passages, le bord reste noir.
      expect(passage[0]!.p).toBeLessThanOrEqual(0)
      expect(passage.at(-1)!.p).toBeGreaterThanOrEqual(1)
      expect(passage.at(-1)!.saut).toBe(true)
      const vitesses = passage.slice(1).map((e, k) => {
        const dt = ((e.pourcent - passage[k]!.pourcent) / 100) * CYCLE_S
        return ((e.p - passage[k]!.p) * COURSE_PX) / dt
      })
      const lente = Math.min(...vitesses)
      const rapide = Math.max(...vitesses)
      if (lente < 0) retours++
      // Hesite puis s'elance : au moins trois fois plus vite au plus rapide qu'au plus lent.
      expect(rapide).toBeGreaterThan(3 * Math.max(lente, 1))
      // Le coeur enfle (au moins du double) puis retombe a sa taille de repos aux bords du bloc.
      const largeurs = passage.map((e) => e.largeur)
      expect(Math.max(...largeurs)).toBeGreaterThanOrEqual(2)
      expect(passage[0]!.largeur).toBeLessThanOrEqual(1.05)
      expect(passage.at(-1)!.largeur).toBeLessThanOrEqual(1.05)
      // L'intensite vacille, sans eteindre l'eclat : sur la video, le blanc reste blanc (la lumiere
      // varie par sa taille) ; une opacite a 0,35 ternissait l'or en olive.
      const opacites = intensites[i]!.map((e) => e.opacite)
      expect(Math.max(...opacites) - Math.min(...opacites)).toBeGreaterThanOrEqual(0.2)
      expect(Math.min(...opacites)).toBeGreaterThanOrEqual(0.6)
    })
    // La lumiere repart en arriere au moins une fois par cycle.
    expect(retours).toBeGreaterThanOrEqual(1)
    // Deux passages ne se ressemblent pas.
    for (let i = 0; i < passages.length; i++)
      for (let j = i + 1; j < passages.length; j++) {
        const ecart = Math.max(...passages[i]!.map((e, k) => Math.abs(e.p - passages[j]![k]!.p)))
        expect(ecart, `passages ${i + 1} et ${j + 1}`).toBeGreaterThanOrEqual(0.03)
      }
    // Le second reflet, plus fin, croise le premier au moins une fois.
    const seconds = passagesDe('cadre-vague-second')
    expect(seconds).toHaveLength(3)
    const croisements = seconds.filter((second, i) =>
      second.some((e, k) => {
        if (k === 0) return false
        const avantK = Math.sign(second[k - 1]!.p - passages[i]![k - 1]!.p)
        return avantK !== 0 && Math.sign(e.p - passages[i]![k]!.p) === -avantK
      })
    )
    expect(croisements.length).toBeGreaterThanOrEqual(1)
    const plusLarge = (liste: Etat[][]): number => Math.max(...liste.flat().map((e) => e.largeur))
    expect(plusLarge(seconds)).toBeLessThan(plusLarge(passages))
  })

  /**
   * « quand ya un groupement de 3 comme ca ca doit faire une vague qui traverse d'abord action puis
   * raisonnement », puis « la vague doit etre diagonale » : une SEULE diagonale pour le groupe. Tous
   * les blocs suivent les memes etapes (le meme `p` au meme instant) ; chacun part d'aussi loin a
   * droite que la diagonale a de chemin a faire avant son bord droit (`--vague-avance`) : Actions
   * d'abord, puis Raisonnement, et Etapes, dessous, un peu apres. On simule la rangee cote a cote
   * (fil de 720 px) et sur deux lignes (fil de 400 px), et la ligne doit etre continue. ENTREE QUI
   * DOIT FAIRE ECHOUER : Raisonnement traverse avant Actions, une course qui depend de la largeur
   * (chaque bloc aurait sa vitesse, la bande sauterait), Etapes traverse en meme temps que la rangee
   * (dents de scie), une rangee sur deux lignes traitee comme cote a cote, ou un passage hors de
   * l'horloge commune.
   */
  it('traverse Actions puis Raisonnement, puis Etapes, en une seule diagonale', () => {
    expect([...ANIMATIONS_DE_VAGUE]).toEqual([
      'cadre-vague',
      'cadre-vague-gauche',
      'cadre-vague-droite',
      'cadre-vague-intensite',
      'cadre-vague-second'
    ])
    const vague = regleDe('.cadre-vague')
    expect(vague).toMatch(/--vague-avance: 0px;/)
    // La course ne lit la largeur du bloc qu'au-dela de 870 px (scene 3D sur un fil large).
    expect(vague).toContain(
      '--vague-course: calc(max(1100px, 100cqw + var(--vague-avance) + 230px) + 100cqh);'
    )
    expect(regleDe('.tour-blocs-rang')).toMatch(/\bcontainer: rang-du-tour \/ inline-size;/)

    const plat = css.replace(/\s+/g, ' ')
    const echappe = (texte: string): string => texte.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const avanceDans = (dans: string, bloc: string): string | undefined =>
      dans.match(
        new RegExp(
          // Le selecteur ENTIER : debut de feuille, de bloc, ou apres une regle ou un commentaire.
          `(?:^|[{}] |\\*/ )${echappe(bloc)} > summary > \\.cadre-vague \\{ --vague-avance: ([^;]+); \\}`
        )
      )?.[1]
    /** La valeur en pixels d'une avance, pour un bloc de `largeur` px. */
    const pixels = (expression: string | undefined, largeur: number): number => {
      if (expression === undefined) return 0
      let m = /^(\d+)px$/.exec(expression)
      if (m) return Number(m[1])
      m = /^calc\(100cqw \+ (\d+)px\)$/.exec(expression)
      if (m) return largeur + Number(m[1])
      m = /^clamp\((\d+)px, \((\d+)px - 100cqw\) \* (\d+), (\d+)px\)$/.exec(expression)
      if (m) {
        const [, bas, seuil, facteur, haut] = m.map(Number)
        return Math.min(haut!, Math.max(bas!, (seuil! - largeur) * facteur!))
      }
      throw new Error(`avance non simulee : ${expression}`)
    }
    const RAISONNEMENT = '.tour-blocs-rang > .cadre-anneau:first-child:not(:only-child)'
    const ACTIONS = '.tour-blocs-rang > .cadre-anneau:nth-child(2)'
    const ETAPES = '.tour-blocs-rang + .cadre-anneau'
    const etroit = plat.slice(plat.indexOf('@container rang-du-tour (width < 488px) {'))
    const regleEtroite = etroit.slice(0, etroit.indexOf('} }') + 3)
    expect(regleEtroite.length).toBeGreaterThan(50)
    const avance = (bloc: string, largeurDuGroupe: number): string | undefined =>
      (largeurDuGroupe < 488 ? avanceDans(regleEtroite, bloc) : undefined) ??
      avanceDans(plat.replace(regleEtroite, ''), bloc)

    // La diagonale est continue si chaque bloc (x, y, largeur dans le groupe) part de
    // `largeur + avance = groupe - x + y` : meme instant, meme vitesse, pente de 45 degres.
    const ENTETE = 44
    const ECART = 6
    const verifie = (
      groupe: number,
      blocs: Array<[string, { x: number; y: number; largeur: number }]>
    ): void => {
      for (const [bloc, place] of blocs)
        expect(
          place.largeur + pixels(avance(bloc, groupe), place.largeur),
          `${groupe} ${bloc}`
        ).toBe(groupe - place.x + place.y)
    }
    // Cote a cote : deux moities de 356 px a 8 px d'ecart, Etapes dessous.
    verifie(720, [
      [ACTIONS, { x: 364, y: 0, largeur: 356 }],
      [RAISONNEMENT, { x: 0, y: 0, largeur: 356 }],
      [ETAPES, { x: 0, y: ENTETE + ECART, largeur: 720 }]
    ])
    // Sur deux lignes : Raisonnement, Actions, Etapes, l'un sous l'autre.
    verifie(400, [
      [RAISONNEMENT, { x: 0, y: 0, largeur: 400 }],
      [ACTIONS, { x: 0, y: ENTETE + ECART, largeur: 400 }],
      [ETAPES, { x: 0, y: 2 * (ENTETE + ECART), largeur: 400 }]
    ])
    // Un bloc deplie prend toute la ligne : la rangee passe aussi sur deux lignes.
    const deplie = '.tour-blocs-rang:has(> .cadre-anneau[open])'
    expect(avanceDans(plat, `${deplie} > .cadre-anneau:first-child:not(:only-child)`)).toBe('0px')
    expect(avanceDans(plat, `${deplie} > .cadre-anneau:nth-child(2)`)).toBe('50px')
    expect(avanceDans(plat, `${deplie} + .cadre-anneau`)).toBe('100px')
  })

  /**
   * « les animations sur les blocs dans le chat doivent etre en fonction de la ou je regarde, pas
   * juste les dernieres » : la vague passe sur TOUS les tours, et animations-hors-champ.ts met en
   * pause ce qui sort de l'ecran. Ce module observe l'element qui porte l'animation : ce sont donc
   * les pseudo-elements de calques FIXES poses sur le cadre qui bougent, jamais les calques ; un
   * calque ne fait que s'estomper sur place (l'intensite, une opacite). ENTREE QUI DOIT FAIRE
   * ECHOUER : figer la vague des tours anciens, ou deplacer un calque (rogne et pousse hors du cadre
   * entre deux passages, il serait juge hors champ et ne repartirait plus).
   */
  it('anime la vague sur tous les tours, depuis des calques qui restent sur le cadre', () => {
    expect(css).not.toMatch(/:has\(~ \.msg\.assistant\.msg--rail\)[^{]*cadre-vague/)
    expect(css).not.toMatch(/cadre-vague[^{]*\{[^}]*animation: none/)
    for (const calque of [
      '.cadre-vague__onde,\n.cadre-vague__trait',
      '.cadre-vague__lueur',
      '.cadre-vague__coeur'
    ]) {
      const regle = regleDe(calque)
      expect(regle, calque).toMatch(/\binset: (0|-\d+px 0);/)
      expect(regle, calque).not.toMatch(/transform|animation/)
    }
    // L'intensite n'anime que l'opacite des calques : elle ne les deplace pas.
    for (const e of etatsDe('cadre-vague-intensite')) expect(e.p).toBeNaN()
    const animees = [
      ...css.matchAll(/([^{}]+)\{[^{}]*animation(?:-name)?:[^;]*cadre-vague[^{}]*\}/g)
    ]
    expect(animees.length).toBeGreaterThan(0)
    for (const m of animees) {
      const selecteurs = m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(',')
      const intensite = /animation: cadre-vague-intensite /.test(m[0])
      for (const selecteur of selecteurs)
        expect(selecteur.trim()).toMatch(
          intensite
            ? /^\.cadre-vague__(onde|lueur)$/
            : /^\.cadre-vague__(onde|lueur|coeur|trait)::(before|after)$/
        )
    }
  })

  /**
   * L'ANCIENNE CARTE etait repeinte par sept feuilles de theme (fond, liseré, degrade par statut) :
   * chaque correction ecrite d'un cote etait ecrasee de l'autre. Le cadre n'a qu'une source.
   * Exception nommee : theme-holographique-clair.css, en cours de reprise par une autre
   * conversation, garde des regles `.activity-group` MORTES (aucun element ne porte plus cette
   * classe) — elles ne visent pas le cadre.
   * Les TRANCHES de la pile d'images prolongent ce bord sous la carte de devant : un theme qui les
   * repeint (la lave rose et bleu de Nebuleuse) les detache du chrome.
   */
  // Ce qui est interdit : une regle dont la CIBLE est le cadre (son fond, son bord). Une copie de
  // theme qui vise un element DANS le cadre (la pastille de duree, recolorée comme celles des
  // capsules) est legitime : elle suit le theme sans toucher au cadre.
  it('aucune feuille de theme ne repeint le cadre ni les tranches de la pile', () => {
    const assets = join(ICI, '..', 'assets')
    const cibleLeCadre = /\.(activity-anneau|cadre-anneau)[\w\-.[\]='"():]*\s*[,{]/
    for (const fichier of readdirSync(assets).filter((f) => f.endsWith('.css'))) {
      const feuille = readFileSync(join(assets, fichier), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
      expect(feuille, fichier).not.toMatch(cibleLeCadre)
      expect(feuille, fichier).not.toMatch(/\.artifact-pile__tranche/)
    }
  })

  // Le metal et le spectre ont leur valeur claire, choisie a l'oeil, dans theme-modes.css. La couche
  // generee du theme clair prenait le noir du metal pour un fond d'encre et le passait en nacre :
  // l'anneau disparaissait sur le blanc ; celle de Nebuleuse virait le cyan de la frange froide au
  // violet. ENTREE QUI DOIT FAIRE ECHOUER : retirer l'exception `JETONS_ANNEAU` de
  // scripts/theme-nebuleuse-verre.mjs puis regenerer.
  it('les couches generees de Nebuleuse ne transposent pas les couleurs de l anneau', () => {
    for (const fichier of [
      'theme-holographique-clair.genere.css',
      'theme-nebuleuse-verre.genere.css'
    ]) {
      const couche = readFileSync(join(ICI, '..', 'assets', fichier), 'utf8')
      expect(couche, fichier).not.toMatch(/--(chrome|prisme)-[\w-]+\s*:/)
    }
  })
})

describe('la vague du cadre — un passage commun a tous les blocs', () => {
  /** Une animation factice, comme celles que rend `getAnimations()`. */
  function animation(
    nom: string,
    startTime: number | null
  ): { animationName: string; startTime: number | null } {
    return { animationName: nom, startTime }
  }

  // ENTREE QUI DOIT FAIRE ECHOUER : caler une autre animation (l'atterrissage du verdict partirait au
  // milieu de sa course), laisser un passage de vague sur sa propre horloge, ou oublier l'animation
  // du `::before` (seule l'option `subtree` la rend).
  it('cale les passages de vague sur l origine du document, et eux seuls', () => {
    const vague = animation('cadre-vague', 1234)
    const atterrissage = animation('anneau-reflet', 500)
    const dejaCalee = animation('cadre-vague', 0)
    const element = {
      getAnimations: (options?: { subtree?: boolean }) =>
        options?.subtree ? [vague, atterrissage, dejaCalee] : []
    }
    expect(caleSurLHorlogeCommune(element as unknown as Element)).toBe(1)
    expect(vague.startTime).toBe(0)
    expect(atterrissage.startTime).toBe(500)
  })

  it('ne cale rien hors d un vrai navigateur', () => {
    expect(caleSurLHorlogeCommune({} as Element)).toBe(0)
  })

  it('pose la bande dans un calque cache aux lecteurs d ecran', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(VagueDuCadre)))
    const vague = host.querySelector('.cadre-vague')
    expect(vague?.getAttribute('aria-hidden')).toBe('true')
    // Le halo dessous, l'eclat et le trait dessus : par-dessus, le halo delavait les franges. Le
    // coeur blanc a son calque DANS l'eclat : il s'estompe avec ses franges, d'un bloc.
    expect([...(vague?.children ?? [])].map((e) => e.className)).toEqual([
      'cadre-vague__lueur',
      'cadre-vague__onde',
      'cadre-vague__trait'
    ])
    expect(vague?.querySelector(':scope > .cadre-vague__onde > .cadre-vague__coeur')).not.toBeNull()
    expect(vague?.textContent).toBe('')
    act(() => root.unmount())
    host.remove()
  })

  // Chaque bloc encadre du fil porte la vague. Un `<details>` replie n'affiche que son `<summary>` :
  // la vague y est le premier enfant. ENTREE QUI DOIT FAIRE ECHOUER : un nouveau bloc encadre sans
  // `<VagueDuCadre />`, ou une vague posee hors du `summary` d'un bloc repliable.
  it('est posee dans chaque bloc encadre du fil', () => {
    const racine = /className=\{?[`'"][^`'"]*\b(cadre-anneau|look-decode-block|bloc-3d)\b(?![-_])/g
    const fichiers = readdirSync(ICI).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'anneau-activite.tsx'
    )
    const porteurs: Record<string, number> = {}
    for (const f of fichiers) {
      const source = readFileSync(join(ICI, f), 'utf8')
      const cadres = [...source.matchAll(racine)].length
      if (cadres === 0) continue
      porteurs[f] = cadres
      expect(source.split('<VagueDuCadre />').length - 1, f).toBe(cadres)
    }
    expect(Object.keys(porteurs).sort()).toEqual([
      'ArtifactPile.tsx',
      'ArtifactPreview.tsx',
      'Bloc3D.tsx',
      'ChatView.parts.tsx',
      'LookDecodeBlock.tsx',
      'ThinkingBlock.tsx'
    ])
  })

  it('est rendue dans le summary d un bloc replie (Raisonnement)', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ThinkingBlock, { text: 'je pese', done: false })))
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(bloc.open).toBe(false)
    expect(bloc.querySelector(':scope > summary > .cadre-vague:first-child')).not.toBeNull()
    act(() => root.unmount())
    host.remove()
  })
})
