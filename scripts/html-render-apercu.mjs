/**
 * Aperçu d'un bloc ```html-render TEL QUE LE CHAT L'AFFICHE, avec un verdict machine.
 *
 * Pourquoi il existe (conv-139, tour 1d9c0c1d-e6c2-4794-a927-191c11f2aaf8, 2026-10-10) : six
 * variantes de maquette montrees dans le fil, l'agent avait « verifie chacune en capture ». Mais il
 * avait capture SA copie du HTML dans Edge, a 1640 px de large, avec `zoom:1!important` et l'onglet
 * coche force a la main. L'utilisateur, lui, voyait le bloc passe par le filtre du chat
 * (`chat-html-inline.ts`) dans une colonne d'environ 860 px : une scene de 1440 px coupee a droite,
 * le bouton d'envoi (la moitie des differences) hors de vue, les 21 icones `<use>` supprimees, et
 * des onglets qui ne changeaient qu'environ 1 % des pixels. Reponse (saisie ts=1791619766383) :
 * « je vois les 6 memes … elles devraient etre responsive dans l'espace de chat ». La verification
 * avait porte sur un rendu que personne ne voit.
 *
 * Ce script ferme cet ecart : il applique le VRAI filtre du chat (compile depuis la source), pose le
 * resultat dans un conteneur qui reprend les regles `.md-html` de `ChatView.css`, a une ou plusieurs
 * largeurs de colonne, clique chaque onglet (`label[for]` d'un bouton radio), capture, et mesure.
 *
 * Usage : node scripts/html-render-apercu.mjs <fichier.html|fichier.md> [--bloc 1]
 *           [--largeurs 560,860] [--fenetre 1600] [--out .autowin-tmp/html-render-apercu]
 *           [--seuil-onglets 0.02]
 *   Un fichier .md (ou tout fichier contenant une cloture ```html-render) : le n-ieme bloc est pris.
 *   Sinon le fichier entier est le contenu du bloc.
 *
 * Codes de sortie (un JSON est toujours ecrit sur stdout, champ `defauts`) :
 *   0 = rendu tenu dans chaque largeur, rien de retire, onglets distincts ;
 *   3 = DEBORDEMENT : le bloc est plus large que la colonne (l'utilisateur doit defiler de cote) ;
 *   4 = BALISES RETIREES par le filtre (ce que tu as dessine avec n'existe pas dans le fil) ;
 *   5 = ONGLETS QUASI IDENTIQUES : deux onglets changent moins de `--seuil-onglets` des pixels
 *       visibles — heuristique : en dessous, l'utilisateur voit « la meme chose » ;
 *   2 = usage ; 1 = erreur technique (navigateur introuvable, compilation).
 *   Plusieurs defauts : le code est celui du premier dans l'ordre 3, 4, 5.
 */
import { build } from 'esbuild'
import { chromium } from 'playwright-core'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RACINE = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const FILTRE = join(RACINE, 'src/renderer/src/components/chat-html-inline.ts')
const CHAT_CSS = join(RACINE, 'src/renderer/src/components/ChatView.css')

const NAVIGATEURS = [
  process.env.AUTOWIN_NAVIGATEUR,
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
].filter(Boolean)

function argument(nom, defaut) {
  const i = process.argv.indexOf(nom)
  return i > 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : defaut
}

function sortir(code, rapport) {
  process.stdout.write(JSON.stringify(rapport, null, 2) + '\n')
  process.exit(code)
}

/** Le contenu du bloc : la n-ieme cloture ```html-render, sinon le fichier entier. */
function extraireBloc(texte, rang = 1) {
  const blocs = [...texte.matchAll(/```html-render[^\n]*\n([\s\S]*?)\n```/g)].map((m) => m[1])
  if (!blocs.length) return texte
  return blocs[Math.min(Math.max(rang, 1), blocs.length) - 1]
}

/** Les regles `.md-html` de ChatView.css (pas `.md-html-oversize`) : le conteneur reel du bloc. */
function reglesConteneur() {
  const css = readFileSync(CHAT_CSS, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  return [...css.matchAll(/(^|\n)(\.md-html(?![-\w])[^{]*)\{([^}]*)\}/g)]
    .map((m) => `${m[2].trim()}{${m[3].trim()}}`)
    .join('\n')
}

async function compilerFiltre() {
  const sortie = await build({
    stdin: {
      contents: `import { prepareChatHtml } from ${JSON.stringify(FILTRE.replace(/\\/g, '/'))}\nwindow.prepareChatHtml = prepareChatHtml\n`,
      resolveDir: RACINE,
      loader: 'ts'
    },
    bundle: true,
    format: 'iife',
    write: false,
    logLevel: 'silent'
  })
  return sortie.outputFiles[0].text
}

async function main() {
  const fichier = process.argv[2]
  if (!fichier || fichier.startsWith('--') || !existsSync(fichier))
    sortir(2, { ok: false, erreur: `usage : node scripts/html-render-apercu.mjs <fichier> — introuvable : ${fichier ?? '(rien)'}` })

  const source = extraireBloc(readFileSync(fichier, 'utf8'), Number(argument('--bloc', '1')))
  const largeurs = argument('--largeurs', '560,860').split(',').map(Number).filter((n) => n > 0)
  const fenetre = Number(argument('--fenetre', '1600'))
  const seuil = Number(argument('--seuil-onglets', '0.02'))
  const out = resolve(argument('--out', join(RACINE, '.autowin-tmp/html-render-apercu')))
  mkdirSync(out, { recursive: true })

  const executablePath = NAVIGATEURS.find((chemin) => existsSync(chemin))
  if (!executablePath)
    sortir(1, { ok: false, erreur: `aucun navigateur trouve (essaye : ${NAVIGATEURS.join(' ; ')}) — regle AUTOWIN_NAVIGATEUR` })

  const filtre = await compilerFiltre()
  const conteneur = reglesConteneur()
  const browser = await chromium.launch({ executablePath, headless: true })
  const rapport = { ok: true, fichier, fenetre, largeurs: [], defauts: [], captures: [] }

  try {
    for (const largeur of largeurs) {
      const page = await browser.newPage({ viewport: { width: fenetre, height: 900 } })
      await page.setContent(
        `<!doctype html><html><head><style>${conteneur}</style></head>` +
          `<body style="margin:0;background:#0b0b0e;color:#dde3ee;font:14px 'Segoe UI',system-ui,sans-serif">` +
          `<div id="colonne" style="width:${largeur}px;margin:0 auto"><div id="bloc" class="md-html"></div></div></body></html>`
      )
      await page.addScriptTag({ content: filtre })
      const mesure = await page.evaluate((src) => {
        const compter = (racine) => {
          const n = {}
          for (const el of racine.querySelectorAll('*')) n[el.localName] = (n[el.localName] ?? 0) + 1
          return n
        }
        const avant = compter(new DOMParser().parseFromString(src, 'text/html').body)
        const prepare = window.prepareChatHtml(src)
        const bloc = document.getElementById('bloc')
        bloc.setAttribute('data-html-scope', prepare.scopeId)
        bloc.innerHTML = prepare.html
        const apres = compter(bloc)
        const retirees = Object.entries(avant)
          .filter(([tag, n]) => (apres[tag] ?? 0) < n)
          .map(([tag, n]) => ({ balise: tag, avant: n, apres: apres[tag] ?? 0 }))
        return {
          largeurBloc: bloc.clientWidth,
          largeurContenu: bloc.scrollWidth,
          retirees,
          onglets: [...bloc.querySelectorAll('label[for]')].filter((l) =>
            bloc.querySelector(`input[type="radio"][id="${l.getAttribute('for')}"]`)
          ).length
        }
      }, source)

      const ligne = { largeur, debordementPx: Math.max(0, mesure.largeurContenu - mesure.largeurBloc), ...mesure, paires: [] }
      const bloc = await page.$('#bloc')
      const images = []
      const capturer = async (nom) => {
        const chemin = join(out, `${nom}.png`)
        images.push((await bloc.screenshot({ path: chemin })).toString('base64'))
        rapport.captures.push(chemin)
      }
      if (mesure.onglets > 1) {
        const libelles = await page.$$('#bloc label[for]')
        for (let i = 0; i < libelles.length; i++) {
          await libelles[i].click()
          await page.waitForTimeout(120)
          await capturer(`l${largeur}-onglet-${i + 1}`)
        }
        // Part des pixels qui changent entre deux onglets, sur la zone commune des deux captures.
        ligne.paires = await page.evaluate(async (b64) => {
          const charger = (s) => new Promise((ok) => { const im = new Image(); im.onload = () => ok(im); im.src = `data:image/png;base64,${s}` })
          const ims = await Promise.all(b64.map(charger))
          const pixels = ims.map((im) => {
            const c = document.createElement('canvas'); c.width = im.width; c.height = im.height
            const x = c.getContext('2d'); x.drawImage(im, 0, 0)
            return { w: im.width, h: im.height, d: x.getImageData(0, 0, im.width, im.height).data }
          })
          const paires = []
          for (let i = 0; i < pixels.length; i++)
            for (let j = i + 1; j < pixels.length; j++) {
              const a = pixels[i], b = pixels[j]
              const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h)
              let diff = 0
              for (let y = 0; y < h; y++)
                for (let x = 0; x < w; x++) {
                  const p = (y * a.w + x) * 4, q = (y * b.w + x) * 4
                  if (Math.abs(a.d[p] - b.d[q]) + Math.abs(a.d[p + 1] - b.d[q + 1]) + Math.abs(a.d[p + 2] - b.d[q + 2]) > 48) diff++
                }
              const total = Math.max(a.w * a.h, b.w * b.h)
              paires.push({ onglets: [i + 1, j + 1], partChangee: Number(((diff + total - w * h) / total).toFixed(4)) })
            }
          return paires
        }, images)
      } else await capturer(`l${largeur}`)

      if (ligne.debordementPx > 0)
        rapport.defauts.push({ code: 3, largeur, defaut: `deborde de ${ligne.debordementPx} px : contenu ${mesure.largeurContenu} px dans une colonne de ${mesure.largeurBloc} px` })
      const proches = ligne.paires.filter((p) => p.partChangee < seuil)
      if (proches.length)
        rapport.defauts.push({ code: 5, largeur, defaut: `${proches.length} paire(s) d'onglets changent moins de ${seuil * 100} % des pixels visibles`, paires: proches })
      rapport.largeurs.push(ligne)
      await page.close()
    }
  } finally {
    await browser.close()
  }

  const retirees = rapport.largeurs[0]?.retirees ?? []
  if (retirees.length)
    rapport.defauts.push({ code: 4, defaut: `balises retirees par le filtre du chat : ${retirees.map((r) => `${r.balise} (${r.avant} -> ${r.apres})`).join(', ')}` })

  rapport.defauts.sort((a, b) => a.code - b.code)
  rapport.ok = rapport.defauts.length === 0
  rapport.preuve = rapport.ok
    ? `rendu du chat tenu a ${largeurs.join(' et ')} px, rien de retire, onglets distincts`
    : rapport.defauts.map((d) => d.defaut).join(' | ')
  sortir(rapport.ok ? 0 : rapport.defauts[0].code, rapport)
}

main().catch((erreur) => sortir(1, { ok: false, erreur: String(erreur?.stack ?? erreur) }))
