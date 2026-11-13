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
 *  - au repos, l'anneau n'est que noir, cerne d'un liseré : le REFLET du pin (un canvas par bloc
 *    encadre, reflet-du-pin.ts) porte seul la lumiere ; plus aucune animation CSS sur le bord.
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegendeDesOutils, RefletDuCadre } from './anneau-activite'
import {
  ANIMATIONS_D_ATTERRISSAGE,
  casesDuVerdict,
  exceptionDuGroupe,
  groupesDeLegende,
  verdictDuRond
} from './anneau-activite-calcul'
import { AssistantActivityGroup } from './ChatView.parts'
import { MARGE } from './reflet-du-pin'
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
   * EN COURS, le verre s'allume ; plus d'aura fixe autour du cadre : la lueur passe avec le reflet
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
   * la lumiere, ses couleurs et sa lueur ne viennent que du reflet rejoue par dessus. ENTREE QUI DOIT FAIRE
   * ECHOUER CE TEST : retirer un bloc de la liste, ecrire une couleur en dur, remettre des bandes
   * grises ou teintees (« j'ai un border gris bleu et rouge il devrait juste etre noir de base »),
   * retirer le liseré, reposer un eclat ou un halo fixe sous le reflet (« ca fait reflet qui balaye un
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
    expect(valeur).not.toMatch(/--chrome-eclat/)
    expect(regle).not.toMatch(/animation/)
    // Plus de halo pose sur le cadre lui-meme : il passe avec le reflet.
    expect(css).not.toMatch(/(cadre-anneau|look-decode-block)\)?::after\s*\{/)
    expect(css).not.toContain('--chrome-x')
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

  // Le metal a sa valeur claire, choisie a l'oeil, dans theme-modes.css. La couche generee du theme
  // clair prenait le noir du metal pour un fond d'encre et le passait en nacre : l'anneau
  // disparaissait sur le blanc. ENTREE QUI DOIT FAIRE ECHOUER : retirer l'exception `JETONS_ANNEAU`
  // de scripts/theme-nebuleuse-verre.mjs puis regenerer.
  it('les couches generees de Nebuleuse ne transposent pas les couleurs de l anneau', () => {
    for (const fichier of [
      'theme-holographique-clair.genere.css',
      'theme-nebuleuse-verre.genere.css'
    ]) {
      const couche = readFileSync(join(ICI, '..', 'assets', fichier), 'utf8')
      expect(couche, fichier).not.toMatch(/--chrome-[\w-]+\s*:/)
    }
  })
})

describe('le reflet du cadre — la lumiere du pin, rejouee sur le bord', () => {
  const css = readFileSync(join(ICI, 'anneau-activite.css'), 'utf8')
  /** Le corps d'une regle d'une feuille, sans ses commentaires. */
  function regleDe(selecteur: string, feuille = css): string {
    const debut = feuille.indexOf(`${selecteur} {`)
    expect(debut, selecteur).toBeGreaterThan(-1)
    return feuille.slice(debut, feuille.indexOf('\n}', debut)).replace(/\/\*[\s\S]*?\*\//g, '')
  }

  // La lumiere douce DESSOUS, l'anneau net DESSUS : par-dessus, la lumiere voilerait le trait.
  it('pose deux canvas, la lumiere puis l anneau, caches aux lecteurs d ecran', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(RefletDuCadre, { actif: true })))
    const reflet = host.querySelector('.cadre-reflet')
    expect(reflet?.getAttribute('aria-hidden')).toBe('true')
    expect([...(reflet?.children ?? [])].map((e) => `${e.tagName}.${e.className}`)).toEqual([
      'CANVAS.cadre-reflet__lumiere',
      'CANVAS.cadre-reflet__anneau'
    ])
    expect(reflet?.textContent).toBe('')
    expect(regleDe('.cadre-reflet > canvas')).toMatch(/\bwidth: 100%;[\s\S]*\bheight: 100%;/)
    act(() => root.unmount())
    host.remove()
  })

  // « cette animation doit etre que sur les blocs qui ont pas fini » : un bloc fini n'a ni canvas
  // ni animation, seulement l'anneau noir de la feuille. ENTREE QUI DOIT FAIRE ECHOUER : un reflet
  // rendu sur un bloc fini.
  it('ne pose rien sur un bloc fini', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(RefletDuCadre, { actif: false })))
    expect(host.querySelector('.cadre-reflet')).toBeNull()
    expect(host.querySelector('canvas')).toBeNull()
    act(() => root.unmount())
    host.remove()
  })

  // Le canvas deborde de MARGE px de chaque cote, et la table du reflet retire exactement cette
  // marge pour retrouver le bloc. ENTREE QUI DOIT FAIRE ECHOUER : changer l'un sans l'autre (le
  // reflet glisserait hors de l'anneau).
  it('deborde du bloc de la marge que le reflet retire', () => {
    const regle = regleDe('.cadre-reflet')
    expect(regle).toMatch(new RegExp(`\\btop: -${MARGE}px;`))
    expect(regle).toMatch(new RegExp(`\\bleft: -${MARGE}px;`))
    expect(regle).toMatch(new RegExp(`\\bwidth: calc\\(100% \\+ ${2 * MARGE}px\\);`))
    expect(regle).toMatch(new RegExp(`\\bheight: calc\\(100% \\+ ${2 * MARGE}px\\);`))
    expect(regle).toMatch(/\bz-index: -1;/)
  })

  // Le canvas lit `--cadre-rayon` pour suivre l'arrondi du bloc.
  it('trouve l arrondi des blocs qui portent le reflet', () => {
    expect(regleDe('.cadre-anneau')).toMatch(/--cadre-rayon: \d+px;/)
  })

  // La vague diagonale, ses etapes calculees et sa place dans le groupe sont parties : plus rien ne
  // s'anime en CSS sur le bord. ENTREE QUI DOIT FAIRE ECHOUER : une animation remise sur l'anneau.
  it('n anime plus rien en CSS sur le bord', () => {
    expect(css).not.toMatch(/cadre-vague|--vague-/)
    // Les seules animations de la feuille : l'atterrissage du verdict sur le rond.
    const noms = [...css.matchAll(/@keyframes ([\w-]+)/g)].map((m) => m[1]!)
    expect(noms.sort()).toEqual([...ANIMATIONS_D_ATTERRISSAGE].sort())
    expect(regleDe(':is(.cadre-anneau, .look-decode-block, .bloc-3d)::before')).not.toMatch(
      /animation/
    )
  })

  // Chaque bloc encadre qui peut etre EN COURS porte le reflet, allume par CE qui le dit en cours
  // (la meme condition que sa classe `is-live`). Le decodage d'une image et la scene 3D ne sont
  // jamais en cours : pas de reflet. ENTREE QUI DOIT FAIRE ECHOUER : un nouveau bloc encadre sans
  // reflet, un reflet allume par autre chose que l'etat en cours du bloc, ou un reflet remis sur un
  // bloc qui n'est jamais en cours.
  it('est pose dans chaque bloc qui peut etre en cours, allume par son etat en cours', () => {
    const racine = /className=\{?[`'"][^`'"]*\bcadre-anneau\b(?![-_])/g
    const fichiers = readdirSync(ICI).filter(
      (f) => f.endsWith('.tsx') && !f.includes('.test.') && f !== 'anneau-activite.tsx'
    )
    const porteurs: Record<string, number> = {}
    for (const f of fichiers) {
      const source = readFileSync(join(ICI, f), 'utf8')
      const cadres = [...source.matchAll(racine)].length
      if (cadres === 0) continue
      porteurs[f] = cadres
      const actifs = [...source.matchAll(/<RefletDuCadre actif=\{(\w+)\} \/>/g)].map((m) => m[1]!)
      expect(actifs.length, f).toBe(cadres)
      const enCours = new Set([...source.matchAll(/(\w+) \? ' is-live'/g)].map((m) => m[1]!))
      for (const actif of actifs) expect(enCours, `${f} : ${actif}`).toContain(actif)
    }
    expect(Object.keys(porteurs).sort()).toEqual([
      'ArtifactPile.tsx',
      'ArtifactPreview.tsx',
      'ChatView.parts.tsx',
      'ThinkingBlock.tsx'
    ])
    for (const f of ['LookDecodeBlock.tsx', 'Bloc3D.tsx'])
      expect(readFileSync(join(ICI, f), 'utf8'), f).not.toContain('RefletDuCadre')
  })

  it('tourne sur Raisonnement en cours, dans son summary replie, et s eteint quand il finit', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    act(() => root.render(createElement(ThinkingBlock, { text: 'je pese', done: false })))
    const bloc = host.querySelector<HTMLDetailsElement>('[data-testid="thinking-block"]')!
    expect(bloc.open).toBe(false)
    expect(bloc.querySelector(':scope > summary > .cadre-reflet:first-child')).not.toBeNull()
    act(() => root.render(createElement(ThinkingBlock, { text: 'je pese', done: true })))
    expect(host.querySelector('.cadre-reflet')).toBeNull()
    act(() => root.unmount())
    host.remove()
  })
})
