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
   * L'AURA SUIT LA VAGUE : la lumiere du point blanc deborde du bord, dehors sur le fil et dedans sur
   * le verre, la ou la bande passe, en violet (« de base ya une aura violette »), en sombre comme en
   * clair. Elle ne deborde qu'en hauteur : un calque qui depasse sur les cotes elargit la zone
   * defilable du fil (barre horizontale possible). ENTREE QUI DOIT FAIRE ECHOUER : un `inset` qui
   * deborde a gauche ou a droite, une lueur non clippee sur les cotes, une couleur en dur, ou une
   * aura eteinte dans un des deux modes.
   */
  it('fait deborder une aura violette avec la vague, sans elargir le fil', () => {
    const lueur = regleDe('.cadre-vague__lueur')
    expect(lueur).toMatch(/\binset: -\d+px 0;/)
    expect(lueur).toMatch(/\boverflow-x: clip;/)
    const { valeur } = couchesDuFond(regleDe('.cadre-vague__lueur::before'))
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(valeur).toContain('var(--chrome-halo)')
    // Violet : le bleu domine, puis le rouge, le vert en retrait ; jamais transparent.
    for (const feuille of [THEME, MODES]) {
      const m = /--chrome-halo:\s*rgba\((\d+), (\d+), (\d+), ([\d.]+)\);/.exec(feuille)
      expect(m, 'aura violette').not.toBeNull()
      const [r, v, b, alpha] = m!.slice(1).map(Number)
      expect(b!).toBeGreaterThan(r!)
      expect(r!).toBeGreaterThan(v!)
      expect(alpha!).toBeGreaterThan(0)
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
  // La bande attend juste a droite du bloc (plus loin s'il a de l'avance dans son groupe), et
  // recule de la course : assez pour que son pied, decale de la hauteur du bloc par la pente a 45
  // degres, ait passe le bord gauche.
  const DEPART = 'translateX(calc(100cqw + var(--vague-avance))) skewX(45deg)'
  const ARRIVEE =
    'translateX(calc(100cqw + var(--vague-avance) - var(--vague-course))) skewX(45deg)'

  /**
   * LA VAGUE (« une vague qui traverse l'input », puis « la vague doit etre diagonale ») : une bande
   * penchee glisse sur l'anneau, de droite a gauche, et porte seule le reflet, avec le dessin de
   * l'eclat que l'utilisateur a trouve « super reussi ». ENTREE QUI DOIT FAIRE ECHOUER : une bande
   * droite (sans pente), animee autrement que par `transform` (un degrade ou une propriete
   * enregistree serait repeint a chaque image, le cout de l'ancienne lave), une autre animation
   * revenue sur l'anneau, une couleur en dur dans la bande, ou une bande qui perd le blanc ou la
   * symetrie de son spectre.
   */
  it('fait glisser une vague diagonale par transform seul, et n anime rien d autre', () => {
    const noms = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!)
    const vagues = noms.filter((n) => n.startsWith('cadre-vague'))
    expect(vagues.sort()).toEqual([...ANIMATIONS_DE_VAGUE].sort())
    for (const nom of vagues)
      for (const declarations of etapesDe(nom).values())
        expect(declarations, nom).toMatch(/^transform: translateX\(.*\) skewX\(45deg\);$/)
    // Seuls la vague et l'atterrissage du verdict animent quelque chose dans ce fichier.
    for (const n of noms) expect([...vagues, ...ANIMATIONS_D_ATTERRISSAGE], n).toContain(n)
    expect(css).not.toMatch(/@property/)
    const bandes = regleDe('.cadre-vague__lueur::before,\n.cadre-vague__onde::before')
    expect(bandes).toMatch(/animation: cadre-vague 4s linear infinite;/)
    expect(bandes).toMatch(/\bwidth: 220px;/)
    expect(bandes).toContain(`transform: ${DEPART};`)
    const vague = regleDe('.cadre-vague')
    // `cqw`/`cqh` lisent la taille de ce calque.
    expect(vague).toMatch(/\bcontainer-type: size;/)

    // Le dessin de l'eclat : un blanc plein au centre, puis le spectre en miroir de chaque cote.
    const { valeur, couches } = couchesDuFond(regleDe('.cadre-vague__onde::before'))
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(couches).toHaveLength(2)
    expect(couches[0]).toContain('var(--chrome-eclat) 95px 125px')
    const arrets = [...couches[1]!.matchAll(/var\(--prisme-(\w+)\) (\d+)px/g)].map((m) => ({
      teinte: m[1]!,
      px: Number(m[2])
    }))
    const avant = arrets.filter((a) => a.px < 110)
    const apres = arrets.filter((a) => a.px > 110)
    expect(avant.map((a) => a.teinte).reverse()).toEqual(apres.map((a) => a.teinte))
    expect(avant.map((a) => 220 - a.px).reverse()).toEqual(apres.map((a) => a.px))
    expect(apres.map((a) => a.teinte)).toEqual(['jaune', 'or', 'rouge', 'magenta', 'bleu', 'cyan'])

    // Clippee : la bande en attente a droite elargirait la zone defilable du fil.
    expect(regleDe('.cadre-vague__onde')).toMatch(/\boverflow: clip;/)
    // L'arrondi par variable : `inherit` lit l'arrondi nul de l'emplacement cache d'un `<details>`,
    // et la vague debordait de l'anneau en equerre. Chaque bloc encadre declare le sien.
    expect(vague).toMatch(/\bborder-radius: var\(--cadre-rayon\);/)
    expect(regleDe('.cadre-vague__onde')).toMatch(/\bborder-radius: var\(--cadre-rayon\);/)
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
   * « quand ya un groupement de 3 comme ca ca doit faire une vague qui traverse d'abord action puis
   * raisonnement », puis « la vague doit etre diagonale » : une SEULE diagonale pour le groupe, a la
   * meme vitesse partout. Chaque bloc part d'aussi loin a droite que la diagonale a de chemin a faire
   * avant son bord droit (`--vague-avance`) : Actions d'abord, puis Raisonnement, et Etapes, dessous,
   * un peu apres. On simule la rangee cote a cote (fil de 720 px) et sur deux lignes (fil de 400 px),
   * et la ligne doit etre continue. ENTREE QUI DOIT FAIRE ECHOUER : Raisonnement traverse avant
   * Actions, une course qui depend de la largeur (chaque bloc aurait sa vitesse, la bande sauterait),
   * Etapes traverse en meme temps que la rangee (dents de scie), une rangee sur deux lignes traitee
   * comme cote a cote, ou un passage hors de l'horloge commune.
   */
  it('traverse Actions puis Raisonnement, puis Etapes, en une seule diagonale', () => {
    expect([...ANIMATIONS_DE_VAGUE]).toEqual(['cadre-vague'])
    const etapes = [...etapesDe('cadre-vague')].sort((a, b) => a[0] - b[0])
    expect(etapes.map(([p]) => p)).toEqual([0, 52.5, 100])
    expect(etapes[0]![1]).toBe(`transform: ${DEPART};`)
    expect(etapes[1]![1]).toBe(`transform: ${ARRIVEE};`)
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
   * les `::before` de calques FIXES poses sur le cadre qui bougent, jamais les calques eux-memes.
   * ENTREE QUI DOIT FAIRE ECHOUER : figer la vague des tours anciens, ou animer un calque (rogne et
   * pousse hors du cadre entre deux passages, il serait juge hors champ et ne repartirait plus).
   */
  it('anime la vague sur tous les tours, depuis des calques qui restent sur le cadre', () => {
    expect(css).not.toMatch(/:has\(~ \.msg\.assistant\.msg--rail\)[^{]*cadre-vague/)
    expect(css).not.toMatch(/cadre-vague[^{]*\{[^}]*animation: none/)
    for (const calque of ['.cadre-vague__onde', '.cadre-vague__lueur']) {
      const regle = regleDe(calque)
      expect(regle, calque).toMatch(/\binset: (0|-\d+px 0);/)
      expect(regle, calque).not.toMatch(/transform|animation/)
    }
    const animees = [
      ...css.matchAll(/([^{}]+)\{[^{}]*animation(?:-name)?:[^;]*cadre-vague[^{}]*\}/g)
    ]
    expect(animees.length).toBeGreaterThan(0)
    for (const m of animees)
      for (const selecteur of m[1]!.replace(/\/\*[\s\S]*?\*\//g, '').split(','))
        expect(selecteur.trim()).toMatch(/^\.cadre-vague__(onde|lueur)::before$/)
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
  // l'anneau disparaissait sur le blanc. ENTREE QUI DOIT FAIRE ECHOUER : retirer l'exception
  // `CLAIR_JETONS_ANNEAU` de scripts/theme-nebuleuse-verre.mjs puis regenerer.
  it('la couche generee du theme clair ne transpose pas les couleurs de l anneau', () => {
    const couche = readFileSync(
      join(ICI, '..', 'assets', 'theme-holographique-clair.genere.css'),
      'utf8'
    )
    expect(couche).not.toMatch(/--(chrome|prisme)-[\w-]+\s*:/)
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
    // Le halo dessous, la bande dessus : par-dessus, le halo delavait le spectre.
    expect([...(vague?.children ?? [])].map((e) => e.className)).toEqual([
      'cadre-vague__lueur',
      'cadre-vague__onde'
    ])
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
