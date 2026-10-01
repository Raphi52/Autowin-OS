#!/usr/bin/env node
/**
 * CE QUE LE BRIEFING `think` APPORTE, MESURE SANS AUCUN APPEL DE MODELE.
 *
 * `think` coute de l'argent a chaque run (lignes `phase: "think"` de `activity/*.jsonl`) sans
 * qu'aucun gain n'ait ete mesure. Le banc `/arena` a ete ecarte pour son cout (conv-892,
 * 2026-10-01). Ce script compare, sur les donnees DEJA ecrites par l'app :
 *   - les fichiers cites dans la section `## Localisation` du briefing (`run-state/<run>.json`) ;
 *   - les fichiers REELLEMENT modifies ensuite par les commits `agent <runId>:` du depot ;
 *   - les fichiers deja nommes par la TACHE, pour separer ce que `think` a trouve de ce qu'on lui
 *     avait donne.
 * Et il rend la mediane du cout de `think` avant et apres le 2026-09-27 (fin des extraits de notes).
 *
 * LES « TROUS » : chaque trou annonce est classe rencontre plus tard, pas rencontre, ou sans repere
 * verifiable (`trousRencontres`) ; deux signaux d'ensemble completent (`mesurerTrous`). CE QU'IL NE
 * MESURE PAS : le sens d'un trou sans repere, ni s'il a gene le travail — il faudrait un modele.
 * Piste 5 : `thinkParFilEtJour` compte les runs qui paient `think` par conversation et par jour.
 *
 * Les briefings viennent de `run-state/` et, pour les runs que l'app y a effaces, des traces de
 * session Claude Code (`briefingDeSession`). Piste 2 : `suiviProfondeur` rend le cout de `think`
 * sur les 10 runs qui suivent la mise en service des niveaux de profondeur.
 *
 * Usage : node scripts/mesure-valeur-think.mjs [--data <racine>] [--sessions <dossier>]
 *         [--exclure <runId>]... [--json]
 *   --data      defaut : `$AUTOWIN_DATA_ROOT`, sinon `<depot>/.autowin-data/autowin-os`.
 *   --sessions  defaut : `~/.claude/projects` (traces de session des copies `agent__run-*`).
 *   --exclure   retire un run de l'echantillon (ex. le run qui a ecrit ce script, qui se mesurerait).
 * Sortie 0 = mesure rendue ; 2 = racine de donnees introuvable.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** Date ou le run a cesse de fournir des extraits de notes a `think` (choix utilisateur). */
export const BASCULE = Date.parse('2026-09-27T00:00:00Z')

/**
 * Regle de decision de la piste « sauter think quand la tache nomme son fichier », FIXEE AVANT la
 * mesure (cadrage du 2026-10-01) : on construit le saut seulement si, sur au moins
 * `DECISION_MIN_CAS` taches qui nomment un fichier, la Localisation n'apporte AUCUN fichier modifie
 * absent de la tache dans au moins `DECISION_SEUIL` des cas.
 */
export const DECISION_MIN_CAS = 5
export const DECISION_SEUIL = 0.8

/** Extensions reconnues comme fichiers de code ou de doc du depot. */
const EXT = 'tsx?|mts|cts|mjs|cjs|jsx?|json|md|ps1|psm1|ya?ml|css|html|cs|xaml|lua|luau|py|toml'

/** Un chemin avec au moins un dossier : `src/main/x.ts`, `skills/think/SKILL.md`. */
const CHEMIN = new RegExp(`(?:[\\w.@-]+/)+[\\w.@-]+\\.(?:${EXT})\\b`, 'giu')
/** Un nom de fichier nu : `orchestrator.ts:3643`, `SKILL.md`. */
const NOM_NU = new RegExp(`(?<![\\w./@-])[\\w.@-]+\\.(?:${EXT})\\b`, 'giu')

function normaliserChemin(chemin) {
  return chemin.replace(/\\/g, '/').replace(/^\.\//, '').replace(/^\/+/, '')
}

function nomDeBase(chemin) {
  const parts = normaliserChemin(chemin).split('/')
  return parts[parts.length - 1].toLowerCase()
}

/**
 * Les fichiers qu'un texte cite : chemins complets d'un cote, noms nus de l'autre.
 * Un chemin complet donne aussi son nom de base, pour l'appariement par nom.
 */
export function fichiersCites(texte) {
  const source = (texte ?? '').replace(/\\/g, '/')
  const chemins = new Set()
  const noms = new Set()
  for (const m of source.matchAll(CHEMIN)) {
    const chemin = normaliserChemin(m[0])
    chemins.add(chemin)
    noms.add(nomDeBase(chemin))
  }
  for (const m of source.matchAll(NOM_NU)) noms.add(nomDeBase(m[0]))
  return { chemins, noms }
}

/** Le corps de la section `## <titre>` (insensible aux accents et a la casse), ou ''. */
export function section(texte, titre) {
  const voulu = titre.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const lignes = (texte ?? '').split('\n')
  const debut = lignes.findIndex((ligne) => {
    const m = /^\s{0,3}#{1,3}\s+(.+)$/u.exec(ligne)
    if (!m) return false
    const t = m[1].normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
    return t.split(/[^a-z0-9]+/)[0] === voulu
  })
  if (debut < 0) return ''
  const fin = lignes.findIndex((ligne, i) => i > debut && /^\s{0,3}#{1,2}\s+/u.test(ligne))
  return lignes.slice(debut + 1, fin < 0 ? undefined : fin).join('\n')
}

/** Un fichier modifie est-il cite ? Par chemin complet, ou a defaut par son nom de base. */
export function estCite(fichier, cites) {
  const chemin = normaliserChemin(fichier)
  if (cites.chemins.has(chemin)) return true
  // Un chemin cite plus court que le vrai (`main/x.ts` pour `src/main/x.ts`) designe le meme fichier.
  for (const c of cites.chemins) if (chemin.endsWith(`/${c}`)) return true
  return cites.noms.has(nomDeBase(chemin))
}

/**
 * La mesure d'UN run : ce que la Localisation citait, ce qui a ete modifie, et ce que la
 * Localisation a apporte au-dela de la tache.
 */
export function mesurerRun({ tache, briefing, modifies }) {
  const localisation = fichiersCites(section(briefing, 'localisation'))
  const dansTache = fichiersCites(tache)
  const modif = [...new Set(modifies.map(normaliserChemin))]
  const touches = modif.filter((f) => estCite(f, localisation))
  const apportes = touches.filter((f) => !estCite(f, dansTache))
  return {
    tacheNommeUnFichier: dansTache.noms.size > 0,
    citesLocalisation: localisation.noms.size,
    modifies: modif.length,
    modifiesCites: touches.length,
    apportes,
    rappel: modif.length ? touches.length / modif.length : null
  }
}

/**
 * Les « Trous » d'un briefing, mesures SANS modele — deux signaux, nommes pour ce qu'ils sont :
 *  - `fichiersTrouModifies` : les fichiers modifies ensuite que la section `## Trous` citait ; le
 *    trou portait donc sur le chemin reel du travail ;
 *  - `reprisPlusTard` : les reperes `entre accents graves` du trou qu'une etape suivante du MEME run
 *    repete. Une mention n'est pas la preuve que le trou a gene.
 * fix-ok: objection du juge (reparation 2, run-85d8e7f57af2-1) — la mesure ne disait rien des Trous
 * et comptait le run qui l'a ecrite ; mesure-valeur-think.test.mjs rouge (4 cas) avant.
 */
export function mesurerTrous({ briefing, modifies, suite }) {
  const trous = section(briefing, 'trous')
  const reperes = [...new Set([...trous.matchAll(/`([^`\n]{3,})`/gu)].map((m) => m[1].trim()))]
  const cites = fichiersCites(trous)
  const fichiersTrouModifies = [...new Set((modifies ?? []).map(normaliserChemin))].filter((f) =>
    estCite(f, cites)
  )
  const texteSuite = suite ?? ''
  return {
    reperes: reperes.length,
    reprisPlusTard: reperes.filter((repere) => texteSuite.includes(repere)),
    fichiersTrouModifies
  }
}

/** Une puce de premier niveau (au plus un espace de retrait) ouvre un nouveau trou. */
const PUCE_TROU = /^\s?(?:[-*•]|\d+[.)])\s+/u
/** « - rien », « - aucun » : la forme du vide, pas un trou. */
const TROU_VIDE = /^(?:rien|aucune?|neant|n\/a)\b/iu

/**
 * CHAQUE TROU ANNONCE, RENCONTRE PLUS TARD OU NON — la question de la piste 1, tranchee sans modele,
 * puce par puce de la section `## Trous` (une sous-puce appartient a son trou) :
 *  - `rencontre` : une etape suivante du meme run repete un repere du trou (`entre accents graves`),
 *    ou un fichier que le trou cite a ete modifie ensuite ;
 *  - `pas-rencontre` : le trou nomme des reperes, et aucun ne revient ;
 *  - `sans-repere` : le trou ne nomme rien de verifiable ; le classer demanderait de lire son sens.
 * fix-ok: objection du juge, reparation 6 de run-85d8e7f57af2-1 — la mesure comptait des reperes, pas
 * des trous : elle ne disait pas lesquels des trous annonces avaient ete rencontres (test rouge, 2 cas).
 */
export function trousRencontres({ briefing, modifies, suite }) {
  const texteTrous = section(briefing, 'trous')
  const trous = []
  for (const ligne of texteTrous.split('\n')) {
    if (PUCE_TROU.test(ligne)) trous.push(ligne.replace(PUCE_TROU, '').trim())
    else if (trous.length && ligne.trim()) trous[trous.length - 1] += `\n${ligne.trim()}`
  }
  // Sans aucune puce, la section est ecrite en paragraphes : un paragraphe = un trou.
  if (!trous.length) trous.push(...texteTrous.split(/\n\s*\n/u).map((p) => p.trim()))
  const texteSuite = suite ?? ''
  const touches = [...new Set((modifies ?? []).map(normaliserChemin))]
  const detail = trous
    .filter((trou) => trou && !TROU_VIDE.test(trou.normalize('NFD').replace(/[̀-ͯ]/g, '')))
    .map((trou) => {
      const reperes = [...trou.matchAll(/`([^`\n]{3,})`/gu)].map((m) => m[1].trim())
      const cites = fichiersCites(trou)
      const statut =
        reperes.some((repere) => texteSuite.includes(repere)) ||
        touches.some((fichier) => estCite(fichier, cites))
          ? 'rencontre'
          : reperes.length || cites.length
            ? 'pas-rencontre'
            : 'sans-repere'
      return { trou: trou.split('\n')[0].slice(0, 120), statut }
    })
  const compte = (statut) => detail.filter((t) => t.statut === statut).length
  return {
    annonces: detail.length,
    rencontres: compte('rencontre'),
    pasRencontres: compte('pas-rencontre'),
    sansRepere: compte('sans-repere'),
    detail
  }
}

/** Les runs a retirer de l'echantillon : chaque `--exclure <runId>`. */
export function runsExclus(argv) {
  const exclus = new Set()
  argv.forEach((arg, i) => {
    if (arg === '--exclure' && argv[i + 1]) exclus.add(argv[i + 1])
  })
  return exclus
}

export function mediane(valeurs) {
  const v = [...valeurs].sort((a, b) => a - b)
  if (!v.length) return null
  const m = Math.floor(v.length / 2)
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2
}

/**
 * Decision de la piste « sauter think », appliquee telle que fixee AVANT la mesure.
 * `cas` = les mesures des runs dont la tache nomme un fichier.
 */
export function decisionSaut(cas) {
  const sansApport = cas.filter((c) => c.apportes.length === 0).length
  if (cas.length < DECISION_MIN_CAS) {
    return {
      construire: false,
      raison: `${cas.length} cas seulement (minimum ${DECISION_MIN_CAS}) : la mesure ne permet pas de conclure.`
    }
  }
  const part = sansApport / cas.length
  const construire = part >= DECISION_SEUIL
  return {
    construire,
    raison:
      `${sansApport}/${cas.length} taches nommant un fichier sans aucun fichier modifie apporte par la ` +
      `Localisation (${Math.round(part * 100)} %, seuil ${Math.round(DECISION_SEUIL * 100)} %).`
  }
}

/** Les identifiants de run nommes par un message de commit. */
export function runsDuMessage(sujet) {
  return [...new Set((sujet ?? '').match(/\brun-[0-9a-f]{12}-\d+\b/giu) ?? [])]
}

/**
 * Fichiers modifies par run, lus dans tous les commits (toutes branches) dont le message NOMME le
 * run : `agent run-<id>`, `agent run-<id>: …`, `salvage(run-<id>)`, « travail préservé de la copie
 * run-<id> » — les quatre formes relevees le 2026-10-01.
 * fix-ok: run-85d8e7f57af2-1 — la 1re version exigeait `agent run-<id>:` avec deux-points et ne
 * rattachait qu'UN run a un commit (contre 16 annonces) : les vrais messages n'ont souvent pas ce
 * deux-points. Autre reprise : `URL.pathname` rendait `/D:/...` sous Windows, remplace par fileURLToPath.
 */
function fichiersParRun(depot) {
  const sortie = execFileSync(
    'git',
    ['log', '--all', '--no-merges', '--name-only', '--format=@@%s', '--grep=run-'],
    { cwd: depot, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 }
  )
  const parRun = new Map()
  let courants = []
  for (const ligne of sortie.split('\n')) {
    if (ligne.startsWith('@@')) {
      courants = runsDuMessage(ligne.slice(2))
      continue
    }
    const fichier = ligne.trim()
    if (!fichier) continue
    for (const run of courants) {
      if (!parRun.has(run)) parRun.set(run, new Set())
      parRun.get(run).add(fichier)
    }
  }
  return parRun
}

/** Les lignes de cout `think` de `activity/*.jsonl`, et le total des couts rattaches a un run. */
function coutsThink(racine, exclus = new Set()) {
  const dossier = join(racine, 'activity')
  const think = []
  let totalRuns = 0
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith('.jsonl'))) {
    for (const ligne of readFileSync(join(dossier, nom), 'utf8').split('\n')) {
      if (!ligne.includes('"costUsd"')) continue
      let l
      try {
        l = JSON.parse(ligne)
      } catch {
        continue
      }
      if (typeof l.costUsd !== 'number' || !l.runId || exclus.has(l.runId)) continue
      totalRuns += l.costUsd
      // Le fil : `activity/<conversation>.jsonl` (les lignes de cout ne portent pas la conversation).
      const conv = nom.startsWith('conv-') ? nom.slice(0, -'.jsonl'.length) : undefined
      if (l.phase === 'think') {
        think.push({ ts: Date.parse(l.ts), cout: l.costUsd, runId: l.runId, conv })
      }
    }
  }
  return { think, totalRuns }
}

function briefings(racine) {
  const dossier = join(racine, 'run-state')
  const sortie = []
  for (const nom of readdirSync(dossier).filter((n) => n.endsWith('.json'))) {
    let etat
    try {
      etat = JSON.parse(readFileSync(join(dossier, nom), 'utf8'))
    } catch {
      continue
    }
    const sorties = etat.phaseOutputs ?? []
    const rang = sorties.findIndex((o) => o.phase === 'think')
    const think = sorties[rang]
    if (!think || typeof think.text !== 'string' || !think.text.trim()) continue
    // Ce que les etapes SUIVANTES du meme run ont ecrit : la ou un trou peut etre repris.
    const suite = sorties
      .slice(rang + 1)
      .map((o) => (typeof o.text === 'string' ? o.text : ''))
      .join('\n')
    sortie.push({ runId: etat.runId, tache: String(etat.task ?? ''), briefing: think.text, suite })
  }
  return sortie
}

/*
 * LES BRIEFINGS QUE run-state/ A PERDUS, RELUS DANS LES TRACES DE SESSION.
 *
 * fix-ok: objection du juge, reparation 5 de run-85d8e7f57af2-1 — l'echantillon ne lisait que
 * run-state/ (33 briefings), que l'app efface a la fin de chaque run (`clearOrchestrationState`,
 * src/main/runs/orchestration-state.ts). Les traces `~/.claude/projects/*agent--run-*` gardent 56
 * briefings, dont les 11 qui existent aussi dans run-state/ sont identiques (prototype du 2026-10-01).
 * Une session est `think` si l'instantane de son prompt systeme porte la consigne `think`, ou, pour
 * les sessions plus anciennes sans instantane, si sa sortie a les titres Localisation ET Trous.
 */
const MARQUE_THINK = '=== SKILL THINK (kit) ==='

function texteDe(contenu) {
  if (typeof contenu === 'string') return contenu
  if (!Array.isArray(contenu)) return ''
  return contenu
    .filter((p) => p?.type === 'text')
    .map((p) => p.text ?? '')
    .join('\n')
}

function texteAssistant(objets) {
  const textes = []
  for (const o of objets) {
    if (o?.type !== 'assistant' || !Array.isArray(o.message?.content)) continue
    for (const b of o.message.content) if (b?.type === 'text' && b.text) textes.push(b.text)
  }
  return textes.join('\n\n')
}

/** Le briefing `think` d'une session (lignes JSONL deja parsees), ou `undefined`. */
export function briefingDeSession(objets) {
  let marque = false
  let premier
  for (const o of objets) {
    const prompt = o?.type === 'attachment' ? o.attachment?.systemPrompt : undefined
    if ([].concat(prompt ?? []).some((p) => typeof p === 'string' && p.includes(MARQUE_THINK))) {
      marque = true
    }
    if (o?.type === 'user' && premier === undefined) premier = texteDe(o.message?.content)
  }
  const briefing = texteAssistant(objets)
  const forme = /^##\s+Localisation/imu.test(briefing) && /^##\s+Trous/imu.test(briefing)
  if (!briefing.trim() || !(marque || forme)) return undefined
  const brut = premier ?? ''
  const i = brut.search(/T[ÂA]CHE\s*:/u)
  const tache =
    i < 0
      ? ''
      : brut
          .slice(i)
          .replace(/^T[ÂA]CHE\s*:\s*/u, '')
          .split('\n[COLLECTE DE CONTEXTE')[0]
  return { tache: tache.trim(), briefing }
}

function debutDe(objets) {
  for (const o of objets) {
    const t = Date.parse(o?.timestamp ?? '')
    if (Number.isFinite(t)) return t
  }
  return Infinity
}

/** Un briefing par run, lu dans `<projets>/*agent--run-<id>/*.jsonl` ; la suite = sessions posterieures. */
function briefingsDesSessions(projets) {
  if (!projets || !existsSync(projets)) return []
  const sortie = []
  for (const nom of readdirSync(projets)) {
    const m = /agent--(run-[0-9a-f]{12}-\d+)$/u.exec(nom)
    if (!m) continue
    const sessions = []
    for (const f of readdirSync(join(projets, nom)).filter((n) => n.endsWith('.jsonl'))) {
      const objets = []
      for (const ligne of readFileSync(join(projets, nom, f), 'utf8').split('\n')) {
        if (!ligne) continue
        try {
          objets.push(JSON.parse(ligne))
        } catch {
          /* ligne coupee en cours d'ecriture */
        }
      }
      sessions.push({ debut: debutDe(objets), objets })
    }
    sessions.sort((a, b) => a.debut - b.debut)
    const rang = sessions.findIndex((s) => briefingDeSession(s.objets))
    if (rang < 0) continue
    const suite = sessions
      .slice(rang + 1)
      .map((s) => texteAssistant(s.objets))
      .join('\n')
    sortie.push({ runId: m[1], ...briefingDeSession(sessions[rang].objets), suite })
  }
  return sortie
}

/*
 * PISTE 2 : LE COUT DE `think` SUR LES 10 RUNS QUI SUIVENT LES NIVEAUX DE PROFONDEUR.
 * La mise en service est la date du commit qui ajoute la marque a skills/think/SKILL.md sur la
 * branche courante du DEPOT PRINCIPAL : l'app lit sa skill dans le depot (`skillRoots`,
 * src/main/native-registry.ts), et une fusion reecrit la date de commit (mesure : les 3 commits
 * de run-3180eec71b06-1 portent tous 2026-09-30T15:48:06, l'heure de leur arrivee sur main).
 */
export const MARQUE_PROFONDEUR = 'Choisis la profondeur AVANT de chercher'

function miseEnServiceProfondeur(depot) {
  try {
    const sortie = execFileSync(
      'git',
      [
        'log',
        '--reverse',
        '--format=%cI',
        '-S',
        MARQUE_PROFONDEUR,
        'HEAD',
        '--',
        'skills/think/SKILL.md'
      ],
      { cwd: depot, encoding: 'utf8' }
    )
    const t = Date.parse(sortie.split('\n')[0] ?? '')
    return Number.isFinite(t) ? t : undefined
  } catch {
    return undefined
  }
}

/** Un cout `think` par run (somme de ses passages) apres `depuis`, sur les `attendus` premiers runs. */
export function suiviProfondeur(think, depuis, attendus = 10) {
  if (depuis == null) {
    return { enService: false, depuis: null, runs: 0, attendus, mediane: null, complet: false }
  }
  const parRun = new Map()
  for (const l of [...think].filter((p) => p.ts >= depuis).sort((a, b) => a.ts - b.ts)) {
    parRun.set(l.runId, (parRun.get(l.runId) ?? 0) + l.cout)
  }
  const couts = [...parRun.values()].slice(0, attendus)
  return {
    enService: true,
    depuis: new Date(depuis).toISOString(),
    runs: couts.length,
    attendus,
    mediane: mediane(couts),
    complet: couts.length >= attendus
  }
}

/**
 * LE NOMBRE DE `think` PAYES PAR FIL ET PAR JOUR — la mesure demandee par la piste 5.
 * Un couple = une conversation et une date (UTC) ; on y compte les runs DISTINCTS qui paient `think`.
 * Deux runs d'un meme couple ne sont pas forcement un doublon : deux demandes differentes paient
 * chacune leur briefing. `coutApresLePremier` = ce que ces couples ont paye apres leur premier run.
 */
export function thinkParFilEtJour(think) {
  const couples = new Map()
  for (const l of [...think].sort((a, b) => a.ts - b.ts)) {
    if (!l.conv || !Number.isFinite(l.ts)) continue
    const jour = new Date(l.ts).toISOString().slice(0, 10)
    const cle = `${l.conv}|${jour}`
    const couple = couples.get(cle) ?? { conv: l.conv, jour, parRun: new Map() }
    couple.parRun.set(l.runId, (couple.parRun.get(l.runId) ?? 0) + l.cout)
    couples.set(cle, couple)
  }
  const liste = [...couples.values()].map(({ conv, jour, parRun }) => {
    const couts = [...parRun.values()]
    return {
      conv,
      jour,
      runs: couts.length,
      cout: couts.reduce((s, c) => s + c, 0),
      apresLePremier: couts.slice(1).reduce((s, c) => s + c, 0)
    }
  })
  const aPlusieursRuns = liste
    .filter((c) => c.runs >= 2)
    .sort((a, b) => b.runs - a.runs || b.cout - a.cout)
  return {
    couples: liste.length,
    maxRuns: liste.reduce((m, c) => Math.max(m, c.runs), 0),
    aPlusieursRuns,
    coutApresLePremier: aPlusieursRuns.reduce((s, c) => s + c.apresLePremier, 0)
  }
}

const dollars = (v) => (v == null ? '—' : `${v.toFixed(2)} $`)

/**
 * La racine des donnees de l'app : `--data`, puis `$AUTOWIN_DATA_ROOT`, puis celle du depot, puis
 * celle du DEPOT PRINCIPAL. Une copie de travail (worktree) n'a pas de `.autowin-data` : les donnees
 * vivent a cote du depot principal, que `depotPrincipal` designe.
 * fix-ok: objection du juge, reparation 4 de run-85d8e7f57af2-1 — lance sans `--data` depuis la
 * copie de travail, le script rendait 2 ; mesure-valeur-think.test.mjs rouge (3/16) avant.
 */
export function racineDeDonnees({ argv, env, depot, depotPrincipal, existe = existsSync }) {
  const iData = argv.indexOf('--data')
  if (iData >= 0) return resolve(argv[iData + 1])
  if (env.AUTOWIN_DATA_ROOT) return env.AUTOWIN_DATA_ROOT
  const candidates = [depot, depotPrincipal]
    .filter(Boolean)
    .map((d) => join(d, '.autowin-data', 'autowin-os'))
  return candidates.find((c) => existe(join(c, 'run-state'))) ?? candidates[0]
}

/** Le dossier du depot principal (parent du `.git` commun), ou `undefined` hors git. */
function depotPrincipalDe(depot) {
  try {
    const commun = execFileSync(
      'git',
      ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd: depot, encoding: 'utf8' }
    ).trim()
    return commun ? dirname(commun) : undefined
  } catch {
    return undefined
  }
}

function principal(argv) {
  const depot = fileURLToPath(new URL('..', import.meta.url))
  const racine = racineDeDonnees({
    argv,
    env: process.env,
    depot,
    depotPrincipal: depotPrincipalDe(depot)
  })
  if (!existsSync(join(racine, 'run-state')) || !existsSync(join(racine, 'activity'))) {
    console.error(`Racine de donnees introuvable (run-state/ et activity/ attendus) : ${racine}`)
    return 2
  }

  const parRun = fichiersParRun(depot)
  const exclus = runsExclus(argv)
  const iSessions = argv.indexOf('--sessions')
  const projets =
    iSessions >= 0 ? resolve(argv[iSessions + 1]) : join(homedir(), '.claude', 'projects')
  const deRunState = briefings(racine)
  const connus = new Set(deRunState.map((b) => b.runId))
  const deSessions = briefingsDesSessions(projets).filter((b) => !connus.has(b.runId))
  const lus = [...deRunState, ...deSessions].filter((b) => !exclus.has(b.runId))
  const sources = {
    runState: deRunState.filter((b) => !exclus.has(b.runId)).length,
    sessions: deSessions.filter((b) => !exclus.has(b.runId)).length
  }
  const runs = lus
    .filter((b) => parRun.has(b.runId))
    .map((b) => ({ runId: b.runId, ...mesurerRun({ ...b, modifies: [...parRun.get(b.runId)] }) }))
  const trous = lus.map((b) => ({
    runId: b.runId,
    avecCommit: parRun.has(b.runId),
    ...mesurerTrous({ ...b, modifies: [...(parRun.get(b.runId) ?? [])] })
  }))
  const avecReperes = trous.filter((t) => t.reperes > 0)
  const trousResume = {
    briefingsAvecReperes: avecReperes.length,
    reperes: avecReperes.reduce((s, t) => s + t.reperes, 0),
    reprisPlusTard: avecReperes.reduce((s, t) => s + t.reprisPlusTard.length, 0),
    briefingsDontUnTrouEstRepris: avecReperes.filter((t) => t.reprisPlusTard.length > 0).length,
    runsAvecCommit: trous.filter((t) => t.avecCommit).length,
    runsDontUnTrouCiteUnFichierModifie: trous.filter((t) => t.fichiersTrouModifies.length > 0)
      .length
  }
  const parTrou = lus.map((b) =>
    trousRencontres({ ...b, modifies: [...(parRun.get(b.runId) ?? [])] })
  )
  const trousAnnonces = {
    briefings: parTrou.filter((t) => t.annonces > 0).length,
    annonces: parTrou.reduce((s, t) => s + t.annonces, 0),
    rencontres: parTrou.reduce((s, t) => s + t.rencontres, 0),
    pasRencontres: parTrou.reduce((s, t) => s + t.pasRencontres, 0),
    sansRepere: parTrou.reduce((s, t) => s + t.sansRepere, 0)
  }

  const couts = coutsThink(racine, exclus)
  const { think, totalRuns } = couts
  const coutThink = think.reduce((s, l) => s + l.cout, 0)
  const avant = mediane(think.filter((l) => l.ts < BASCULE).map((l) => l.cout))
  const apres = think.filter((l) => l.ts >= BASCULE).map((l) => l.cout)
  const profondeur = suiviProfondeur(
    think,
    miseEnServiceProfondeur(depotPrincipalDe(depot) ?? depot)
  )
  const filJour = thinkParFilEtJour(think)

  const nommant = runs.filter((r) => r.tacheNommeUnFichier)
  const decision = decisionSaut(nommant)
  const rappels = runs.map((r) => r.rappel).filter((v) => v != null)

  const resultat = {
    briefingsComplets: lus.length,
    runsAvecCommit: runs.length,
    rappelMedian: mediane(rappels),
    runsOuLocalisationApporte: runs.filter((r) => r.apportes.length > 0).length,
    coutThink: {
      passages: think.length,
      total: coutThink,
      partDesRuns: totalRuns ? coutThink / totalRuns : null
    },
    medianeAvant: avant,
    apres,
    decisionSaut: decision,
    exclus: [...exclus],
    sources,
    profondeur,
    thinkParFilEtJour: filJour,
    trous: trousResume,
    trousAnnonces,
    runs
  }
  if (argv.includes('--json')) {
    console.log(JSON.stringify(resultat, null, 2))
    return 0
  }

  console.log(
    `Briefings think complets : ${lus.length} (run-state : ${sources.runState} ; traces de session : ` +
      `${sources.sessions}) ; dont rattaches a un commit : ${runs.length}` +
      (exclus.size ? ` (exclus : ${[...exclus].join(', ')})` : '')
  )
  console.log('')
  console.log(
    'run | tache nomme un fichier | cites Localisation | modifies | modifies cites | apportes par think'
  )
  for (const r of runs) {
    console.log(
      `${r.runId} | ${r.tacheNommeUnFichier ? 'oui' : 'non'} | ${r.citesLocalisation} | ${r.modifies} | ` +
        `${r.modifiesCites} | ${r.apportes.length ? r.apportes.join(', ') : '—'}`
    )
  }
  console.log('')
  const rm = resultat.rappelMedian
  console.log(
    `Part mediane des fichiers modifies que la Localisation citait : ${rm == null ? '—' : `${Math.round(rm * 100)} %`}`
  )
  console.log(
    `Runs ou la Localisation cite un fichier modifie que la tache ne nommait pas : ${resultat.runsOuLocalisationApporte}/${runs.length}`
  )
  console.log('')
  const t = trousResume
  console.log(
    `Trous : ${t.briefingsAvecReperes}/${lus.length} briefings y nomment des reperes ; ` +
      `${t.reprisPlusTard}/${t.reperes} reperes repris par une etape suivante ` +
      `(${t.briefingsDontUnTrouEstRepris} briefings) ; ` +
      `${t.runsDontUnTrouCiteUnFichierModifie}/${t.runsAvecCommit} runs a commit dont un trou citait un fichier modifie ensuite`
  )
  const ta = trousAnnonces
  console.log(
    `Trous annonces : ${ta.annonces} dans ${ta.briefings} briefings ; rencontres plus tard : ${ta.rencontres} ` +
      `(repere repris par une etape suivante, ou fichier cite modifie ensuite) ; pas rencontres : ` +
      `${ta.pasRencontres} ; sans repere verifiable : ${ta.sansRepere}`
  )
  console.log(
    '  (les « sans repere » ne se classent qu’en lisant leur sens, et savoir si un trou a gene le travail' +
      ' aussi : cela demanderait un modele, exclu ici)'
  )
  console.log('')
  console.log(
    `Cout think : ${think.length} passages, ${dollars(coutThink)} au total, ` +
      `${resultat.coutThink.partDesRuns == null ? '—' : `${(resultat.coutThink.partDesRuns * 100).toFixed(1)} %`} des couts rattaches a un run`
  )
  console.log(
    `Mediane avant le 2026-09-27 : ${dollars(avant)} ; apres : ${apres.map(dollars).join(' / ') || '—'}`
  )
  console.log(
    profondeur.enService
      ? `Niveaux de profondeur (piste 2), en service depuis ${profondeur.depuis} : ` +
          `${profondeur.runs}/${profondeur.attendus} runs, mediane ${dollars(profondeur.mediane)}` +
          (profondeur.complet ? '' : ' (mesure incomplete)')
      : `Niveaux de profondeur (piste 2) : pas encore sur la branche du depot principal — ` +
          `0/${profondeur.attendus} runs, la mesure demarre a la fusion`
  )
  const plusieurs = filJour.aPlusieursRuns
  console.log(
    `Think payes par fil et par jour (piste 5) : ${filJour.couples} couples fil/jour ; ` +
      `${plusieurs.length} ou au moins 2 runs paient think (max ${filJour.maxRuns}) ; ` +
      `${dollars(filJour.coutApresLePremier)} payes apres le premier run du couple`
  )
  for (const c of plusieurs.slice(0, 5)) {
    console.log(`  ${c.conv} ${c.jour} : ${c.runs} runs, ${dollars(c.cout)}`)
  }
  console.log('')
  console.log(
    `Sauter think quand la tache nomme son fichier : ${decision.construire ? 'OUI' : 'NON'} — ${decision.raison}`
  )
  return 0
}

const lanceDirectement =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href
if (lanceDirectement) process.exit(principal(process.argv.slice(2)))
