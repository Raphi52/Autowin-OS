#!/usr/bin/env node
/**
 * bilan-promesse — où en est « un prompt = une réussite » ? Lecture seule des fiches de demandes.
 *
 * Compte les BESOINS (une demande et ses relances dans le même fil) et dit pourquoi ceux qui ne
 * sont pas prouvés ne le sont pas. Trois pièges du comptage à la main sont tenus ici :
 *   - une ligne de rôle « copie » est la MÊME demande vue depuis un fil dupliqué, pas une de plus ;
 *   - « fini sans vérification » couvre surtout des tours qui n'ont écrit aucun fichier : rien à
 *     prouver n'est pas un défaut de preuve ;
 *   - un test rouge n'accuse pas toujours le travail : garde qui lit tout le dossier partagé,
 *     reproduction lancée exprès dans un dossier à part.
 *
 * Usage : node scripts/bilan-promesse.mjs [--data <dir>] [--json]
 */
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

/** Même liste que la garde de fin de tour (`chat-turn-messages.ts`, EXTENSION_DE_CODE). */
const CODE = /\.(?:ts|tsx|mts|cts|mjs|cjs|js|jsx|cs|vb|py|ps1|sql|xaml|go|rs|java)$/u
const JETABLE = /\.autowin-(?:tmp|data)\b/u
const TEST_JOUE = /→ ex|\b(?:vitest|typecheck|eslint|lint|npm (?:run )?test)\b/u
const GARDE_GLOBALE = /separation-entreprise|security-critical|couleurs-en-dur|agents-md-faits/u
const DOSSIER_A_PART = /\.autowin-tmp|[\\/]tmp[\\/]|AppData.Local.Temp|-wt-|[\\/]wt\b|\bzz-/iu

function lignesJson(fichier) {
  let texte
  try {
    texte = fs.readFileSync(fichier, 'utf8')
  } catch {
    return []
  }
  const lignes = []
  for (const brute of texte.split('\n')) {
    if (!brute.trim()) continue
    try {
      lignes.push(JSON.parse(brute))
    } catch {
      // Une ligne coupée par un arrêt en pleine écriture : les autres restent lisibles.
    }
  }
  return lignes
}

const cle = (ligne) => `${ligne.conversationId}|${ligne.messageId}`

/** Pourquoi une demande refusée l'est, d'après son constat. */
export function familleDuRefus(constat) {
  const texte = constat ?? ''
  if (/contrôle final/u.test(texte)) return 'contrôle final'
  if (/hit your|limite d.usage|quota/iu.test(texte)) return 'limite d’usage'
  if (/tour arrêté avant la fin/u.test(texte)) return 'tour arrêté avant la fin'
  if (TEST_JOUE.test(texte)) {
    if (/copies-de-(?:taches|fil)/u.test(texte)) return 'test rouge — copie de travail du fil'
    if (DOSSIER_A_PART.test(texte)) return 'test rouge — dossier à part'
    if (GARDE_GLOBALE.test(texte)) return 'test rouge — garde de tout le dossier'
    return 'test rouge — test du dépôt'
  }
  if (/⛔|Bloqué|Non résolu/u.test(texte)) return 'blocage déclaré'
  return 'autre'
}

const ajouter = (compteur, nom) => {
  compteur[nom] = (compteur[nom] ?? 0) + 1
}

/**
 * @param {{ lignes: object[], besoins: object[], traces: object[] }} donnees les trois journaux lus
 */
export function bilan({ lignes, besoins, traces }) {
  const derniere = new Map()
  for (const ligne of lignes) derniere.set(cle(ligne), ligne)
  const toutes = [...derniere.values()]
  const demandes = toutes
    .filter((ligne) => ligne.role !== 'copie')
    .sort((a, b) => (a.demandeLe ?? 0) - (b.demandeLe ?? 0))

  const tourDe = new Map(besoins.map((besoin) => [cle(besoin), besoin.turnId]))
  const ecritsParTour = new Map()
  for (const trace of traces) {
    if (!trace.turnId) continue
    const chemins = ecritsParTour.get(trace.turnId) ?? []
    chemins.push(...(trace.paths ?? []).filter((chemin) => !JETABLE.test(chemin)))
    ecritsParTour.set(trace.turnId, chemins)
  }

  // Un besoin = la demande qui l'ouvre et les relances qui la suivent dans le même fil.
  const groupes = []
  const ouvert = new Map()
  for (const demande of demandes) {
    const groupe = demande.role === 'suite' ? ouvert.get(demande.conversationId) : undefined
    if (groupe) groupe.push(demande)
    else {
      const neuf = [demande]
      ouvert.set(demande.conversationId, neuf)
      groupes.push(neuf)
    }
  }

  const etats = {}
  const sansPreuve = {}
  const refus = {}
  for (const demande of demandes) {
    ajouter(etats, demande.etat ?? 'inconnu')
    if (demande.etat === 'refuse') ajouter(refus, familleDuRefus(demande.constat))
    if (demande.etat !== 'sans-preuve') continue
    if (demande.constat !== 'fini sans vérification') {
      ajouter(sansPreuve, demande.constat ?? 'inconnu')
      continue
    }
    const tour = tourDe.get(cle(demande))
    const ecrits = tour ? ecritsParTour.get(tour) : undefined
    if (!tour) ajouter(sansPreuve, 'tour inconnu')
    else if (!ecrits?.length) ajouter(sansPreuve, 'aucun fichier écrit — rien à prouver')
    else if (ecrits.some((chemin) => CODE.test(chemin))) ajouter(sansPreuve, 'code écrit sans test')
    else ajouter(sansPreuve, 'fichiers écrits, pas de code')
  }

  const tailles = groupes.map((groupe) => groupe.length).sort((a, b) => a - b)
  return {
    lignesLues: toutes.length,
    copiesEcartees: toutes.length - demandes.length,
    demandes: demandes.length,
    besoins: groupes.length,
    prouvesAuPremierMessage: groupes.filter((groupe) => groupe[0].etat === 'prouve').length,
    prouvesALaFin: groupes.filter((groupe) => groupe.at(-1).etat === 'prouve').length,
    prouvesPuisPerdus: groupes.filter(
      (groupe) => groupe.at(-1).etat !== 'prouve' && groupe.some((d) => d.etat === 'prouve')
    ).length,
    messagesParBesoin: {
      mediane: tailles[tailles.length >> 1] ?? 0,
      moyenne: tailles.length
        ? Math.round((tailles.reduce((a, b) => a + b, 0) / tailles.length) * 10) / 10
        : 0
    },
    etats,
    sansPreuve,
    refus
  }
}

export function lireLesDonnees(dossier) {
  const spool = path.join(dossier, 'conversation-file-trace-spool')
  return {
    lignes: lignesJson(path.join(dossier, 'demandes', 'index.jsonl')),
    besoins: lignesJson(path.join(dossier, 'besoins.jsonl')),
    traces: ['events.archive.jsonl', 'events.previous.jsonl', 'events.jsonl'].flatMap((nom) =>
      lignesJson(path.join(spool, nom))
    )
  }
}

function rapport(b) {
  const part = (n, total) => (total ? `${Math.round((n / total) * 100)} %` : '—')
  const trier = (compteur) => Object.entries(compteur).sort((a, c) => c[1] - a[1])
  return [
    `Besoins : ${b.besoins} (${b.demandes} demandes, ${b.copiesEcartees} copies de fil écartées)`,
    `Prouvés au premier message : ${b.prouvesAuPremierMessage} (${part(b.prouvesAuPremierMessage, b.besoins)})`,
    `Prouvés à la fin du fil    : ${b.prouvesALaFin} (${part(b.prouvesALaFin, b.besoins)})`,
    `Prouvés puis perdus        : ${b.prouvesPuisPerdus}`,
    `Messages par besoin        : médiane ${b.messagesParBesoin.mediane}, moyenne ${b.messagesParBesoin.moyenne}`,
    '',
    'Demandes sans preuve :',
    ...trier(b.sansPreuve).map(([nom, n]) => `  ${String(n).padStart(4)}  ${nom}`),
    '',
    'Demandes refusées :',
    ...trier(b.refus).map(([nom, n]) => `  ${String(n).padStart(4)}  ${nom}`)
  ].join('\n')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2)
  const i = args.indexOf('--data')
  const dossier = path.resolve(i >= 0 && args[i + 1] ? args[i + 1] : '.autowin-data/autowin-os')
  const resultat = bilan(lireLesDonnees(dossier))
  console.log(args.includes('--json') ? JSON.stringify(resultat, null, 2) : rapport(resultat))
}
