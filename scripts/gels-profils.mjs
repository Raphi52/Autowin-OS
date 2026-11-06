/**
 * PROFILS DES GELS LONGS — ce qui nomme la fonction des gels « inconnu » dans le classement
 * (scripts/gels-classement.mjs).
 *
 * Le détecteur écrit, pour tout gel de plus de 10 s, un profil CPU du processus principal et des
 * relevés de sa pile JavaScript dans `gels-profils/` à côté de `gels.jsonl`
 * (src/main/gel/profil-pendant-gel.ts). Ce module rapproche chaque gel de son profil par l'heure, puis
 * en tire la pile de NOTRE code qui tenait la fenêtre.
 *
 * DEUX SOURCES, et pas la même confiance pour le nom :
 *   - les RELEVÉS DE PILE nomment la fonction quel que soit son niveau de compilation ;
 *   - le PROFIL, démarré pendant le gel, laisse sans nom ni ligne une boucle compilée à la volée
 *     avant lui (mesuré le 2026-11-06). Ses frames sans ligne sont donc sautées : la pile retombe
 *     sur l'appelant, qui, lui, est nommé. Il garde ce que la pile ne voit pas : le temps propre des
 *     fonctions natives et du ramasse-miettes.
 * Une capture prise à la main (inspecteur ouvert avant le gel) n'a pas de relevés : le profil seul
 * sert alors, et il nomme tout, puisqu'il a vu la boucle se compiler.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** Frames de NOTRE code, sous la forme condensée du journal (`main/index.js:L:C`). */
const NOTRE_CODE = /^(main|chunks)\/[^/:]+\.js:\d+:\d+$/

/** Profondeur de la pile applicative gardée pour regrouper les relevés : assez pour situer. */
const PROFONDEUR = 4

/** Lit l'index des profils ; une ligne illisible ou incomplète est ignorée, jamais devinée. */
export function lireProfils(dossier) {
  const index = join(dossier, 'index.jsonl')
  if (!existsSync(index)) return []
  const profils = []
  for (const ligne of readFileSync(index, 'utf8').split(/\r?\n/)) {
    if (!ligne.trim()) continue
    try {
      const entree = JSON.parse(ligne)
      const debutMs = Date.parse(entree.debut)
      const finMs = Date.parse(entree.fin)
      if (Number.isFinite(debutMs) && Number.isFinite(finMs) && entree.fichier) {
        profils.push({ ...entree, debutMs, finMs, dossier })
      }
    } catch {
      /* ligne abîmée : un profil de moins, pas un faux rapprochement */
    }
  }
  return profils
}

/**
 * Le profil qui couvre le mieux un gel (fenêtre `[ts - blocageMs, ts]`). Il doit en couvrir au moins
 * un tiers : un profil qui n'en voit que la queue nommerait ce qui a suivi le gel.
 */
export function profilDuGel(gel, profils) {
  const finMs = Date.parse(gel?.ts ?? '')
  const dureeMs = Number(gel?.blocageMs)
  if (!Number.isFinite(finMs) || !(dureeMs > 0)) return undefined
  const debutMs = finMs - dureeMs
  let meilleur
  let meilleurRecouvrement = 0
  for (const profil of profils) {
    const recouvrement = Math.min(profil.finMs, finMs) - Math.max(profil.debutMs, debutMs)
    if (recouvrement > meilleurRecouvrement) {
      meilleur = profil
      meilleurRecouvrement = recouvrement
    }
  }
  return meilleur && meilleurRecouvrement >= dureeMs / 3 ? meilleur : undefined
}

/**
 * Condense un emplacement (chemin Windows, URL `file://`) en `main/index.js:L:C` quand il est dans
 * le bundle du processus principal ; sinon le rend tel quel, raccourci.
 */
export function condenser(fichier, ligne, colonne) {
  const chemin = String(fichier ?? '').replace(/\\/g, '/')
  const m = /\/out\/main\/(chunks\/)?([^/]+\.js)$/.exec(chemin)
  const lieu = m ? `${m[1] ? 'chunks' : 'main'}/${m[2]}` : chemin.replace(/^file:\/\/\//, '')
  return `${lieu}:${ligne}:${colonne}`
}

/** `fonction emplacement:L:C` (relevé de pile) → `{ fonction, frame }`. */
function lireFrameDeReleve(texte) {
  const m = /^(.*) (\S+):(\d+):(\d+)$/.exec(String(texte))
  if (!m) return undefined
  return { fonction: m[1], frame: condenser(m[2], m[3], m[4]) }
}

function compter(table, cle, valeur) {
  const entree = table.get(cle) ?? { ...valeur, n: 0 }
  entree.n += 1
  table.set(cle, entree)
}

/** Frames de notre code d'une pile, de la plus HAUTE (appelant de départ) à la plus profonde. */
function chaineApplicative(frames) {
  return frames.filter((f) => NOTRE_CODE.test(f.frame)).reverse()
}

/**
 * La fonction qui TIENT la fenêtre : la plus profonde présente dans PLUS de la moitié des piles.
 *
 * Grouper par pile entière diluait le coupable entre ses propres sous-appels : sur le gel de 27,6 s
 * du 2026-11-06, la boucle qui gelait portait 99 % des échantillons, mais sa pile exacte n'en
 * portait que 62 % (le reste tombait dans les petites fonctions qu'elle appelle). On descend donc
 * l'arbre des appels depuis le haut, tant que le chemin le plus fréquent garde la majorité.
 */
function quiTientLaFenetre(chaines, total) {
  if (!total) return undefined
  const racine = { enfants: new Map() }
  for (const chaine of chaines) {
    let noeud = racine
    for (const f of chaine) {
      let enfant = noeud.enfants.get(f.frame)
      if (!enfant) noeud.enfants.set(f.frame, (enfant = { ...f, n: 0, enfants: new Map() }))
      enfant.n += 1
      noeud = enfant
    }
  }
  const chemin = []
  let noeud = racine
  for (;;) {
    const [suivant] = [...noeud.enfants.values()].sort((a, b) => b.n - a.n)
    // Majorité STRICTE : à égalité entre deux sous-appels, aucun des deux ne tient la fenêtre.
    if (!suivant || (chemin.length && suivant.n * 2 <= total)) break
    chemin.push(suivant)
    noeud = suivant
  }
  if (!chemin.length) return undefined
  const coupable = chemin[chemin.length - 1]
  return {
    fonction: coupable.fonction,
    appelant: chemin
      .slice(-PROFONDEUR)
      .reverse()
      .map((f) => f.frame)
      .join(' < '),
    n: coupable.n,
    part: coupable.n / total
  }
}

function analyserReleves(releves) {
  const chaines = releves.map((releve) =>
    chaineApplicative((releve.frames ?? []).map(lireFrameDeReleve).filter(Boolean))
  )
  return quiTientLaFenetre(chaines, releves.length)
}

/** Les échantillons du profil tombés dans le gel, avec le temps propre et la pile applicative. */
function analyserProfil(profil, entree, gelDebutMs, gelFinMs) {
  const parId = new Map(profil.nodes.map((n) => [n.id, n]))
  const parent = new Map()
  for (const n of profil.nodes) for (const enfant of n.children ?? []) parent.set(enfant, n.id)
  const propre = new Map()
  const chaines = []
  let echantillons = 0
  let ramasseMiettes = 0
  let t = profil.startTime
  for (let i = 0; i < profil.samples.length; i++) {
    t += profil.timeDeltas[i] ?? 0
    const murMs = entree.debutMs + (t - profil.startTime) / 1000
    if (murMs < gelDebutMs || murMs > gelFinMs) continue
    echantillons += 1
    const feuille = parId.get(profil.samples[i])
    if (!feuille) continue
    const cf = feuille.callFrame
    if (cf.functionName === '(garbage collector)') ramasseMiettes += 1
    const nom = cf.functionName || '(sans nom)'
    const lieu =
      cf.url && cf.lineNumber >= 0
        ? ` ${condenser(cf.url, cf.lineNumber + 1, cf.columnNumber + 1)}`
        : ''
    compter(propre, `${nom}${lieu}`, { fonction: `${nom}${lieu}` })
    // Frames sans ligne sautées : la boucle compilée avant le profileur n'a ni nom ni position.
    const frames = []
    for (let id = feuille.id; id !== undefined; id = parent.get(id)) {
      const c = parId.get(id).callFrame
      if (c.url && c.lineNumber >= 0) {
        frames.push({
          fonction: c.functionName || '(anonyme)',
          frame: condenser(c.url, c.lineNumber + 1, c.columnNumber + 1)
        })
      }
    }
    chaines.push(chaineApplicative(frames))
  }
  const tete = [...propre.values()]
    .sort((a, b) => b.n - a.n)
    .slice(0, 3)
    .map((e) => ({ fonction: e.fonction, part: echantillons ? e.n / echantillons : 0 }))
  return {
    echantillons,
    ramasseMiettes: echantillons ? ramasseMiettes / echantillons : 0,
    tete,
    pile: quiTientLaFenetre(chaines, echantillons)
  }
}

/**
 * Nomme un gel par son profil : `{ fonction, appelant, part, source, releves, profil }`, ou
 * `undefined` si aucun profil ne le couvre. `appelant` a la forme du champ du journal, prête pour
 * `resoudreAppelant`. `source` dit d'où vient le nom : `piles` ou `profil`.
 */
export function analyserGel(
  gel,
  entree,
  lire = (chemin) => JSON.parse(readFileSync(chemin, 'utf8'))
) {
  const gelFinMs = Date.parse(gel.ts)
  const gelDebutMs = gelFinMs - Number(gel.blocageMs)
  let profil
  try {
    profil = analyserProfil(
      lire(join(entree.dossier, entree.fichier)),
      entree,
      gelDebutMs,
      gelFinMs
    )
  } catch {
    profil = undefined
  }
  let releves
  if (entree.piles) {
    try {
      const piles = (lire(join(entree.dossier, entree.piles)).piles ?? []).filter((p) => {
        const a = Date.parse(p.a)
        return !Number.isFinite(a) || (a >= gelDebutMs && a <= gelFinMs + 1000)
      })
      releves = { nombre: piles.length, pile: analyserReleves(piles) }
    } catch {
      releves = undefined
    }
  }
  const pile = releves?.pile ?? profil?.pile
  if (!pile && !profil) return undefined
  return {
    fonction: pile?.fonction,
    appelant: pile?.appelant,
    part: pile?.part,
    source: releves?.pile ? 'piles' : 'profil',
    releves: releves?.nombre ?? 0,
    profil,
    fichier: entree.fichier
  }
}

/** Les gels de fenêtre d'au moins `seuilMs` nommés par un profil, dans l'ordre du journal. */
export function nommerGelsParProfil(gels, profils, { depuisMs, seuilMs = 10_000, lire } = {}) {
  if (!profils.length) return []
  const nommes = []
  for (const gel of gels) {
    if (!(Number(gel?.blocageMs) >= seuilMs)) continue
    const op = typeof gel.operation === 'string' ? gel.operation : ''
    if (op.startsWith('io:') || op.startsWith('renderer:')) continue
    if (Number.isFinite(depuisMs) && Date.parse(gel.ts) < depuisMs) continue
    const entree = profilDuGel(gel, profils)
    if (!entree) continue
    const analyse = analyserGel(gel, entree, lire)
    if (analyse) nommes.push({ gel, analyse })
  }
  return nommes
}
