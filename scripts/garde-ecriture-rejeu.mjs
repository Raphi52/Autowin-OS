/**
 * REJEU DE LA GARDE D'ÉCRITURE SUR LE VRAI DISQUE : fait passer des appels d'outil par le vrai script
 * `garde-ecriture-hors-copie.mjs`, lancé comme les CLI le lancent (JSON sur l'entrée), et dit pour
 * chacun refus ou passage, face à l'attendu. Rien n'est exécuté : la garde ne fait que lire l'appel.
 *
 * POURQUOI UN FICHIER DE CAS : écrit à la main dans un heredoc du shell, le banc perdait ses antislashs
 * (`D:\AutoWinOS` devenu `D:AutoWinOS`) et tout passait, pour une mauvaise raison. Un JSON posé par
 * l'outil Write garde les chemins tels quels.
 *
 * Usage : node scripts/garde-ecriture-rejeu.mjs <cas.json>
 *   cas.json : [{ "attendu": "refus" | "passe", "nom": "…", "entree": { "tool_name", "tool_input", "cwd" } }]
 * Code 0 si tout est comme attendu, 1 sinon, 2 si le fichier de cas est illisible.
 */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const GARDE = fileURLToPath(new URL('./garde-ecriture-hors-copie.mjs', import.meta.url))

/** Chaque cas passé par la garde : `obtenu` (refus ou passe), `motif` du refus, `conforme` à l'attendu. */
export function rejouer(cas, garde = GARDE) {
  return cas.map(({ attendu, nom, entree }) => {
    const r = spawnSync(process.execPath, [garde], {
      input: JSON.stringify(entree),
      encoding: 'utf8',
      timeout: 30_000,
      windowsHide: true
    })
    const sortie = (r.stdout ?? '').trim()
    let motif = ''
    if (sortie) {
      try {
        const s = JSON.parse(sortie)
        motif = s.hookSpecificOutput?.permissionDecisionReason ?? s.reason ?? sortie
      } catch {
        motif = sortie
      }
    }
    const obtenu = sortie ? 'refus' : 'passe'
    return { nom, attendu, obtenu, motif, conforme: obtenu === attendu }
  })
}

function principal(fichier) {
  let cas
  try {
    cas = JSON.parse(readFileSync(fichier, 'utf8').replace(/^\uFEFF/, ''))
    if (!Array.isArray(cas)) throw new Error('un tableau de cas est attendu')
  } catch (e) {
    console.error(`Fichier de cas illisible (${fichier}) : ${e.message}`)
    return 2
  }
  const resultats = rejouer(cas)
  for (const r of resultats) {
    const motif = r.motif ? ` — ${r.motif.slice(0, 160)}` : ''
    console.log(`${r.conforme ? 'OK' : 'KO'}  ${r.obtenu.padEnd(5)}  ${r.nom}${motif}`)
  }
  const conformes = resultats.filter((r) => r.conforme).length
  console.log(`${conformes}/${resultats.length} comme attendu`)
  return conformes === resultats.length ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.argv[2]) {
    console.error('Usage : node scripts/garde-ecriture-rejeu.mjs <cas.json>')
    process.exit(2)
  }
  process.exit(principal(process.argv[2]))
}
