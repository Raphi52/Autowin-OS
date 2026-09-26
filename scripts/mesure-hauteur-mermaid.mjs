/**
 * PREUVE HORS-MODELE, COTE MISE EN PAGE : un diagramme mermaid ne depasse pas le plafond de hauteur.
 *
 * Pourquoi ce script et pas `cdp-chat-mermaid.mjs` : cette sonde-la exige l'application PAQUETEE
 * (dist/win-unpacked), donc elle mesure le CSS d'un build, pas la feuille du depot. Ici on charge
 * directement `ChatView.css` dans un vrai moteur Chromium (Electron, fenetre cachee) avec un <svg>
 * imitant celui de mermaid : viewBox haut + `style="max-width:<largeur>px"` en ligne, exactement la
 * forme qui s'etirait sur plusieurs ecrans (signale par l'utilisateur le 2026-09-14).
 *
 * fix-ok: scripts/mesure-hauteur-mermaid.mjs — cause mesuree — un <svg> mermaid a viewBox 544x1200 borne SEULEMENT en largeur
 * (max-width:100%) garde son ratio intrinseque et rend 1544 px de haut (mesure, exit 1). Poser
 * max-height + width:auto sur .md-mermaid svg le ramene a la valeur du plafond (mesure, exit 0).
 *
 * Usage : node_modules/.bin/electron scripts/mesure-hauteur-mermaid.mjs
 * Sortie : JSON sur stdout, code 0 si la hauteur rendue tient sous le max-height de la feuille.
 */
import { app, BrowserWindow } from 'electron'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

const css = readFileSync(resolve('src/renderer/src/components/ChatView.css'), 'utf-8')
const HAUTEUR_FENETRE = 900
const html = `<!doctype html><meta charset="utf-8"><style>
html,body{margin:0;padding:0}
.hote{width:700px}
${css}
</style>
<div class="hote"><div class="md"><div class="md-mermaid" data-testid="chat-inline-mermaid">
<svg id="diagramme" aria-roledescription="flowchart-v2" viewBox="0 0 544 1200"
     style="max-width: 544px;" width="100%" xmlns="http://www.w3.org/2000/svg">
  <rect x="0" y="0" width="544" height="1200" fill="#8ab"/>
</svg>
</div></div></div>`

// Electron est une application GUI sous Windows : son stdout n'arrive pas toujours au shell.
// La preuve est donc ECRITE dans un fichier, en plus du code de sortie.
const journal = resolve('Audit/mermaid-hauteur.json')
/** Mesure la hauteur rendue et ecrit la preuve. @returns {Promise<void>} */
const principal = async () => {
  await app.whenReady()
  const fenetre = new BrowserWindow({ show: false, width: 1280, height: HAUTEUR_FENETRE })
  await fenetre.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html))
  const mesure = await fenetre.webContents.executeJavaScript(`(() => {
  const svg = document.getElementById('diagramme')
  const boite = svg.getBoundingClientRect()
  const conteneur = svg.parentElement.getBoundingClientRect()
  const cadre = svg.parentElement
  return {
    // Le plafond est porte par le CADRE qui defile ; le dessin garde sa hauteur naturelle.
    hauteurCadre: Math.round(conteneur.height),
    cadreDefile: cadre.scrollHeight > cadre.clientHeight + 1,
    hauteurSvg: Math.round(boite.height),
    largeurSvg: Math.round(boite.width),
    largeurConteneur: Math.round(conteneur.width),
    debordement: Math.round(boite.right - conteneur.right),
    hauteurFenetre: window.innerHeight,
    maxHeightCalcule: getComputedStyle(cadre).maxHeight
  }
})()`)
  console.log(JSON.stringify(mesure, null, 2))
  writeFileSync(journal, JSON.stringify(mesure, null, 2))

  // PREUVE VISUELLE : le PNG du rendu reel, a lire a l'oeil en plus des chiffres.
  const image = await fenetre.webContents.capturePage()
  writeFileSync(resolve('Audit/mermaid-hauteur.png'), image.toPNG())

  // Le plafond vient de la feuille elle-meme (max-height calcule par Chromium), pas d'une
  // valeur en dur : sinon ce controle reste sur l'ancien reglage quand le CSS change.
  const plafond = Number.parseFloat(mesure.maxHeightCalcule)
  if (!Number.isFinite(plafond)) throw new Error(`max-height illisible: ${mesure.maxHeightCalcule}`)
  const echecs = []
  if (mesure.hauteurCadre > plafond + 1)
    echecs.push(
      `cadre de ${mesure.hauteurCadre}px > plafond ${Math.round(plafond)}px (max-height calcule: ${mesure.maxHeightCalcule})`
    )
  if (!mesure.cadreDefile) echecs.push('le cadre ne defile pas : le schema haut est retreci ou coupe')
  if (mesure.debordement > 2)
    echecs.push(`le diagramme deborde de son conteneur de ${mesure.debordement}px`)
  if (mesure.largeurSvg < 40 || mesure.hauteurSvg < 20)
    echecs.push(`diagramme non rendu (${mesure.largeurSvg}x${mesure.hauteurSvg})`)
  writeFileSync(journal, JSON.stringify({ mesure, plafond: Math.round(plafond), echecs }, null, 2))
  if (echecs.length) {
    for (const echec of echecs) console.error('- ' + echec)
    app.exit(1)
  } else {
    console.log('OK — le diagramme tient sous le plafond de hauteur et ne deborde pas.')
    app.exit(0)
  }
}
principal().catch((erreur) => {
  writeFileSync(journal, JSON.stringify({ erreur: String(erreur) }, null, 2))
  app.exit(2)
})
