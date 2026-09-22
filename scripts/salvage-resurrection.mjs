#!/usr/bin/env node
/**
 * GARDE ANTI-RÉSURRECTION du /salvage — à lancer AVANT tout cherry-pick ou apply d'un candidat.
 *
 * Usage : node scripts/salvage-resurrection.mjs <sha-candidat> [--base main] [--jours 60]
 * Exit 0 = rien à craindre · Exit 1 = le candidat remet ce que la base a ANNULÉ (revert) ou
 * SUPPRIMÉ · Exit 2 = usage ou git en échec · Exit 3 = à RELIRE : il modifie des fichiers
 * qu'une annulation récente a touchés (signal faible, décision motivée exigée).
 *
 * Pourquoi : le 2026-09-19, un /salvage (conv-719) a reporté sur main la copie préservée
 * a93c3b61 (devenue 6b3ab4ae). Elle était partie APRÈS le revert e4413ce3 qui retirait les
 * onglets, mais l'agent de ce run les y avait réécrits : 38 lignes annulées revenaient, et les
 * onglets ont réapparu. `git cherry` ne voit pas ce cas — le patch est bien « nouveau » — seule
 * la confrontation avec les annulations récentes de la base le révèle.
 */
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

/** Une ligne de moins de 20 caractères (accolade, import court) revient par hasard : on l'ignore. */
const LONGUEUR_MIN = 20
/** Au-delà de 10 lignes significatives revenues, ce n'est plus une coïncidence. */
const SEUIL_LIGNES = 10
const SEP_CHAMP = String.fromCharCode(0x1f)
const SEP_COMMIT = String.fromCharCode(0x1e)

const estAnnulation = (sujet, corps) => /^Revert\b/i.test(sujet) || /This reverts commit/i.test(corps)

function commits(git, ...range) {
  return git('log', '--format=%H%x1f%s%x1f%b%x1e', ...range)
    .split(SEP_COMMIT)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => {
      const [sha, sujet = '', corps = ''] = b.split(SEP_CHAMP)
      return { sha, sujet, corps }
    })
}

function lignes(texte, signe) {
  return new Set(
    texte
      .split('\n')
      .filter((l) => l.startsWith(signe) && !l.startsWith(signe.repeat(3)))
      .map((l) => l.slice(1).trim())
      .filter((l) => l.length >= LONGUEUR_MIN)
  )
}

function existeDansLaBase(git, base, ligne) {
  try {
    git('grep', '-q', '-F', '-e', ligne, base, '--')
    return true
  } catch {
    return false // git grep rend 1 quand il ne trouve rien
  }
}

export function detecterResurrection({ candidat, base = 'main', cwd = process.cwd(), jours = 60 }) {
  const git = (...a) =>
    execFileSync('git', a, { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }).trim()
  const fourche = git('merge-base', base, candidat)
  const touches = new Set(git('diff', '--name-only', `${fourche}..${candidat}`).split('\n').filter(Boolean))
  const alertes = []
  const relire = []

  // 1. Annulations arrivées sur la base APRÈS la fourche, sur des fichiers que touche le candidat.
  for (const c of commits(git, `${fourche}..${base}`)) {
    if (!estAnnulation(c.sujet, c.corps)) continue
    const communs = git('show', '--name-only', '--format=', c.sha)
      .split('\n')
      .filter((f) => f && touches.has(f))
    if (communs.length) alertes.push({ raison: 'revert', commit: c.sha, sujet: c.sujet, fichiers: communs })
  }

  // 2. Fichiers supprimés sur la base depuis la fourche, que le candidat touche encore.
  const supprimes = git('diff', '--name-only', '--diff-filter=D', `${fourche}..${base}`)
    .split('\n')
    .filter((f) => f && touches.has(f))
  if (supprimes.length) alertes.push({ raison: 'suppression', fichiers: supprimes })

  // 3. Le CONTENU : le candidat ré-ajoute-t-il des lignes qu'une annulation RÉCENTE a retirées,
  // même AVANT la fourche ? C'est le cas réel du 2026-09-19 (onglets réécrits après le revert).
  const ajoutees = lignes(git('diff', `${fourche}..${candidat}`), '+')
  const deja = new Set(alertes.map((a) => a.commit))
  for (const c of commits(git, `--since=${jours}.days`, base)) {
    if (deja.has(c.sha) || !estAnnulation(c.sujet, c.corps)) continue
    // Une ligne encore présente AILLEURS dans la base (import, `await act(...)`) n'a pas disparu :
    // la retrouver ne prouve rien. Seules comptent les lignes que l'annulation a fait DISPARAÎTRE.
    const revenues = [...lignes(git('show', '--format=', c.sha), '-')]
      .filter((l) => ajoutees.has(l))
      .filter((l) => !existeDansLaBase(git, base, l))
    if (revenues.length >= SEUIL_LIGNES) {
      alertes.push({
        raison: 'contenu-annule',
        commit: c.sha,
        sujet: c.sujet,
        lignes: revenues.length,
        exemple: revenues.slice(0, 3)
      })
      continue
    }
    // 4. Signal FAIBLE, mais le seul qui attrape le 2026-09-19 : l'agent avait réécrit les onglets
    // AUTREMENT (autres noms, autre code), donc aucune ligne ne revenait à l'identique. Ce qui
    // restait, c'est qu'il modifiait App.tsx, window.ts, app-shell.css… tous touchés par
    // l'annulation e4413ce3 deux jours plus tôt. Trop fréquent pour bloquer (≈ 1 commit sur 3 en
    // septembre 2026) : on exige seulement une RELECTURE motivée.
    const communs = git('show', '--name-only', '--format=', c.sha)
      .split('\n')
      .filter((f) => f && touches.has(f))
    if (communs.length) relire.push({ commit: c.sha, sujet: c.sujet, fichiers: communs })
  }

  return { candidat, base, fourche, alertes, relire }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2)
  const opt = (nom, defaut) => (args.includes(nom) ? args[args.indexOf(nom) + 1] : defaut)
  const valeurs = new Set(['--base', '--jours'].filter((n) => args.includes(n)).map((n) => args.indexOf(n) + 1))
  const candidat = args.find((a, k) => !a.startsWith('--') && !valeurs.has(k))
  if (!candidat) {
    console.error('usage : node scripts/salvage-resurrection.mjs <sha-candidat> [--base main] [--jours 60]')
    process.exit(2)
  }
  let r
  try {
    r = detecterResurrection({ candidat, base: opt('--base', 'main'), jours: Number(opt('--jours', 60)) })
  } catch (e) {
    console.error(`git a échoué : ${e.message}`)
    process.exit(2)
  }
  console.log(JSON.stringify(r, null, 2))
  if (r.alertes.length) {
    console.error(
      `\nSTOP : ce candidat réintroduirait ce que ${r.base} a annulé ou supprimé. Ne reporte pas le ` +
        `commit entier : isole ses vraies modifications récentes (patch filtré, git apply --3way) ` +
        `et dis dans ta réponse ce que tu as écarté.`
    )
    process.exit(1)
  }
  if (r.relire.length) {
    console.error(
      `\nA RELIRE : ce candidat modifie des fichiers qu'une annulation récente de ${r.base} a touchés ` +
        `(${r.relire.map((x) => x.sujet).join(' ; ')}). Ouvre chaque annulation (git show <commit>), ` +
        `vérifie que le candidat ne remet pas ce qu'elle retirait, et écris ta décision dans ta réponse.`
    )
    process.exit(3)
  }
  console.error('\nOK : ce candidat ne remet rien de ce que la base a annulé ou supprimé.')
}
