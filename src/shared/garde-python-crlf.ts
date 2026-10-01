import { decouperHeredocs } from './heredocs'

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
 * lectures, `codecs.open` (binaire sous le capot), un mode non littéral (on ne devine pas), toute
 * simple MENTION (`grep "open(p,'w')"`, message de commit) où Python n'est pas lancé, et le corps d'un
 * heredoc de simple texte (`cat > f <<'EOF' … EOF`) que ni Python ni un shell n'exécute ensuite.
 *
 * CONTRAINTE : fonction AUTOPORTÉE — elle est sérialisée telle quelle dans le script de hook du CLI
 * (`scriptHookGardes`). Le découpage des heredocs, partagé, lui est PASSÉ (`decouper`) : le script
 * le lui donne explicitement (`decoupeHeredocs`), jamais par un appel direct (voir
 * `src/shared/heredocs.ts`).
 */
export function refusEcriturePythonCrlf(
  commande: string,
  decoupeHeredocs: typeof decouperHeredocs = decouperHeredocs
): string | undefined {
  const brut = String(commande ?? '')
  if (!/(open|write_text)\s*\(/.test(brut)) return undefined
  // Python LANCÉ : en position de commande (début, après ; & | ( ou saut de ligne), avec chemin,
  // guillemets ou `.exe` éventuels. Dans `git commit -m "… python open(…)"`, il n'est que cité. Un
  // `\|` est une alternative de motif (`grep "a\|python3 -"`), pas un enchaînement : il ne compte pas
  // (rejeu du 2026-10-01 sur 7 340 commandes réelles). Un mot-clé du shell (`do`, `then`, `if`…) garde
  // la position de commande : `for f in a b; do python - "$f" <<'PY'` lance Python (rejeu du
  // 2026-10-01 sur 3 134 commandes : seul le terminateur `PY`, lu comme le lanceur `py`, la refusait).
  const lance =
    /(?:^|[\n;&(]|(?<!\\)\|)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:sudo|env|exec|time|nohup|do|then|else|elif|if|while|until|!|\{)\s+)*["']?(?:[^\s"';&|<>]*[\\/])?(?:python(?:\d+(?:\.\d+)?)?|py)(?:\.exe)?["']?(?=\s|$)/i
  /** Un shell lancé, qui peut à son tour lancer Python. */
  const lanceShell =
    /(?:^|[\n;&(]|(?<!\\)\|)\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*(?:(?:sudo|env|exec|time|nohup|do|then|else|elif|if|while|until|!|\{)\s+)*["']?(?:[^\s"';&|<>]*[\\/])?(?:bash|sh|zsh|dash|ksh|source|\.)(?:\.exe)?["']?(?=\s|$)/i

  // CORPS DE HEREDOC : une DONNÉE, sauf s'il est exécuté. Vécu le 2026-10-01 (conv-770) :
  // `cat > sonde.cjs <<'EOF'` dont le TEXTE contenait `; python - <<'E'` et `open(p,'w')`, suivi de
  // `node sonde.cjs`, était refusé alors que Python n'était jamais lancé. Le corps reste lu comme du
  // code quand le tube qui le reçoit lance Python ou un shell (`python - <<E`, `cat <<E | python -`,
  // `bash <<E`), ou quand le fichier qu'il écrit est ensuite exécuté (`python f`, `bash f`, `./f`).
  // Un `<<E` sans ligne terminatrice n'est pas un heredoc (`python -c "s='<<E'"`) : rien n'est retiré.
  // Le découpage est PARTAGÉ avec les autres gardes du hook (`src/shared/heredocs.ts`).
  const { lignes, heredocs } = decoupeHeredocs(brut)
  const dansUnCorps = new Set<number>()
  for (const h of heredocs) for (let j = h.debut; j < h.fin; j++) dansUnCorps.add(j)
  const horsCorps = (depuis: number): string =>
    lignes.filter((_, j) => j >= depuis && !dansUnCorps.has(j)).join('\n')
  const executes = new Set<number>()
  /** Python lancé sans que son nom figure dans la commande : `./m.py` exécute un fichier écrit. */
  let pythonParLeFichier = false
  for (const h of heredocs) {
    let execute = lance.test(h.tube) || lanceShell.test(h.tube)
    const nom = h.cible && !/^\/dev\//.test(h.cible) ? h.cible.split(/[\\/]/).pop() : undefined
    if (!execute && nom) {
      const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const cite = new RegExp(`(?:^|[\\s"'=\\\\/])${echappe}(?=["']?(?:\\s|$))`)
      const enTete = new RegExp(`^\\s*["']?(?:[^\\s"'<>|]*[\\\\/])?${echappe}["']?(?=\\s|$)`)
      for (const morceau of `${h.reste}\n${horsCorps(h.fin + 1)}`.split(/[\n;&]/)) {
        if (!cite.test(morceau)) continue
        const direct = enTete.test(morceau)
        if (!direct && !lance.test(morceau) && !lanceShell.test(morceau)) continue
        execute = true
        const premiere = lignes[h.debut] ?? ''
        if (direct && (/\.py$/i.test(nom) || /^#!.*python/i.test(premiere)))
          pythonParLeFichier = true
        break
      }
    }
    if (execute) for (let j = h.debut; j < h.fin; j++) executes.add(j)
  }
  /** Une ligne terminatrice (`PY`, `EOF`) n'est pas une commande : `PY` n'est pas le lanceur `py`. */
  const terminateurs = new Set(heredocs.map((h) => h.fin))
  /** La commande, sans le corps des heredocs de simple texte ni leurs terminateurs. */
  const c = lignes
    .map((l, j) => (terminateurs.has(j) || (dansUnCorps.has(j) && !executes.has(j)) ? '' : l))
    .join('\n')
  if (!pythonParLeFichier && !lance.test(c)) return undefined

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
