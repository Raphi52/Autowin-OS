/**
 * COMMANDE `<cmd>` COMPLETE, REJETEE PAR LE CLI — mesure conv-121, tour
 * `080f524d-01eb-4fa6-b5a8-fcf1a347f8dc` (2026-10-07, saisie ts 1791361089418 « passe en react on va
 * grandir ») : le modele ecrit en TEXTE `<cmd>{"name":"orchestrate","args":{...}}` mais le referme
 * avec les balises d'appel d'outil natif (`</parameter>\n</invoke>`) au lieu de `</cmd>`. Le CLI
 * Claude y voit un appel d'outil natif illisible, relance une fois, echoue pareil et rend
 * `is_error` « The model's tool call could not be parsed (retry also failed) ». Les DEUX reponses
 * portaient pourtant un JSON de commande complet et valide (journal run-stdout 8f2cc560…, lignes 124
 * et 230). Le tour entier etait jete (0,049 USD), l'utilisateur devait relancer — « cette erreur
 * arrive souvent » (saisie ts 1791361145862).
 *
 * Cause hors depot : le modele melange le protocole texte `<cmd>` et la syntaxe d'appel natif.
 * Ce que fait Autowin : la decision du modele est entiere et lisible, on l'execute (derniere
 * commande lisible, refermee par `</cmd>`). Sans commande lisible, l'erreur reste une erreur.
 */
export function commandeRecupereeApresAppelIllisible(texte: string): string | undefined {
  let debut = texte.lastIndexOf('<cmd>')
  while (debut >= 0) {
    let j = debut + 5
    while (j < texte.length && /\s/.test(texte[j])) j++
    const fin = texte[j] === '{' ? finObjetJson(texte, j) : -1
    if (fin > 0) {
      const json = texte.slice(j, fin)
      try {
        const parsed = JSON.parse(json) as { name?: unknown }
        if (parsed && typeof parsed.name === 'string' && parsed.name) {
          return `${texte.slice(0, texte.indexOf('<cmd>')).trim()}\n<cmd>${json}</cmd>`.trim()
        }
      } catch {
        /* JSON illisible : on tente le bloc precedent */
      }
    }
    debut = debut > 0 ? texte.lastIndexOf('<cmd>', debut - 1) : -1
  }
  return undefined
}

function finObjetJson(raw: string, debut: number): number {
  let profondeur = 0
  let chaine = false
  let echappe = false
  for (let k = debut; k < raw.length; k++) {
    const c = raw[k]
    if (chaine) {
      if (echappe) echappe = false
      else if (c === '\\') echappe = true
      else if (c === '"') chaine = false
      continue
    }
    if (c === '"') chaine = true
    else if (c === '{') profondeur++
    else if (c === '}') {
      profondeur--
      if (profondeur === 0) return k + 1
    }
  }
  return -1
}
