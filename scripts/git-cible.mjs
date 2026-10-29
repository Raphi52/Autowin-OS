#!/usr/bin/env node
/**
 * CIBLE DE PUBLICATION du /git — où pousser, et comment (push direct ou demande de fusion).
 *
 * Usage :
 *   node scripts/git-cible.mjs [--dossier <dépôt>] [--habitudes <fichier.json>]
 *   node scripts/git-cible.mjs --retenir push|pr [--branche main] [--distant origin] [--note "…"]
 * Sortie : un JSON sur stdout. Exit 0 = cible rendue · Exit 2 = pas un dépôt git, ou usage faux.
 *
 * Pourquoi (conv-1250, 2026-10-29) : l'utilisateur tapait à chaque fois la cible à la main —
 * « /salvage push main origin », « /salvage all origin main », « /salvage commit push tout sur
 * main/origin » (conv-896, conv-997, conv-1091, conv-1108…). La cible se DÉDUIT : une habitude
 * retenue pour ce dépôt d'abord, sinon le garde-fou de push du dépôt, sinon ses auteurs (seul
 * auteur = dépôt perso, push direct ; plusieurs = dépôt d'équipe, demande de fusion).
 *
 * Les habitudes vivent sur le POSTE, hors git : `.autowin-data/autowin-os/git-habitudes.json`,
 * indexées par l'adresse du distant (normalisée), pour valoir quel que soit le dossier du clone.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ICI = dirname(fileURLToPath(import.meta.url))
export const FICHIER_HABITUDES_PAR_DEFAUT = join(
  ICI,
  '..',
  '.autowin-data',
  'autowin-os',
  'git-habitudes.json'
)
/** Assez d'historique pour voir les autres contributeurs d'un dépôt d'équipe, assez peu pour rester instantané. */
const COMMITS_LUS = 200

function lanceur(cwd) {
  return (...args) => {
    try {
      return execFileSync('git', args, {
        cwd,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      }).trim()
    } catch {
      return null
    }
  }
}

/**
 * Une même adresse s'écrit de plusieurs façons (https avec identifiant, ssh, `.git` final) :
 * la clé garde l'hôte et le chemin, en minuscules, pour qu'une habitude retenue sur un clone
 * vaille sur tous les autres.
 */
export function cleDepot(url) {
  if (!url) return null
  let u = url.trim()
  const ssh = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(u)
  if (ssh) u = `${ssh[1]}/${ssh[2]}`
  u = u
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/\/+$/, '')
    .replace(/\.git$/i, '')
  // Azure DevOps en ssh : ssh.dev.azure.com/v3/org/projet/depot → dev.azure.com/org/projet/_git/depot
  const azSsh = /^ssh\.dev\.azure\.com\/v3\/([^/]+)\/([^/]+)\/([^/]+)$/i.exec(u)
  if (azSsh) u = `dev.azure.com/${azSsh[1]}/${azSsh[2]}/_git/${azSsh[3]}`
  return u.toLowerCase()
}

export function hebergeurDe(url) {
  const cle = cleDepot(url) ?? ''
  if (cle.startsWith('github.com/'))
    return { hebergeur: 'github', outilDemandeDeFusion: 'gh pr create' }
  if (/(^|\.)dev\.azure\.com\/|\.visualstudio\.com\//.test(cle))
    return { hebergeur: 'azure-devops', outilDemandeDeFusion: 'az repos pr create' }
  return { hebergeur: cle ? 'autre' : null, outilDemandeDeFusion: null }
}

export function lireHabitudes(fichier = FICHIER_HABITUDES_PAR_DEFAUT) {
  try {
    const brut = JSON.parse(readFileSync(fichier, 'utf8'))
    return brut && typeof brut === 'object' && !Array.isArray(brut) ? brut : {}
  } catch {
    return {}
  }
}

export function retenirHabitude({
  fichier = FICHIER_HABITUDES_PAR_DEFAUT,
  url,
  mode,
  branche,
  distant,
  note
}) {
  const cle = cleDepot(url)
  if (!cle) throw new Error('aucune adresse de distant : rien à retenir')
  if (mode !== 'push' && mode !== 'pr') throw new Error(`mode inconnu « ${mode} » : push ou pr`)
  const habitudes = lireHabitudes(fichier)
  habitudes[cle] = {
    mode,
    ...(branche ? { branche } : {}),
    ...(distant ? { distant } : {}),
    ...(note ? { note } : {}),
    le: new Date().toISOString().slice(0, 10)
  }
  mkdirSync(dirname(fichier), { recursive: true })
  writeFileSync(fichier, `${JSON.stringify(habitudes, null, 2)}\n`)
  return { cle, ...habitudes[cle] }
}

function distants(git) {
  const noms = (git('remote') ?? '').split(/\r?\n/).filter(Boolean)
  return noms.map((nom) => ({ nom, url: git('remote', 'get-url', nom) }))
}

function choisirDistant(git, liste, habitudes) {
  for (const d of liste) {
    const h = habitudes[cleDepot(d.url)]
    if (h) {
      const nomVoulu = h.distant && liste.some((x) => x.nom === h.distant) ? h.distant : d.nom
      return { distant: liste.find((x) => x.nom === nomVoulu), habitude: h }
    }
  }
  const amont = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}')
  const nomAmont = amont?.split('/')[0]
  const parAmont = liste.find((d) => d.nom === nomAmont)
  if (parAmont) return { distant: parAmont }
  const origin = liste.find((d) => d.nom === 'origin')
  if (origin) return { distant: origin }
  if (liste.length === 1) return { distant: liste[0] }
  return { distant: null }
}

function brancheDIntegration(git, distant, habitude) {
  if (habitude?.branche) return habitude.branche
  const tete = git('symbolic-ref', '--short', `refs/remotes/${distant}/HEAD`)
  if (tete?.startsWith(`${distant}/`)) return tete.slice(distant.length + 1)
  for (const b of ['main', 'master']) {
    if (git('rev-parse', '--verify', '--quiet', `refs/remotes/${distant}/${b}`)) return b
  }
  for (const b of ['main', 'master']) {
    if (git('rev-parse', '--verify', '--quiet', `refs/heads/${b}`)) return b
  }
  return git('branch', '--show-current') || 'main'
}

/** Le garde-fou du dépôt nomme-t-il lui-même son exception de push direct ? (ex. `.githooks/pre-push`) */
function exceptionDuGardeFou(git, racine) {
  const chemin = git('config', 'core.hooksPath')
  const dossier = chemin
    ? isAbsolute(chemin)
      ? chemin
      : join(racine, chemin)
    : join(git('rev-parse', '--git-common-dir') ?? join(racine, '.git'), 'hooks')
  const hook = join(isAbsolute(dossier) ? dossier : resolve(racine, dossier), 'pre-push')
  if (!existsSync(hook)) return null
  const texte = readFileSync(hook, 'utf8')
  const variable =
    /\b(ALLOW_[A-Z_]*PUSH[A-Z_]*)=1\b/.exec(texte)?.[1] ??
    (/\bALLOW_MAIN_PUSH\b/.test(texte) ? 'ALLOW_MAIN_PUSH' : null)
  return variable ? `${variable}=1` : null
}

/**
 * Une même personne signe sous plusieurs formes : « Jeanne DURAND », « Jeanne Durand »,
 * « jeanne.durand@… ». Mesuré le 2026-10-29 sur un dépôt perso : 3 adresses différentes pour le
 * même auteur, et AUCUNE identité git configurée sur le poste — d'où le repli sur le nom de session.
 */
export function normaliserIdentite(texte) {
  return (texte ?? '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/@.*$/, '')
    .replace(/[._-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function mesIdentites(git) {
  return [
    git('config', 'user.name'),
    git('config', 'user.email'),
    process.env.USERNAME,
    process.env.USER
  ]
    .map(normaliserIdentite)
    .filter(Boolean)
}

/** Au-delà de cette part des derniers commits, le dépôt est le tien : quelques commits de passage n'en font pas un dépôt d'équipe. */
const PART_DEPOT_PERSO = 0.8

function partDeMesCommits(git, ref, identites) {
  const moi = new Set(identites)
  const lignes = (git('log', `-${COMMITS_LUS}`, '--format=%ae%x09%an', ref) ?? '')
    .split(/\r?\n/)
    .filter(Boolean)
  const autres = new Set()
  let miens = 0
  let comptes = 0
  for (const l of lignes) {
    const [email = '', nom = ''] = l.split('\t')
    if (/\[bot\]/i.test(nom) || /\[bot\]/i.test(email)) continue
    comptes += 1
    if (moi.has(normaliserIdentite(email)) || moi.has(normaliserIdentite(nom))) miens += 1
    else autres.add(normaliserIdentite(nom) || normaliserIdentite(email))
  }
  return { autres: [...autres], miens, comptes, part: comptes ? miens / comptes : 1 }
}

export function deduireCible({ cwd = process.cwd(), habitudes = lireHabitudes(), identites } = {}) {
  const git = lanceur(cwd)
  const racine = git('rev-parse', '--show-toplevel')
  if (!racine) return { erreur: `pas un dépôt git : ${cwd}` }
  const liste = distants(git)
  const brancheCourante = git('branch', '--show-current') || null
  if (!liste.length) {
    return {
      depot: racine,
      distant: null,
      url: null,
      branche: brancheCourante ?? 'main',
      brancheCourante,
      mode: 'local',
      exceptionPush: null,
      source: 'aucun-distant',
      raison: 'aucun distant : on commite et on range, rien ne peut partir',
      hebergeur: null,
      outilDemandeDeFusion: null
    }
  }
  const { distant, habitude } = choisirDistant(git, liste, habitudes)
  if (!distant) {
    return {
      depot: racine,
      distant: null,
      distantsPossibles: liste.map((d) => d.nom),
      mode: 'a-preciser',
      source: 'plusieurs-distants',
      raison: `plusieurs distants sans « origin » (${liste.map((d) => d.nom).join(', ')}) : un seul choix à demander`
    }
  }
  const branche = brancheDIntegration(git, distant.nom, habitude)
  const exceptionPush = exceptionDuGardeFou(git, racine)
  const commun = {
    depot: racine,
    distant: distant.nom,
    url: distant.url,
    cle: cleDepot(distant.url),
    branche,
    brancheCourante,
    exceptionPush,
    ...hebergeurDe(distant.url)
  }
  if (habitude) {
    return {
      ...commun,
      mode: habitude.mode,
      source: 'habitude',
      raison: `habitude retenue le ${habitude.le ?? '?'}${habitude.note ? ` : ${habitude.note}` : ''}`
    }
  }
  if (exceptionPush) {
    return {
      ...commun,
      mode: 'push',
      source: 'garde-fou',
      raison: `le pre-push du dépôt nomme lui-même l'exception ${exceptionPush} pour pousser sur ${branche}`
    }
  }
  const refDistante = git(
    'rev-parse',
    '--verify',
    '--quiet',
    `refs/remotes/${distant.nom}/${branche}`
  )
    ? `${distant.nom}/${branche}`
    : 'HEAD'
  const { autres, miens, comptes, part } = partDeMesCommits(
    git,
    refDistante,
    identites ?? mesIdentites(git)
  )
  const pourcent = Math.round(part * 100)
  if (part >= PART_DEPOT_PERSO) {
    return {
      ...commun,
      mode: 'push',
      source: 'auteurs',
      autresAuteurs: autres.length,
      raison: `tu as écrit ${miens} des ${comptes} derniers commits de ${refDistante} (${pourcent} %) : dépôt perso, push direct`
    }
  }
  return {
    ...commun,
    mode: 'pr',
    source: 'auteurs',
    autresAuteurs: autres.length,
    raison: `${miens} commits sur ${comptes} sont de toi (${pourcent} %), ${autres.length} autre(s) auteur(s) sur ${refDistante} : dépôt d'équipe, demande de fusion`
  }
}

function lireOption(args, nom) {
  const i = args.indexOf(nom)
  return i >= 0 ? args[i + 1] : undefined
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2)
  const cwd = resolve(lireOption(args, '--dossier') ?? process.cwd())
  const fichier =
    lireOption(args, '--habitudes') ??
    process.env.AUTOWIN_GIT_HABITUDES ??
    FICHIER_HABITUDES_PAR_DEFAUT
  const cible = deduireCible({ cwd, habitudes: lireHabitudes(fichier) })
  if (cible.erreur) {
    console.error(cible.erreur)
    process.exit(2)
  }
  const aRetenir = lireOption(args, '--retenir')
  if (aRetenir) {
    try {
      const retenu = retenirHabitude({
        fichier,
        url: cible.url,
        mode: aRetenir,
        branche: lireOption(args, '--branche'),
        distant: lireOption(args, '--distant') ?? cible.distant,
        note: lireOption(args, '--note')
      })
      console.log(JSON.stringify({ retenu, fichier }, null, 2))
    } catch (e) {
      console.error(String(e.message ?? e))
      process.exit(2)
    }
  } else {
    console.log(JSON.stringify(cible, null, 2))
  }
}
