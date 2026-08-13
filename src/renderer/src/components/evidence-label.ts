/**
 * Traduit une sortie de commande en une phrase qu'un humain lit sans décoder.
 *
 * Signalé par l'utilisateur le 2026-08-13 sur une puce réelle de son fil — « npm run test:unit →
 * exit 1 … c'est pas clair ». La puce parlait shell : un code de sortie brut, qui ne dit ni que les
 * tests ont ÉCHOUÉ, ni combien.
 *
 * Le code de sortie RESTE affiché dans TOUS les cas, succès compris : c'est la preuve vérifiable,
 * elle ne se cache pas derrière une jolie phrase — un test l'exigeait déjà, et il avait raison.
 * On met seulement devant ce qu'il signifie.
 */
export interface SortieCommande {
  exitCode?: number
  stdout?: string
}

export interface LibelleSortie {
  texte: string
  ok: boolean
}

/** `Tests  11 failed | 5827 passed (5838)` — la ligne de synthèse des runners de test. */
const SYNTHESE_TESTS = /\bTests\s+(?:(\d+)\s+failed\s*\|\s*)?(\d+)\s+passed\s*\((\d+)\)/

export function libelleSortieCommande(sortie: SortieCommande): LibelleSortie | undefined {
  if (typeof sortie.exitCode !== 'number') return undefined
  const ok = sortie.exitCode === 0
  const synthese = sortie.stdout ? SYNTHESE_TESTS.exec(sortie.stdout) : null

  if (synthese) {
    const echecs = Number(synthese[1] ?? 0)
    const total = Number(synthese[3])
    if (echecs > 0) {
      return { texte: `${echecs} test${echecs > 1 ? 's' : ''} en échec sur ${total} · exit ${sortie.exitCode}`, ok }
    }
    if (ok) return { texte: `${total} tests verts · exit 0`, ok }
  }

  return { texte: `${ok ? 'réussi' : 'échec'} · exit ${sortie.exitCode}`, ok }
}
