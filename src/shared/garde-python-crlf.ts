/**
 * GARDE : UN AGENT NE RÉÉCRIT PAS UN FICHIER EN CRLF PAR PYTHON EN MODE TEXTE.
 *
 * Mesuré le 2026-10-01 sur D:\AutoWinOS : 48 fichiers étaient LF dans git (`i/lf`) et CRLF sur le
 * disque (`w/crlf`). 47 venaient d'un script Python lancé par un agent dans une commande Bash
 * (`python - <<'E' … open(p,'w',encoding='utf8').write(s)`), dans environ 25 sessions. Sous Windows,
 * Python en mode texte remplace chaque `\n` par `os.linesep` (`\r\n`) ; `newline=''` le garde.
 * `.gitattributes` (`* text=auto eol=lf`) normalise au commit : `git status` reste propre et le CRLF ne
 * vit que dans la copie de travail — jusqu'à casser un test qui lit les octets bruts
 * (`moteur-perime-cablage.test.ts` sur `App.tsx`, réécrit ainsi par conv-817 le 23/09 à 19:13:13).
 * La leçon existait en prose dans le Brain ; elle n'a pas tenu. Ce garde refuse le geste.
 *
 * PORTÉE VOLONTAIREMENT ÉTROITE : seule une écriture EN MODE TEXTE, SANS `newline=` explicite, dans
 * du code Python RÉELLEMENT LANCÉ par la commande. Passent : `newline=''`, le binaire (`'wb'`), les
 * lectures, `codecs.open` (binaire sous le capot), un mode non littéral (on ne devine pas), et toute
 * simple MENTION (`grep "open(p,'w')"`, message de commit) où Python n'est pas lancé.
 *
 * CONTRAINTE : fonction AUTOPORTÉE (aucun import, aucune aide hors d'elle) — elle est sérialisée
 * telle quelle dans le script de hook du CLI (`scriptHookGardes`).
 */
export function refusEcriturePythonCrlf(commande: string): string | undefined {
  const c = String(commande ?? '')
  if (!/(open|write_text)\s*\(/.test(c)) return undefined
  // Python LANCÉ : en position de commande (début, après ; & | ( ou saut de ligne), avec chemin,
  // guillemets ou `.exe` éventuels. Dans `git commit -m "… python open(…)"`, il n'est que cité. Un
  // `\|` est une alternative de motif (`grep "a\|python3 -"`), pas un enchaînement : il ne compte pas
  // (rejeu du 2026-10-01 sur 7 340 commandes réelles).
  const lance =
    /(?:^|[\n;&(]|(?<!\\)\|)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:sudo|env|exec|time)\s+)?["']?(?:[^\s"';&|<>]*[\\/])?(?:python(?:\d+(?:\.\d+)?)?|py)(?:\.exe)?["']?(?=\s|$)/i
  if (!lance.test(c)) return undefined

  /** Arguments d'un appel, depuis la parenthèse ouvrante, jusqu'à sa fermante (guillemets respectés). */
  const argumentsDe = (debut: number): string => {
    let profondeur = 1
    let q: string | null = null
    let i = debut
    for (; i < c.length && profondeur > 0; i++) {
      const ch = c[i]
      if (q) {
        if (ch === '\\') i++
        else if (ch === q) q = null
        continue
      }
      if (ch === '"' || ch === "'") q = ch
      else if (ch === '(') profondeur++
      else if (ch === ')') profondeur--
    }
    return c.slice(debut, profondeur === 0 ? i - 1 : i)
  }
  /** Découpe au premier niveau, sur les virgules (guillemets et parenthèses respectés). */
  const decouper = (args: string): string[] => {
    const parts: string[] = []
    let courant = ''
    let profondeur = 0
    let q: string | null = null
    for (let i = 0; i < args.length; i++) {
      const ch = args[i]
      if (q) {
        courant += ch
        if (ch === '\\' && i + 1 < args.length) courant += args[++i]
        else if (ch === q) q = null
        continue
      }
      if (ch === '"' || ch === "'") q = ch
      else if ('([{'.includes(ch)) profondeur++
      else if (')]}'.includes(ch)) profondeur--
      if (ch === ',' && profondeur === 0) {
        parts.push(courant.trim())
        courant = ''
      } else courant += ch
    }
    if (courant.trim()) parts.push(courant.trim())
    return parts
  }
  const litteral = (texte: string | undefined): string | undefined => {
    const m = /^[rRbBuU]*(['"])(.*)\1$/s.exec((texte ?? '').trim())
    return m ? m[2] : undefined
  }

  const fautif: string[] = []
  const appel = /(\b[A-Za-z_][A-Za-z0-9_]*\s*\.\s*|\)\s*\.\s*)?\b(open|write_text)\s*\(/g
  let m: RegExpExecArray | null
  while ((m = appel.exec(c))) {
    const prefixe = (m[1] ?? '').replace(/\s+/g, '')
    const fonction = m[2]
    const args = decouper(argumentsDe(appel.lastIndex))
    const nomme = (cle: string): string | undefined =>
      args.find((a) => new RegExp(`^${cle}\\s*=`).test(a))?.replace(/^[^=]*=\s*/, '')
    const positionnels = args.filter((a) => !/^[A-Za-z_][A-Za-z0-9_]*\s*=/.test(a))
    // Un `newline=` LITTÉRAL explicite ('' , '\n', '\r\n') est un choix assumé : il passe.
    if (litteral(nomme('newline')) !== undefined) continue
    if (fonction === 'write_text') {
      fautif.push('Path.write_text()')
      continue
    }
    // open(p, mode) natif ou io.open ; Path(...).open(mode) : le mode est le PREMIER argument.
    const module = prefixe.replace(/\.$/, '')
    let mode: string | undefined
    if (!prefixe || module === 'io') mode = nomme('mode') ?? positionnels[1] ?? "'r'"
    else if (/^(codecs|os|gzip|bz2|lzma|tarfile|zipfile|webbrowser|shelve|dbm|wave)$/.test(module))
      continue
    else mode = nomme('mode') ?? positionnels[0] ?? "'r'"
    const valeur = litteral(mode)
    // Mode non littéral (variable) : on ne devine pas.
    if (valeur === undefined || !/^[rwaxbt+]+$/.test(valeur)) continue
    if (/[wax+]/.test(valeur) && !valeur.includes('b')) fautif.push(`open(…, '${valeur}')`)
  }
  if (fautif.length === 0) return undefined
  return (
    `Écriture de fichier par Python en mode texte refusée (${fautif[0]} sans newline=) : sous Windows, ` +
    `Python remplace chaque \\n par \\r\\n à l'écriture. Mesuré le 2026-10-01 : 47 fichiers de ` +
    `D:\\AutoWinOS réécrits ainsi en CRLF, invisibles à git status, et un test rouge ` +
    `(moteur-perime-cablage.test.ts sur App.tsx). Voie à suivre : modifie le fichier avec l'outil ` +
    `d'édition (Edit / Write), qui garde ses fins de ligne. Si Python est indispensable : ` +
    `open(p, 'w', encoding='utf8', newline='') ou p.write_text(s, encoding='utf8', newline=''), ` +
    `ou une écriture binaire ('wb').`
  )
}
