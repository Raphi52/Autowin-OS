/*
 * BOITE A OUTILS DE GRAPHIQUES DES PAGES INTERACTIVES (conv-1304, 2026-10-30) — `autowin.graphique`.
 *
 * Pourquoi : banc du 2026-10-30, chaque modele redessinait a la main axes, graduations, survol et
 * legende (conv-1310 : 40 lignes pour dix barres), et ce code differe d'une page a l'autre. Une
 * ligne suffit maintenant :
 *   autowin.graphique('#zone', { type: 'barres', categories: ['jan', 'fev'], valeurs: [120, 135] })
 *
 * SVG et non canvas : les couleurs sont des `var(--...)`, donc un changement de theme de l'app suit
 * sans redessiner, et le trait reste net a toute echelle. Aucune dependance, aucun reseau.
 *
 * Ce fichier tourne dans deux endroits : la page isolee (amorce.js l'evalue au premier appel, pose
 * en texte par page-scene-3d.mjs) et une page enregistree en .html (page-autonome.ts l'y recopie).
 * Le texte est une EXPRESSION dont la valeur est la fonction `graphique(cible, options)`.
 */
/* eslint-disable @typescript-eslint/explicit-function-return-type -- JavaScript pose tel quel dans
   la page : aucune annotation de type n'y a sa place. */
;(() => {
  'use strict'
  const SVG = 'http://www.w3.org/2000/svg'
  // Des couleurs nommees par le theme, pas en dur ; le repli sert un theme qui ne definit pas le jeton.
  const PALETTE = [
    'var(--gold-clair, #e0b85c)',
    'var(--violet, #9a8cff)',
    'var(--ok, #4cc38a)',
    'var(--rose, #f08fb0)',
    'var(--warn, #e0783c)',
    'var(--text-dim, #8f98a8)'
  ]
  const TYPES = new Set(['barres', 'lignes', 'aires', 'secteurs', 'points'])
  const STYLE =
    '.aw-graphique{position:relative;width:100%;min-width:0}' +
    '.aw-graphique-titre{font-weight:600;margin:0 0 4px}' +
    '.aw-graphique svg{display:block;width:100%;overflow:visible;outline:0;touch-action:pan-y}' +
    '.aw-graphique svg:focus-visible{outline:1px solid var(--gold-doux,currentColor);outline-offset:2px}' +
    '.aw-graphique text{fill:var(--text-dim,currentColor);font:11px var(--page-police,system-ui,sans-serif)}' +
    '.aw-graphique-grille{stroke:var(--text,currentColor);stroke-opacity:.12}' +
    '.aw-graphique-axe{stroke:var(--text,currentColor);stroke-opacity:.3}' +
    '.aw-graphique-repere{stroke:var(--text,currentColor);stroke-opacity:.35;stroke-dasharray:3 3}' +
    '.aw-graphique-bande{fill:var(--text,currentColor);fill-opacity:.06}' +
    '.aw-graphique-legende{display:flex;flex-wrap:wrap;gap:2px 10px;margin:6px 0 0;padding:0;font-size:12px}' +
    '.aw-graphique-legende button{display:inline-flex;align-items:center;gap:5px;padding:1px 2px;border:0;' +
    'background:none;color:inherit;font:inherit;cursor:pointer}' +
    '.aw-graphique-legende button[aria-pressed=false]{opacity:.45;text-decoration:line-through}' +
    '.aw-graphique-pastille{width:9px;height:9px;border-radius:2px;flex:none}' +
    '.aw-graphique-bulle{position:absolute;top:0;left:0;z-index:5;max-width:min(240px,90%);padding:4px 8px;' +
    'border:1px solid var(--line,currentColor);border-radius:6px;font-size:12px;line-height:1.45;' +
    'pointer-events:none;background:var(--bg-0,Canvas);color:var(--text,CanvasText);white-space:nowrap}' +
    '.aw-graphique-bulle[hidden]{display:none}' +
    '.aw-graphique-bulle-ligne{display:flex;align-items:center;gap:6px}' +
    '.aw-graphique-bulle b{font-weight:700;font-variant-numeric:tabular-nums}'

  const borner = (valeur, min, max) => Math.min(max, Math.max(min, valeur))

  const element = (nom, attributs = {}, parent = null) => {
    const noeud = document.createElementNS(SVG, nom)
    for (const [cle, valeur] of Object.entries(attributs)) noeud.setAttribute(cle, String(valeur))
    if (parent) parent.appendChild(noeud)
    return noeud
  }

  const html = (nom, classe, parent = null) => {
    const noeud = document.createElement(nom)
    if (classe) noeud.className = classe
    if (parent) parent.appendChild(noeud)
    return noeud
  }

  const installerStyle = () => {
    if (document.getElementById('aw-graphique-style')) return
    const style = document.createElement('style')
    style.id = 'aw-graphique-style'
    style.textContent = STYLE
    document.head.appendChild(style)
  }

  /** Des graduations rondes (1, 2, 2,5 ou 5 × 10^n) qui couvrent [min, max]. */
  const graduations = (min, max, voulu) => {
    if (!(max > min)) {
      const base = min === 0 ? 1 : Math.abs(min) * 0.1
      return graduations(min - base, max + base, voulu)
    }
    const brut = (max - min) / Math.max(1, voulu)
    const puissance = 10 ** Math.floor(Math.log10(brut))
    const rapport = brut / puissance
    const pas =
      (rapport <= 1 ? 1 : rapport <= 2 ? 2 : rapport <= 2.5 ? 2.5 : rapport <= 5 ? 5 : 10) *
      puissance
    const debut = Math.floor(min / pas + 1e-9)
    const fin = Math.ceil(max / pas - 1e-9)
    const liste = []
    for (let rang = debut; rang <= fin; rang += 1) liste.push(Number((rang * pas).toPrecision(12)))
    return liste
  }

  const numero = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 2 })

  /** La forme normalisee, ou une erreur qui dit quoi corriger (elle s'affiche sous la page). */
  const lireOptions = (options) => {
    if (!options || typeof options !== 'object') {
      throw new Error('autowin.graphique : options manquantes ({ type, categories, valeurs })')
    }
    const type = options.type === undefined ? 'barres' : options.type
    if (!TYPES.has(type)) {
      throw new Error(`autowin.graphique : type « ${type} » inconnu (${[...TYPES].join(', ')})`)
    }
    const brutes = Array.isArray(options.series)
      ? options.series
      : [{ nom: options.nom, valeurs: options.valeurs, points: options.points }]
    const series = brutes.map((serie, rang) => {
      const nom = serie && serie.nom !== undefined ? String(serie.nom) : `Série ${rang + 1}`
      const lue = { nom, couleur: (serie && serie.couleur) || PALETTE[rang % PALETTE.length] }
      if (type === 'points') {
        if (!serie || !Array.isArray(serie.points)) {
          throw new Error(`autowin.graphique : « ${nom} » n'a pas de points ([[x, y], ...])`)
        }
        lue.points = serie.points.map(([x, y], i) => {
          if (!Number.isFinite(x) || !Number.isFinite(y)) {
            throw new Error(`autowin.graphique : « ${nom} », point ${i + 1} non numérique`)
          }
          return [x, y]
        })
        return lue
      }
      if (!serie || !Array.isArray(serie.valeurs)) {
        throw new Error(`autowin.graphique : « ${nom} » n'a pas de valeurs (tableau de nombres)`)
      }
      lue.valeurs = serie.valeurs.map((valeur, i) => {
        if (valeur === null || valeur === undefined) return null
        if (!Number.isFinite(valeur)) {
          throw new Error(`autowin.graphique : « ${nom} », valeur ${i + 1} non numérique`)
        }
        return valeur
      })
      return lue
    })
    if (series.length === 0) throw new Error('autowin.graphique : aucune série à dessiner')
    let categories = []
    if (type !== 'points') {
      const longueur = Math.max(...series.map((serie) => serie.valeurs.length))
      categories = Array.isArray(options.categories)
        ? options.categories.map(String)
        : Array.from({ length: longueur }, (_, i) => String(i + 1))
      if (longueur > categories.length) {
        throw new Error(
          `autowin.graphique : ${longueur} valeurs pour ${categories.length} catégories`
        )
      }
    }
    if (type === 'secteurs' && series[0].valeurs.some((valeur) => valeur !== null && valeur < 0)) {
      throw new Error('autowin.graphique : un secteur ne peut pas être négatif')
    }
    return { ...options, type, series, categories }
  }

  /** `autowin.graphique(cible, options)` : dessine, puis suit la largeur de la page. */
  const graphique = (cible, options) => {
    const hote = typeof cible === 'string' ? document.querySelector(cible) : cible
    if (!hote || hote.nodeType !== 1) {
      throw new Error(`autowin.graphique : « ${String(cible)} » n'existe pas dans la page`)
    }
    installerStyle()
    let lues = lireOptions(options)
    const masquees = new Set()
    const racine = html('div', 'aw-graphique')
    hote.replaceChildren(racine)
    let largeurDessinee = -1
    let bulle = null

    const formater = (valeur) => {
      if (valeur === null || valeur === undefined) return '—'
      if (typeof lues.format === 'function') return String(lues.format(valeur))
      return lues.unite ? `${numero.format(valeur)}\u202f${lues.unite}` : numero.format(valeur)
    }

    const placerBulle = (x, y) => {
      const large = racine.clientWidth
      const bord = 6
      const gauche = borner(x + 12, bord, Math.max(bord, large - bulle.offsetWidth - bord))
      // Mesures relatives au dessin : la bulle reste sur lui et ne recouvre pas le titre au-dessus.
      const dessin = racine.querySelector('svg').offsetTop
      const haut = dessin + Math.max(0, y - bulle.offsetHeight - 8)
      bulle.style.transform = `translate(${Math.round(gauche)}px,${Math.round(haut)}px)`
    }

    const remplirBulle = (titre, lignes) => {
      bulle.replaceChildren()
      if (titre) html('div', '', bulle).textContent = titre
      for (const { nom, couleur, valeur } of lignes) {
        const ligne = html('div', 'aw-graphique-bulle-ligne', bulle)
        const pastille = html('span', 'aw-graphique-pastille', ligne)
        pastille.style.background = couleur
        if (nom) html('span', '', ligne).textContent = nom
        html('b', '', ligne).textContent = valeur
      }
      bulle.hidden = false
    }

    const cacherBulle = () => {
      if (bulle) bulle.hidden = true
    }

    /** Le survol commun : `chercher(x, y)` rend ce qu'il faut montrer, ou null. */
    const brancherSurvol = (svg, chercher, nombre, parRang) => {
      let rang = -1
      const montrer = (trouve) => {
        if (!trouve) return cacherBulle()
        remplirBulle(trouve.titre, trouve.lignes)
        placerBulle(trouve.x, trouve.y)
        if (trouve.survol) trouve.survol()
        return undefined
      }
      const position = (event) => {
        const cadre = svg.getBoundingClientRect()
        return [event.clientX - cadre.left, event.clientY - cadre.top]
      }
      svg.addEventListener('pointermove', (event) => montrer(chercher(...position(event))))
      svg.addEventListener('pointerdown', (event) => montrer(chercher(...position(event))))
      svg.addEventListener('pointerleave', () => {
        cacherBulle()
        chercher(-1, -1)
      })
      svg.addEventListener('blur', cacherBulle)
      svg.addEventListener('keydown', (event) => {
        if (nombre === 0) return
        if (event.key === 'Escape') cacherBulle()
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
        event.preventDefault()
        rang = (rang + (event.key === 'ArrowRight' ? 1 : -1) + nombre) % nombre
        montrer(parRang(rang))
      })
    }

    const dessinerCartesien = (svg, largeur, hauteur) => {
      const { type, series, categories } = lues
      const visibles = series.filter((serie) => !masquees.has(serie.nom))
      const parCategorie = type === 'barres' || type === 'lignes' || type === 'aires'
      const empile = Boolean(lues.empile) && type !== 'lignes'
      const valeursDe = () => {
        if (type === 'points') return visibles.flatMap((serie) => serie.points.map(([, y]) => y))
        if (!empile) return visibles.flatMap((serie) => serie.valeurs.filter((v) => v !== null))
        return categories.map((_, i) =>
          visibles.reduce((somme, serie) => somme + (serie.valeurs[i] ?? 0), 0)
        )
      }
      const valeurs = valeursDe()
      let bas = valeurs.length > 0 ? Math.min(...valeurs) : 0
      let haut = valeurs.length > 0 ? Math.max(...valeurs) : 1
      // Une barre ou une aire se lit par sa hauteur : l'axe part de zero. Une ligne aussi, sauf si
      // zero ecraserait des valeurs toutes voisines (43,1 a 43,9).
      const depuisZero =
        type === 'barres' || type === 'aires' || (type === 'lignes' && bas >= 0 && bas < haut - bas)
      if (depuisZero) {
        bas = Math.min(0, bas)
        haut = Math.max(0, haut)
      }
      if (Number.isFinite(lues.min)) bas = lues.min
      if (Number.isFinite(lues.max)) haut = lues.max
      const hauteurTraits = hauteur - 32
      const graduationsY = graduations(bas, haut, Math.max(2, Math.round(hauteurTraits / 48)))
      const yMin = Number.isFinite(lues.min) ? lues.min : graduationsY[0]
      const yMax = Number.isFinite(lues.max) ? lues.max : graduationsY[graduationsY.length - 1]
      const textes = graduationsY.map(formater)
      const margeGauche = Math.ceil(Math.max(...textes.map((t) => t.length)) * 6.2) + 10
      const zone = { x: margeGauche, y: 10, l: largeur - margeGauche - 8, h: hauteur - 34 }
      const yDe = (valeur) => zone.y + zone.h - ((valeur - yMin) / (yMax - yMin)) * zone.h

      graduationsY.forEach((valeur, rang) => {
        const y = yDe(valeur)
        if (y < zone.y - 0.5 || y > zone.y + zone.h + 0.5) return
        element(
          'line',
          {
            x1: zone.x,
            x2: zone.x + zone.l,
            y1: y,
            y2: y,
            class: valeur === 0 ? 'aw-graphique-axe' : 'aw-graphique-grille'
          },
          svg
        )
        const texte = element('text', { x: zone.x - 6, y: y + 4, 'text-anchor': 'end' }, svg)
        texte.textContent = textes[rang]
      })

      if (type === 'points') return dessinerPoints(svg, zone, visibles, yDe)

      const n = Math.max(1, categories.length)
      const pas = zone.l / n
      const centre = (i) => zone.x + pas * (i + 0.5)
      const longueurMax = Math.max(1, ...categories.map((c) => c.length))
      const saut = Math.max(1, Math.ceil((longueurMax * 6.4 + 8) / pas))
      categories.forEach((categorie, i) => {
        if (i % saut !== 0) return
        const texte = element(
          'text',
          { x: centre(i), y: zone.y + zone.h + 16, 'text-anchor': 'middle' },
          svg
        )
        texte.textContent = categorie
      })

      const bande = element(
        'rect',
        { y: zone.y, width: pas, height: zone.h, class: 'aw-graphique-bande' },
        svg
      )
      bande.style.display = 'none'
      const repere = element(
        'line',
        { y1: zone.y, y2: zone.y + zone.h, class: 'aw-graphique-repere' },
        svg
      )
      repere.style.display = 'none'

      if (type === 'barres') {
        const largeurGroupe = pas * 0.72
        const rangs = empile ? 1 : Math.max(1, visibles.length)
        const largeurBarre = Math.max(1, largeurGroupe / rangs - (rangs > 1 ? 2 : 0))
        const cumul = new Array(n).fill(0)
        visibles.forEach((serie, rang) => {
          serie.valeurs.forEach((valeur, i) => {
            if (valeur === null) return
            const depart = empile ? cumul[i] : 0
            const y1 = yDe(depart)
            const y2 = yDe(depart + valeur)
            cumul[i] += valeur
            const x = centre(i) - largeurGroupe / 2 + (empile ? 0 : rang * (largeurGroupe / rangs))
            element(
              'rect',
              {
                x,
                y: Math.min(y1, y2),
                width: largeurBarre,
                height: Math.max(valeur === 0 ? 0 : 1, Math.abs(y2 - y1)),
                rx: 2,
                fill: serie.couleur
              },
              svg
            )
          })
        })
      } else {
        const cumul = new Array(n).fill(0)
        visibles.forEach((serie) => {
          let trace = ''
          let enCours = false
          const basAire = []
          serie.valeurs.forEach((valeur, i) => {
            if (valeur === null) {
              enCours = false
              return
            }
            const depart = empile ? cumul[i] : 0
            cumul[i] += empile ? valeur : 0
            const y = yDe(depart + valeur)
            trace += `${enCours ? 'L' : 'M'}${centre(i).toFixed(1)} ${y.toFixed(1)}`
            enCours = true
            basAire.unshift(`L${centre(i).toFixed(1)} ${yDe(depart).toFixed(1)}`)
            if (n <= 40) {
              element('circle', { cx: centre(i), cy: y, r: 2.6, fill: serie.couleur }, svg)
            }
          })
          if (!trace) return
          if (type === 'aires') {
            element(
              'path',
              { d: `${trace}${basAire.join('')}Z`, fill: serie.couleur, 'fill-opacity': 0.18 },
              svg
            )
          }
          element(
            'path',
            {
              d: trace,
              fill: 'none',
              stroke: serie.couleur,
              'stroke-width': 2,
              'stroke-linejoin': 'round',
              'stroke-linecap': 'round'
            },
            svg
          )
        })
      }

      const decrire = (i) => {
        const lignes = visibles
          .filter((serie) => serie.valeurs[i] !== null && serie.valeurs[i] !== undefined)
          .map((serie) => ({
            nom: visibles.length > 1 ? serie.nom : '',
            couleur: serie.couleur,
            valeur: formater(serie.valeurs[i])
          }))
        return {
          titre: categories[i],
          lignes,
          x: centre(i),
          y: zone.y + 6 + (type === 'barres' ? 0 : 0),
          survol: () => {
            if (type === 'barres') {
              bande.style.display = ''
              bande.setAttribute('x', centre(i) - pas / 2)
            } else {
              repere.style.display = ''
              repere.setAttribute('x1', centre(i))
              repere.setAttribute('x2', centre(i))
            }
          }
        }
      }
      if (parCategorie) {
        brancherSurvol(
          svg,
          (x, y) => {
            const dedans =
              x >= zone.x && x <= zone.x + zone.l && y >= zone.y - 4 && y <= zone.y + zone.h + 24
            if (!dedans) {
              bande.style.display = 'none'
              repere.style.display = 'none'
              return null
            }
            const i = borner(Math.floor((x - zone.x) / pas), 0, n - 1)
            const trouve = decrire(i)
            return trouve.lignes.length > 0 ? trouve : null
          },
          categories.length,
          decrire
        )
      }
      return undefined
    }

    const dessinerPoints = (svg, zone, visibles, yDe) => {
      const xs = visibles.flatMap((serie) => serie.points.map(([x]) => x))
      const graduationsX = graduations(
        xs.length > 0 ? Math.min(...xs) : 0,
        xs.length > 0 ? Math.max(...xs) : 1,
        Math.max(2, Math.round(zone.l / 80))
      )
      const xMin = graduationsX[0]
      const xMax = graduationsX[graduationsX.length - 1]
      const xDe = (valeur) => zone.x + ((valeur - xMin) / (xMax - xMin)) * zone.l
      for (const valeur of graduationsX) {
        const texte = element(
          'text',
          { x: xDe(valeur), y: zone.y + zone.h + 16, 'text-anchor': 'middle' },
          svg
        )
        texte.textContent = numero.format(valeur)
      }
      const tous = visibles.flatMap((serie) =>
        serie.points.map(([x, y]) => {
          const noeud = element(
            'circle',
            { cx: xDe(x), cy: yDe(y), r: 3.4, fill: serie.couleur, 'fill-opacity': 0.8 },
            svg
          )
          return { serie, x, y, noeud, px: xDe(x), py: yDe(y) }
        })
      )
      let survole = null
      const decrire = (point) => ({
        titre: numero.format(point.x),
        lignes: [
          {
            nom: visibles.length > 1 ? point.serie.nom : '',
            couleur: point.serie.couleur,
            valeur: formater(point.y)
          }
        ],
        x: point.px,
        y: point.py,
        survol: () => {
          if (survole) survole.noeud.setAttribute('r', 3.4)
          survole = point
          point.noeud.setAttribute('r', 5.5)
        }
      })
      brancherSurvol(
        svg,
        (x, y) => {
          let meilleur = null
          let distance = 40 ** 2
          for (const point of tous) {
            const d = (point.px - x) ** 2 + (point.py - y) ** 2
            if (d < distance) {
              distance = d
              meilleur = point
            }
          }
          if (!meilleur && survole) {
            survole.noeud.setAttribute('r', 3.4)
            survole = null
          }
          return meilleur ? decrire(meilleur) : null
        },
        tous.length,
        (rang) => decrire(tous[rang])
      )
    }

    const dessinerSecteurs = (svg, largeur, hauteur) => {
      const { categories, series } = lues
      const valeurs = series[0].valeurs
      const parts = categories
        .map((categorie, i) => ({
          categorie,
          valeur: valeurs[i] ?? 0,
          couleur: PALETTE[i % PALETTE.length]
        }))
        .filter((part) => part.valeur > 0 && !masquees.has(part.categorie))
      const total = parts.reduce((somme, part) => somme + part.valeur, 0)
      const cx = largeur / 2
      const cy = hauteur / 2
      const rayon = Math.min(largeur, hauteur) / 2 - 6
      const interieur = rayon * 0.62
      const point = (angle, r) => [cx + r * Math.sin(angle), cy - r * Math.cos(angle)]
      let angle = 0
      const secteurs = parts.map((part) => {
        const fraction = part.valeur / total
        // Un seul secteur fait un tour complet : un arc de 360° ne se dessine pas, on s'arrete juste avant.
        const ouverture = Math.min(fraction * 2 * Math.PI, 2 * Math.PI - 1e-4)
        const [ax, ay] = point(angle, rayon)
        const [bx, by] = point(angle + ouverture, rayon)
        const [cx2, cy2] = point(angle + ouverture, interieur)
        const [dx, dy] = point(angle, interieur)
        const grand = ouverture > Math.PI ? 1 : 0
        const milieu = angle + ouverture / 2
        const noeud = element(
          'path',
          {
            d:
              `M${ax} ${ay}A${rayon} ${rayon} 0 ${grand} 1 ${bx} ${by}` +
              `L${cx2} ${cy2}A${interieur} ${interieur} 0 ${grand} 0 ${dx} ${dy}Z`,
            fill: part.couleur
          },
          svg
        )
        const secteur = { ...part, debut: angle, fin: angle + ouverture, milieu, noeud, fraction }
        angle += ouverture
        return secteur
      })
      const centre = element(
        'text',
        { x: cx, y: cy + 4, 'text-anchor': 'middle', style: 'font-size:13px;font-weight:700' },
        svg
      )
      centre.textContent = formater(total)
      const reduire = (sauf) => {
        for (const secteur of secteurs) {
          secteur.noeud.setAttribute('fill-opacity', !sauf || secteur === sauf ? 1 : 0.45)
        }
      }
      const decrire = (secteur) => {
        const [x, y] = point(secteur.milieu, (rayon + interieur) / 2)
        return {
          titre: secteur.categorie,
          lignes: [
            {
              nom: `${numero.format(secteur.fraction * 100)} %`,
              couleur: secteur.couleur,
              valeur: formater(secteur.valeur)
            }
          ],
          x,
          y,
          survol: () => reduire(secteur)
        }
      }
      brancherSurvol(
        svg,
        (x, y) => {
          const dx = x - cx
          const dy = y - cy
          const r = Math.hypot(dx, dy)
          if (r < interieur || r > rayon) {
            reduire(null)
            return null
          }
          const a = (Math.atan2(dx, -dy) + 2 * Math.PI) % (2 * Math.PI)
          const trouve = secteurs.find((secteur) => a >= secteur.debut && a < secteur.fin)
          return trouve ? decrire(trouve) : null
        },
        secteurs.length,
        (rang) => decrire(secteurs[rang])
      )
    }

    const dessinerLegende = () => {
      const { type, series, categories } = lues
      const secteurs = type === 'secteurs'
      const entrees = secteurs
        ? categories.map((nom, i) => ({ nom, couleur: PALETTE[i % PALETTE.length] }))
        : series
      if (entrees.length < 2) return
      const legende = html('div', 'aw-graphique-legende', racine)
      for (const { nom, couleur } of entrees) {
        const bouton = html('button', '', legende)
        bouton.type = 'button'
        bouton.setAttribute('aria-pressed', String(!masquees.has(nom)))
        html('span', 'aw-graphique-pastille', bouton).style.background = couleur
        bouton.append(nom)
        bouton.addEventListener('click', () => {
          if (masquees.has(nom)) masquees.delete(nom)
          else if (masquees.size < entrees.length - 1) masquees.add(nom)
          dessiner()
        })
      }
    }

    const dessiner = () => {
      const largeur = Math.max(160, Math.round(racine.clientWidth || hote.clientWidth || 480))
      largeurDessinee = largeur
      racine.replaceChildren()
      if (lues.titre) html('div', 'aw-graphique-titre', racine).textContent = String(lues.titre)
      const hauteur = Number.isFinite(lues.hauteur)
        ? borner(lues.hauteur, 120, 900)
        : borner(Math.round(largeur * 0.46), 200, 320)
      const svg = element(
        'svg',
        {
          viewBox: `0 0 ${largeur} ${hauteur}`,
          height: hauteur,
          role: 'img',
          tabindex: 0,
          'aria-label': lues.titre ? String(lues.titre) : 'Graphique'
        },
        racine
      )
      bulle = html('div', 'aw-graphique-bulle', racine)
      bulle.hidden = true
      if (lues.type === 'secteurs') dessinerSecteurs(svg, largeur, hauteur)
      else dessinerCartesien(svg, largeur, hauteur)
      dessinerLegende()
    }

    dessiner()
    // Page agrandie, colonne elargie : le graphique se redessine a la vraie largeur au lieu d'etre
    // etire. La hauteur n'entre pas dans la condition : le dessin la change, ce serait une boucle.
    // Au cadre d'affichage suivant : redessiner PENDANT la notification de taille change la hauteur
    // de ce qu'on observe, et Chromium leve « ResizeObserver loop » (banc du 2026-10-30).
    let demande = 0
    const redessinerSiElargi = () => {
      demande = 0
      const largeur = Math.round(racine.clientWidth)
      if (racine.isConnected && largeur > 0 && Math.abs(largeur - largeurDessinee) > 1) dessiner()
    }
    const observateur =
      typeof ResizeObserver === 'undefined'
        ? null
        : new ResizeObserver(() => {
            if (!demande) demande = requestAnimationFrame(redessinerSiElargi)
          })
    if (observateur) observateur.observe(racine)
    return {
      /** Change des options (nouvelles valeurs d'un simulateur) sans recreer le graphique. */
      maj(nouvelles) {
        const suite = { ...lues, ...nouvelles }
        // `lues` porte deja `series` : sans ceci, le raccourci `valeurs` etait ignore en silence.
        if (!nouvelles.series && (nouvelles.valeurs || nouvelles.points)) {
          const { valeurs, points } = nouvelles
          suite.series = [{ ...lues.series[0], ...(valeurs ? { valeurs } : { points }) }]
        }
        lues = lireOptions(suite)
        dessiner()
      },
      detruire() {
        if (observateur) observateur.disconnect()
        racine.remove()
      }
    }
  }

  return graphique
})()
