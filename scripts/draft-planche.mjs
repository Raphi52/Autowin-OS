/**
 * PLANCHE DE RELECTURE d'un tour /draft : toutes les propositions empilées, en grand, dans chacun de
 * leurs états (thèmes compris), sur UNE page — pour relire les 6 maquettes d'un coup avant de poser le
 * carrousel. Le contrôle du carrousel (html-interactif-apercu.mjs) ne capture que la proposition
 * affichée, en petit : une maquette fausse ailleurs passe inaperçue.
 *
 * Pourquoi il existe (conv-2011, 2026-11-19) : la planche a été improvisée deux fois dans le même
 * fil, et c'est elle qui a montré que l'onglet ouvert d'une maquette gardait la couleur de la barre
 * (une règle CSS plus spécifique effaçait son fond) — défaut invisible dans le carrousel du tour 1.
 *
 * Usage : node scripts/draft-planche.mjs <propositions.json> [--etats repos,clair,violet]
 *           [--largeur 760] [--out <planche.html>] [--sans-apercu]
 *   - « repos » = la proposition sans classe d'état ; les autres posent `dk-etat-<état>` autour de
 *     la maquette, comme le carrousel. Par défaut : l'état de repos puis les `etats` de la 1ʳᵉ
 *     proposition ;
 *   - les `reglages` du JSON sont posés à leur `valeur` (une maquette qui lit `var(--x)` sans repli
 *     s'afficherait sinon sans elle) ;
 *   - sans `--sans-apercu`, la planche passe par html-interactif-apercu.mjs (même moteur que le fil)
 *     à la largeur demandée, et le chemin de la capture à LIRE est rendu dans le JSON.
 *   Le verdict de l'aperçu (débordement, fond opaque…) est rapporté dans `defauts` et `codeApercu`.
 * Codes : 0 = planche écrite (et capturée) ; 2 = usage ou JSON invalide ; 1 = aperçu en échec technique
 *   ou page vide.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const echapper = (t) => String(t ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

/** La page de relecture : une rangée par (état, proposition), libellée. */
export function planche(spec, etats) {
  const vars = (spec.reglages ?? [])
    // Un réglage de couleur ne porte que `couleur`, sans `valeur` (draft-reglages.mjs).
    .filter((r) => r.variable && (r.couleur !== undefined || r.valeur !== undefined))
    .map((r) => `${r.variable}:${r.couleur ? r.couleur : r.valeur + (r.unite ?? '')}`)
    .join(';')
  let html = `<style>body{margin:0;padding:10px;box-sizing:border-box;color:#aaa;font:12px system-ui,sans-serif}
.dkp-l{margin:14px 0 4px}.dkp-l b{color:#eee}.dkp{${vars}}${spec.css ?? ''}</style>`
  for (const etat of etats)
    spec.propositions.forEach((p, i) => {
      const classe = etat === 'repos' || etat === p.etatRepos ? '' : `dk-etat-${etat}`
      html += `<div class="dkp-l">${echapper(etat)} · <b>${i + 1} ${echapper(p.nom)}</b></div>`
      html += `<div class="dkp ${classe}"><style>${p.css ?? ''}</style>${p.html}</div>`
    })
  return html
}

function principal(args) {
  const fichier = args.find((a) => !a.startsWith('--'))
  const option = (nom) => {
    const i = args.indexOf(nom)
    return i >= 0 ? args[i + 1] : undefined
  }
  if (!fichier) {
    console.log('usage : node scripts/draft-planche.mjs <propositions.json> [--etats a,b] [--largeur 760] [--out x.html] [--sans-apercu]')
    return 2
  }
  let spec
  try {
    spec = JSON.parse(readFileSync(fichier, 'utf8'))
  } catch (e) {
    console.log(`JSON illisible : ${e.message}`)
    return 2
  }
  if (!Array.isArray(spec?.propositions) || !spec.propositions.length) {
    console.log('« propositions » absent ou vide')
    return 2
  }
  const premiere = spec.propositions[0]
  const etats = option('--etats')?.split(',').filter(Boolean) ?? [
    premiere.etatRepos ?? 'repos',
    ...(Array.isArray(premiere.etats) ? premiere.etats : [])
  ]
  const sortie = resolve(option('--out') ?? fichier.replace(/\.json$/i, '') + '-planche.html')
  writeFileSync(sortie, planche(spec, etats))
  const rendu = { ok: true, planche: sortie, etats, propositions: spec.propositions.length }
  if (!args.includes('--sans-apercu')) {
    const largeur = option('--largeur') ?? '760'
    const dossier = sortie.replace(/\.html$/i, '') + '-apercu'
    const apercu = join(dirname(fileURLToPath(import.meta.url)), 'html-interactif-apercu.mjs')
    // Le verdict de l'apercu est RAPPORTE, jamais tu : un debordement (5) ou un fond opaque (7)
    // de la planche se dit dans `defauts`, la capture reste a lire. Seul l'echec technique (1, 2)
    // ou une page vide (4) arretent : il n'y a alors rien a relire.
    let sortieApercu = ''
    let code = 0
    try {
      sortieApercu = execFileSync(process.execPath, [apercu, sortie, '--largeurs', largeur, '--attente', '500', '--out', dossier], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (e) {
      code = e.status ?? 1
      sortieApercu = String(e.stdout ?? '')
    }
    let verdict = {}
    try {
      verdict = JSON.parse(sortieApercu)
    } catch {}
    if ([1, 2, 4].includes(code)) {
      console.log(JSON.stringify({ ...rendu, ok: false, erreur: `apercu en code ${code}`, defauts: verdict.defauts ?? [], sortie: sortieApercu.slice(0, 800) }, null, 2))
      return 1
    }
    rendu.codeApercu = code
    rendu.defauts = verdict.defauts ?? []
    rendu.debordementPx = verdict.largeurs?.[0]?.debordementPx ?? null
    rendu.capture = join(dossier, `page-${largeur}.png`)
    rendu.suite = 'LIS la capture avant de poser le carrousel'
  }
  console.log(JSON.stringify(rendu, null, 2))
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = principal(process.argv.slice(2))
