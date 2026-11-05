#!/usr/bin/env node
// Extrait les VALEURS EXACTES des graphiques SVG d'une page web (score par niveau d'effort et coût),
// au lieu de les lire à l'œil sur une capture. Origine : conv-1594 (2026-11-05) — refaire le graphique
// « score / coût par tentative » des pages modèles Anthropic (anthropic.com/claude-opus-5-5…).
// Chaque point accessible de ces graphiques porte « <série> · <niveau>: <score>[%] $<coût> » dans son
// aria-label ; le titre du graphique est l'aria-label du <svg>.
//
// Usage : node scripts/graphiques-svg-extraire.mjs <url|fichier.html> [...] [--titre <filtre>]
// Sortie : JSON [{ source, titre, points: [{ serie, niveau, score, unite, cout }] }] sur la sortie standard.
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

// Séparateur série/niveau : « · », « – », « - », ou le caractère de remplacement quand la page
// a été mal décodée (relevé tel quel sur la page Sonnet 5.5).
const POINT = /^(.+?)\s+[·–—\-�]\s+([^:]+):\s*([\d.,]+)\s*(%?)\s*\$([\d.,]+)\s*$/

const nombre = (texte) => Number(texte.replace(/,/g, ''))

export function extraireGraphiques(html) {
  const graphiques = []
  for (const [svg] of html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)) {
    const titre = /^<svg\b[^>]*\baria-label="([^"]*)"/.exec(svg)?.[1] ?? ''
    const points = []
    for (const [, label] of svg.matchAll(/<g\b[^>]*\baria-label="([^"]*)"/g)) {
      const m = POINT.exec(label.trim())
      if (!m) continue
      points.push({
        serie: m[1].trim(),
        niveau: m[2].trim(),
        score: nombre(m[3]),
        unite: m[4],
        cout: nombre(m[5])
      })
    }
    if (points.length) graphiques.push({ titre, points })
  }
  return graphiques
}

async function lireSource(source) {
  if (!/^https?:\/\//.test(source)) return readFileSync(source, 'utf8')
  const reponse = await fetch(source, { headers: { 'user-agent': 'Mozilla/5.0' } })
  if (!reponse.ok) throw new Error(`${source} : HTTP ${reponse.status}`)
  return reponse.text()
}

async function main(argv) {
  const sources = []
  let filtre = ''
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--titre') filtre = (argv[++i] ?? '').toLowerCase()
    else sources.push(argv[i])
  }
  if (!sources.length) {
    console.error('Usage : node scripts/graphiques-svg-extraire.mjs <url|fichier.html> [...] [--titre <filtre>]')
    process.exit(2)
  }
  const sortie = []
  for (const source of sources) {
    for (const g of extraireGraphiques(await lireSource(source))) {
      if (!filtre || g.titre.toLowerCase().includes(filtre)) sortie.push({ source, ...g })
    }
  }
  console.log(JSON.stringify(sortie, null, 2))
  if (!sortie.length) process.exit(4)
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2)).catch((erreur) => {
    console.error(erreur.message)
    process.exit(1)
  })
}
