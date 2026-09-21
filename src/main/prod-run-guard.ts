/**
 * LA COMMANDE `run` FACE À LA PRODUCTION (évaluation conv-738, 2026-09-21).
 *
 * Deux failles, deux fonctions pures, appelées DANS `commands.ts` au moment de lancer :
 *   1. `refusReglageProd` — les fichiers de réglage de la protection (`prod-niveau.json`,
 *      `prod-autorite.json`, `prod-passphrase.json`) ne se touchent QUE par l'écran de réglages
 *      (IPC `prod:porte:niveau`, qui exige la phrase pour baisser la garde). Une commande `run` qui
 *      les nomme est refusée, quel que soit le niveau : sinon l'agent coupait la protection seul.
 *   2. `cibleSqlDeCommande` — un client SQL (sqlcmd, osql, bcp, Invoke-Sqlcmd) lancé par `run`
 *      vise une base : il doit passer par `PorteProd`, comme `sql_query`. Base introuvable dans la
 *      ligne → nom `inconnu`, que le classifieur traite comme de la production (refus par défaut).
 */

const FICHIERS_REGLAGE_PROD = /prod-(niveau|autorite|passphrase)\.json/i

export function refusReglageProd(ligne: string): string | undefined {
  const m = FICHIERS_REGLAGE_PROD.exec(ligne)
  if (!m) return undefined
  return (
    `la commande touche ${m[0]}, un réglage de la protection de production. ` +
    'Il ne se change que depuis l’écran de réglages, par l’utilisateur.'
  )
}

const CLIENT_SQL = /(?:^|[\s"'\/(;&|])(sqlcmd|osql|bcp|invoke-sqlcmd)(?:\.exe)?(?=["'\s]|$)/i

export interface CibleSqlRun {
  client: string
  base: string
}

function valeurApres(jetons: string[], options: string[]): string | undefined {
  for (let i = 0; i < jetons.length - 1; i++) {
    if (options.includes(jetons[i].toLowerCase())) return jetons[i + 1]
  }
  return undefined
}

export function cibleSqlDeCommande(ligne: string): CibleSqlRun | undefined {
  const m = CLIENT_SQL.exec(ligne)
  if (!m) return undefined
  const client = m[1].toLowerCase()
  const reste = ligne.slice(m.index + m[0].length)
  const jetons = reste.match(/"[^"]*"|'[^']*'|\S+/g)?.map((j) => j.replace(/^["']|["']$/g, '')) ?? []
  let base = valeurApres(jetons, ['-d', '/d', '-database'])
  if (!base && client === 'bcp' && jetons[0] && !jetons[0].startsWith('-')) {
    const qualifie = jetons[0].split('.')
    if (qualifie.length >= 2) base = qualifie[0]
  }
  return { client, base: base?.replace(/^\[|\]$/g, '') || 'inconnu' }
}
