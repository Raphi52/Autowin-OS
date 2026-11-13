/**
 * « SIGNALER UN PROBLÈME SUR CE FIL » : la demande qui ouvre l'analyse d'un ou plusieurs fils.
 *
 * Pour parler d'un fil qui a mal tourné, l'utilisateur ouvrait un fil neuf et y recopiait son numéro
 * (« 1789 cette conv a mis 16h ») : 17 fils de ce genre du 30/10 au 13/11. La skill `kaizen` lit déjà
 * un ou plusieurs fils nommés (`/kaizen conv-1667 conv-1699`, `skills/kaizen/SKILL.md`). Le menu du
 * fil prépare donc cette ligne dans un fil neuf, sans l'envoyer : il reste à dire ce qui n'a pas
 * marché, d'où l'espace final où le curseur attend.
 */

const NUMERO = /^conv-(\d+)$/u

/** `/kaizen conv-12 conv-34 ` : identifiants dédoublonnés, du plus ancien au plus récent. */
export function demandeDeSignalement(ids: readonly string[]): string {
  const uniques = [...new Set(ids.map((id) => id.trim()).filter(Boolean))]
  const rang = (id: string): number => Number(NUMERO.exec(id)?.[1] ?? Number.MAX_SAFE_INTEGER)
  uniques.sort((a, b) => rang(a) - rang(b) || a.localeCompare(b))
  return `/kaizen ${uniques.join(' ')} `
}
