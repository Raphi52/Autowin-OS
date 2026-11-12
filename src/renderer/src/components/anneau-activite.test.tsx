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
 *    le rend juste dans tous les themes (le defaut de l'ancienne carte, repeinte par sept feuilles).
 */
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LegendeDesOutils } from './anneau-activite'
import {
  casesDuVerdict,
  exceptionDuGroupe,
  groupesDeLegende,
  verdictDuRond
} from './anneau-activite-calcul'
import { AssistantActivityGroup } from './ChatView.parts'

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

  it('allume le reflet et la lueur chaude quand ca tourne', () => {
    const i = css.indexOf('.cadre-anneau.is-live {')
    expect(i).toBeGreaterThan(-1)
    const regle = css.slice(i, css.indexOf('}', i))
    expect(regle).toMatch(/--chat-capsule-reflet-haut/)
    expect(regle).toMatch(/box-shadow:[^;]*--capsule-chaud/)
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
  // Une ellipse posee sur l'eclat, dont la largeur est un % du bloc : en pixels fixes, le spectre
  // couvrait tout le bord d'un bloc etroit et l'anneau redevenait arc-en-ciel. Un % SEUL : Chromium
  // refuse `min()`/`calc()` melant px et % dans cette taille et jette tout le `background`.
  const SUR_L_ECLAT = /^radial-gradient\(\s*\d+% \d+px at [^,]*var\(--chrome-x\)[^,]*,/

  /**
   * ANNEAU HOLOGRAPHIQUE : un seul dessin pour le bord de tous les blocs encadres du fil, copie de
   * l'anneau d'un bouton de verre choisi par l'utilisateur : un metal sombre, un point blanc, le
   * spectre serre autour de ce blanc, et un eclat qui ne bouge que la ou il dit quelque chose.
   * ENTREE QUI DOIT FAIRE ECHOUER CE TEST : retirer un bloc de la liste, ecrire une couleur en dur,
   * etaler le spectre le long du metal (l'arc-en-ciel tout autour, refuse), revenir au chrome clair a
   * frange de 2 px (refuse aussi), ou faire bouger l'eclat des blocs au repos (l'animation repeint
   * le calque a chaque image).
   */
  it('pose l anneau holographique sur chaque bloc encadre, a partir des jetons du theme', () => {
    const regle = regleDe(':is(.cadre-anneau, .look-decode-block, .bloc-3d)::before')
    const { valeur, couches } = couchesDuFond(regle)
    expect(regle).toMatch(/\bpadding: 3px;/)
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)

    // Le metal reste SOMBRE : du noir et des gris, le spectre n'y entre qu'en teinte du noir.
    const metal = couches.filter((c) => c.startsWith('linear-gradient('))
    expect(metal).toHaveLength(1)
    for (const jeton of ['noir', 'sombre', 'moyen'])
      expect(metal[0]).toContain(`var(--chrome-${jeton})`)
    const teintes = [
      ...metal[0]!.matchAll(
        /color-mix\(in srgb, var\(--prisme-\w+\) (\d+)%, var\(--chrome-noir\)\)/g
      )
    ]
    for (const t of teintes) expect(Number(t[1])).toBeLessThanOrEqual(30)
    expect(
      metal[0]!.replace(/color-mix\(in srgb, var\(--prisme-\w+\) \d+%, var\(--chrome-noir\)\)/g, '')
    ).not.toContain('--prisme-')

    // Deux points blancs sur la position de l'eclat (en haut, et l'oppose en bas).
    const blancs = couches.filter(
      (c) =>
        SUR_L_ECLAT.test(c) &&
        /,\s*(var\(--chrome-eclat\)|color-mix\(in srgb, var\(--chrome-eclat\))/.test(c)
    )
    expect(blancs).toHaveLength(2)
    // Le spectre entier, mais seulement en anneaux autour de ces points : transparent au centre.
    const spectres = couches.filter((c) => c.includes('--prisme-') && !c.startsWith('linear'))
    expect(spectres).toHaveLength(2)
    for (const s of spectres)
      expect(s).toMatch(new RegExp(`${SUR_L_ECLAT.source}\\s*transparent \\d+%`))
    for (const jeton of ['jaune', 'or', 'rouge', 'magenta', 'bleu', 'cyan', 'vert'])
      expect(spectres.join('\n')).toContain(`var(--prisme-${jeton})`)
    expect(regle).not.toMatch(/animation/)
  })

  // Le halo deborde en hauteur seulement : un calque qui depasse sur les cotes elargit la zone
  // defilable du fil (barre horizontale possible). Eteint en clair : sur fond blanc il ne restait
  // qu'une tache beige. ENTREE QUI DOIT FAIRE ECHOUER : un `inset` qui deborde a gauche ou a droite,
  // une couleur en dur, un halo qui ne suit pas l'eclat, ou un halo rallume en clair.
  it('fait deborder la lumiere de l eclat en halo, sans elargir le fil', () => {
    const regle = regleDe(':is(.cadre-anneau, .look-decode-block)::after')
    const { valeur, couches } = couchesDuFond(regle)
    expect(regle).toMatch(/\binset: -\d+px 0;/)
    expect(regle).toMatch(/\bz-index: -2;/)
    expect(regle).toMatch(/\bpointer-events: none;/)
    expect(valeur).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(/i)
    expect(couches.length).toBeGreaterThan(0)
    for (const c of couches) expect(c).toMatch(SUR_L_ECLAT)
    expect(couches[0]).toContain('var(--chrome-halo)')
    expect(couches.join('\n')).toContain('var(--chrome-halo-froid)')
    const modes = readFileSync(join(ICI, '..', 'assets', 'theme-modes.css'), 'utf8')
    expect(modes).toMatch(/--chrome-halo:\s*transparent;/)
    expect(modes).toMatch(/--chrome-halo-froid:\s*transparent;/)
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

  it('ne fait bouger l eclat que sur un bloc en cours ou survole', () => {
    const regles = [...css.matchAll(/([^{}]+)\{[^{}]*animation:\s*chrome-balayage[^{}]*\}/g)].map(
      (m) =>
        m[1]!
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split(',')
          .map((s) => s.replace(/\s+/g, ' ').trim())
    )
    expect(regles).toEqual([
      [
        '.cadre-anneau.is-live::before',
        '.cadre-anneau.is-live::after',
        ':is(.cadre-anneau',
        '.look-decode-block',
        '.bloc-3d):hover::before',
        ':is(.cadre-anneau',
        '.look-decode-block):hover::after'
      ]
    ])
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
