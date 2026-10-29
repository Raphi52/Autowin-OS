// @vitest-environment happy-dom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { afterEach, beforeAll, describe, expect, it } from 'vitest'
import type {
  CarteDesBesoins,
  DemandeDeLaCarte,
  ProjetDeLaCarte
} from '../../../shared/carte-des-besoins'
import { POSTIT_H } from './carte-riviere'
import { RiviereDuProjet } from './RiviereDuProjet'
import type { BilanDeVerification } from './verification-du-board'

/**
 * LE TABLEAU DE LIÈGE ET SES PUNAISES (conv-1204, 2026-10-28) : « le tableau de fond du board doit
 * simuler un tableau en liège, les aimants disparaissent au profit d'une punaise au centre du
 * post-it […] les couleurs des punaises c'est une couleur par personne ». ENTRÉES QUI DOIVENT FAIRE
 * ÉCHOUER : un aimant encore rendu, un post-it sans punaise, deux personnes de même couleur (y
 * compris au-delà des 6 couleurs de la palette, que l'ancien `i % 6` répétait), une personne
 * inconnue peinte d'une couleur de personne, une punaise hors du milieu du post-it, un fond qui
 * n'est plus le liège.
 * Puis « il doit y avoir plus de texte par post it et les boutons valider / à la main doivent
 * apparaître en dessous du post-it et être bien centrés » : un titre recoupé à 2 lignes, des gestes
 * posés SUR le papier (ils cachaient sa ligne projet · heure) ou décalés de son milieu.
 */

const MAINTENANT = new Date(2026, 9, 28, 15, 0).getTime()
const HEURE = 3_600_000

function carte(personnes: number, sansPersonne = 1): CarteDesBesoins {
  const demandes: DemandeDeLaCarte[] = []
  const demandeurs: CarteDesBesoins['demandeurs'] = []
  for (let i = 0; i < personnes; i += 1) {
    const cle = `p${i}@x`
    demandeurs.push({ cle, nom: `P${i}`, demandes: personnes - i })
    demandes.push({
      conversationId: `conv-${i}`,
      conversationTitre: `Fil ${i}`,
      rang: 1,
      titre: `demande ${i}`,
      statut: 'sans-preuve',
      constat: '',
      debut: MAINTENANT - (i + 1) * HEURE,
      demandeur: { cle, nom: `P${i}`, origine: 'journal' }
    })
  }
  for (let i = 0; i < sansPersonne; i += 1)
    demandes.push({
      conversationId: `conv-anonyme-${i}`,
      conversationTitre: 'Fil sans identité git',
      rang: 1,
      titre: 'demande sans demandeur',
      statut: 'prouve',
      constat: '',
      debut: MAINTENANT - 30 * 60_000
    })
  const projet = {
    cle: 'P',
    libelle: 'AutoWinOS',
    nature: 'dossier',
    conversations: demandes.length,
    demandes,
    runsBloques: [],
    comptes: { prouve: sansPersonne, refuse: 0, 'en-cours': 0, 'sans-preuve': personnes }
  } as ProjetDeLaCarte
  return {
    projets: [projet],
    comptes: projet.comptes,
    demandes: demandes.length,
    runsBloques: 0,
    conversationsLues: demandes.length,
    demandeurs,
    demandesJournalisees: demandes.length,
    calculeeA: MAINTENANT,
    dureeMs: 1
  }
}

describe('RiviereDuProjet — liège et punaises (conv-1204)', () => {
  beforeAll(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })
  const montes: Array<{ root: ReturnType<typeof createRoot>; el: HTMLDivElement }> = []
  afterEach(async () => {
    for (const m of montes.splice(0)) {
      await act(async () => m.root.unmount())
      m.el.remove()
    }
  })

  async function monter(donnees: CarteDesBesoins, avecVerifier = false): Promise<HTMLDivElement> {
    const el = document.createElement('div')
    document.body.append(el)
    const root = createRoot(el)
    montes.push({ root, el })
    const verifier = async (): Promise<BilanDeVerification> => ({ lances: [], echecs: [] })
    await act(async () =>
      root.render(
        createElement(RiviereDuProjet, {
          carte: donnees,
          ouvrir: () => {},
          ...(avecVerifier ? { verifier } : {})
        })
      )
    )
    return el
  }

  const couleurDe = (el: HTMLElement, conversationId: string): string => {
    const postit = el.querySelector(
      `[data-testid="riviere-postit"][data-conversation="${conversationId}"]`
    )!
    const punaise = postit.querySelector<HTMLElement>('[data-testid="riviere-punaise"]')!
    return punaise.style.getPropertyValue('--riviere-punaise')
  }

  it('une punaise par post-it, plus aucun aimant', async () => {
    const el = await monter(carte(2))
    const postits = el.querySelectorAll('[data-testid="riviere-postit"]')
    expect(postits.length).toBe(3)
    for (const p of postits)
      expect(p.querySelectorAll('[data-testid="riviere-punaise"]').length).toBe(1)
    expect(el.querySelector('.riviere-aimant')).toBeNull()
  })

  it('une couleur par personne, même au-delà des 6 de la palette', async () => {
    const el = await monter(carte(9))
    const couleurs = Array.from({ length: 9 }, (_, i) => couleurDe(el, `conv-${i}`))
    for (const c of couleurs) expect(c).not.toBe('')
    expect(new Set(couleurs).size).toBe(9)
    // Le premier demandeur (le plus actif) garde le jaune de la palette.
    expect(couleurs[0]).toBe('#e9bd4e')
  })

  it('une personne inconnue n’emprunte aucune couleur de personne : le gris de la feuille', async () => {
    const el = await monter(carte(2))
    expect(couleurDe(el, 'conv-anonyme-0')).toBe('')
  })

  it('la feuille plante la punaise au milieu du haut et peint le liège', () => {
    const css = readFileSync('src/renderer/src/components/RiviereDuProjet.css', 'utf8')
    const regle = (selecteur: string): string => {
      const debut = css.indexOf(`${selecteur} {`)
      expect(debut).toBeGreaterThanOrEqual(0)
      return css.slice(debut, css.indexOf('}', debut))
    }
    const punaise = regle('.riviere-punaise')
    expect(punaise).toMatch(/left:\s*50%/u)
    expect(punaise).toMatch(/var\(--riviere-punaise,\s*#9aa4b2\)/u)
    expect(css).not.toMatch(/\.riviere-aimant/u)
    // Le liège est une IMAGE : les couches de thème générées ne recopient pas un `url(`, il reste
    // donc le même dans tous les thèmes.
    expect(regle('.riviere-cadre')).toMatch(
      /background:\s*url\("data:image\/svg\+xml[^]*feTurbulence/u
    )
  })

  it('les gestes « vérifier » sont centrés SOUS leur post-it, pas sur son papier', async () => {
    const el = await monter(carte(3), true)
    const gestes = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-verif-postit"]')]
    expect(gestes.length).toBe(3)
    for (const g of gestes) {
      const id = g.dataset.verifConversation!
      const p = el.querySelector<HTMLElement>(
        `[data-testid="riviere-postit"][data-conversation="${id}"]`
      )!
      const [tx, ty, , k] =
        /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e-]+), ([\d.e-]+)\)/u
          .exec(p.style.transform)!
          .slice(1)
          .map(Number)
      // `left` = le milieu du papier (la feuille recentre par translateX(-50 %)), `top` = sous son bas.
      expect(parseFloat(g.style.left)).toBeCloseTo(tx + parseFloat(p.style.width) / 2, 6)
      expect(parseFloat(g.style.top)).toBeGreaterThan(ty + POSTIT_H * k)
    }
    const css = readFileSync('src/renderer/src/components/VerificationDuBoard.css', 'utf8')
    const debut = css.indexOf('.riviere-verif-postit {')
    const regle = css.slice(debut, css.indexOf('}', debut))
    expect(regle).toMatch(/transform:\s*translateX\(-50%\)/u)
    expect(regle).toMatch(/justify-content:\s*center/u)
  })

  // « dans le board les boutons verifier apparaissent que quand ma souris est dans le haut de la
  // carte » (conv-1214, 2026-10-28). Mesuré dans l'app (souris CDP, 2133 × 1146) : les boutons d'un
  // post-it, posés sous lui, tombaient sur les 14 premiers pixels du post-it du dessous — l'écart
  // entre deux lignes (8 × k) est plus court que les boutons (20 px). Ils semblaient donc appartenir
  // à celui-là, et disparaissaient dès que la souris descendait plus bas dans sa carte.
  it('les gestes d’un post-it « À vérifier » ne mordent jamais sur le post-it du dessous', async () => {
    /** La hauteur des deux boutons à l'échelle 1, mesurée dans Chromium (conv-1214). */
    const HAUT_MESURE_DES_GESTES = 20
    const el = await monter(carte(8), true)
    const papiers = [...el.querySelectorAll<HTMLElement>('[data-testid="riviere-postit"]')].map(
      (p) => {
        const [tx, ty, , k] =
          /translate\(([-\d.e]+)px, ([-\d.e]+)px\) scale\(([\d.e-]+), ([\d.e-]+)\)/u
            .exec(p.style.transform)!
            .slice(1)
            .map(Number)
        const largeur = parseFloat(p.style.width)
        return { id: p.dataset.conversation!, gauche: tx, droite: tx + largeur, haut: ty, k }
      }
    )
    let dessous = 0
    for (const g of el.querySelectorAll<HTMLElement>('[data-testid="riviere-verif-postit"]')) {
      const echelle = Number(g.style.getPropertyValue('--riviere-gestes-echelle') || 1)
      const haut = parseFloat(g.style.top)
      const bas = haut + HAUT_MESURE_DES_GESTES * echelle
      const milieu = parseFloat(g.style.left)
      const sien = papiers.find((p) => p.id === g.dataset.verifConversation)!
      for (const p of papiers) {
        if (p === sien || p.haut <= sien.haut || milieu < p.gauche || milieu > p.droite) continue
        dessous += 1
        expect(bas, `${sien.id} sur ${p.id}`).toBeLessThanOrEqual(p.haut)
      }
    }
    // Le cas mesuré existe bien : des post-it empilés dans la même colonne.
    expect(dessous).toBeGreaterThan(0)
  })

  // « réduis un peu la taille de la police et passe à 4 lignes le contenu des post it » (conv-1204).
  it('le titre d’un post-it tient sur 4 lignes, dans une police plus petite qu’avant', () => {
    const css = readFileSync('src/renderer/src/components/RiviereDuProjet.css', 'utf8')
    // La règle propre au sélecteur, en début de ligne : `.riviere-postit[data-taille='puce']
    // .riviere-postit-meta {`, plus haut, n'a pas de police.
    const regle = (selecteur: string): string => {
      const debut = css.search(new RegExp(`^${selecteur.replace(/\./gu, '\\.')} \\{`, 'mu'))
      expect(debut).toBeGreaterThanOrEqual(0)
      return css.slice(debut, css.indexOf('}', debut))
    }
    /** La taille et l'interligne d'une déclaration `font: <graisse> <taille>px/<interligne>`. */
    const police = (selecteur: string): { taille: number; ligne: number } => {
      const m = /font:\s*\d+\s+([\d.]+)px\/([\d.]+)/u.exec(regle(selecteur))!
      return { taille: Number(m[1]), ligne: Number(m[1]) * Number(m[2]) }
    }
    const titre = police('.riviere-postit-titre')
    const meta = police('.riviere-postit-meta')
    expect(regle('.riviere-postit-titre')).toMatch(/-webkit-line-clamp:\s*4;/u)
    // 12 et 10 px avant cette demande.
    expect(titre.taille).toBeLessThan(12)
    expect(meta.taille).toBeLessThan(10)
    // La bande de la punaise (14), 4 lignes de titre, l'écart (2), la ligne projet · heure et la
    // marge du bas (4) tiennent dans le papier : sinon la 4e ligne serait rognée sans points de suite.
    expect(14 + 4 * titre.ligne + 2 + meta.ligne + 4).toBeLessThanOrEqual(POSTIT_H)
  })
})
