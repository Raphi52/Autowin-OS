/**
 * LES HEREDOCS D'UNE COMMANDE SHELL : où commence et finit chaque corps, qui le reçoit, où il écrit.
 *
 * Un corps de heredoc est du TEXTE tant que rien ne l'exécute. Rejeu du 2026-10-01 des gardes du hook
 * sur 29 371 commandes Bash réelles : des refus venaient du seul TEXTE d'un heredoc — un
 * `cat > src/shared/garde-git-destructeur.ts <<'EOF'` dont le commentaire cite `git reset --hard`, un
 * `cat >> …porte-prod.test.ts <<'EOF'` et un `git commit -F - <<'EOF'` qui nomment `sqlcmd`, un
 * `cat > sonde.cjs <<'EOF'` qui contient `; python - <<'E'` et `open(p,'w')`.
 *
 * CONTRAINTE : fonctions AUTOPORTÉES, sérialisées dans le script du hook du CLI (`scriptHookGardes`).
 * Celles qui ont besoin du découpage le reçoivent EN PARAMÈTRE (`decoupeHeredocs`, par défaut
 * `decouperHeredocs`) : le script le leur passe explicitement. Un appel direct par nom ne survit pas à
 * la sérialisation — mesuré le 2026-10-01, vitest réécrit l'appel importé en
 * `__vi_import_0__.decouperHeredocs(...)`, introuvable dans le script : le hook plantait.
 */
export interface Heredoc {
  /** Première ligne du corps (index dans `lignes`). */
  debut: number
  /** Ligne terminatrice (`EOF`, `PY`…). */
  fin: number
  /** Le morceau de la ligne, entre deux `;` ou `&`, qui porte `<<` : ce qui reçoit le corps. */
  tube: string
  /** La suite de la ligne après ce tube (`; ./m.py`, `&& python f`). */
  reste: string
  /** Le fichier écrit par `>`, `>>` ou `tee`, s'il y en a un. */
  cible?: string
}

/** Découpe les heredocs ; un `<<E` sans ligne terminatrice n'en est pas un (`python -c "s='<<E'"`). */
export function decouperHeredocs(commande: string): { lignes: string[]; heredocs: Heredoc[] } {
  const lignes = String(commande ?? '').split('\n')
  const heredocs: Heredoc[] = []
  for (let i = 0; i < lignes.length; i++) {
    const ligne = lignes[i]
    let suivante = i + 1
    const operateur = /(?<!<)<<(?!<)(-?)\s*(["']?)([A-Za-z_][A-Za-z0-9_]*)\2/g
    let o: RegExpExecArray | null
    while ((o = operateur.exec(ligne))) {
      const tabulations = o[1] === '-'
      const delimiteur = o[3]
      let fin = -1
      for (let j = suivante; j < lignes.length && fin < 0; j++) {
        const l = lignes[j].replace(/\r$/, '')
        if ((tabulations ? l.replace(/^\t+/, '') : l) === delimiteur) fin = j
      }
      if (fin < 0) continue
      const avant = ligne.slice(0, o.index)
      const apres = ligne.slice(o.index)
      const finDuTube = apres.split(/[;&]/)[0]
      const tube =
        avant.slice(Math.max(avant.lastIndexOf(';'), avant.lastIndexOf('&')) + 1) + finDuTube
      const cible = /(?:(?<![0-9&>])>>?|\btee\s+(?:-a\s+)?)\s*(["']?)([^\s"'<>|;&]+)\1/.exec(
        tube
      )?.[2]
      heredocs.push({ debut: suivante, fin, tube, reste: apres.slice(finDuTube.length), cible })
      suivante = fin + 1
    }
    i = suivante - 1
  }
  return { lignes, heredocs }
}

/**
 * La commande SANS le corps (ni la ligne terminatrice) des heredocs qui ne sont qu'une DONNÉE, pour
 * les gardes qui lisent la commande comme du shell (git destructeur, réglages prod, clients SQL).
 *
 * Un corps n'est une donnée que si TOUT ce qui le reçoit est un simple lecteur de texte (`cat`, `tee`,
 * `git commit -F -`, `wc`, `grep`…) ET que le fichier qu'il écrit n'est ensuite repris que par des
 * commandes qui n'exécutent rien (`git add`, `wc -l`, `ls`…). Tout le reste — `bash <<E`,
 * `sqlcmd <<E`, `node <<E`, `cat <<E | sh`, `cat > f.mjs <<E` puis `node f.mjs` — garde son corps :
 * dans le doute, la garde le lit.
 */
export function sansHeredocsDeDonnees(
  commande: string,
  decoupeHeredocs: typeof decouperHeredocs = decouperHeredocs
): string {
  const brut = String(commande ?? '')
  const { lignes, heredocs } = decoupeHeredocs(brut)
  if (heredocs.length === 0) return brut
  const prefixe = String.raw`^\s*(?:[A-Za-z_][A-Za-z0-9_]*=\S*\s+)*`
  const lecteur = new RegExp(
    prefixe +
      String.raw`(?:cat|tee|wc|sort|uniq|head|tail|grep|egrep|fgrep|rg|jq|base64|md5sum|sha1sum|sha256sum|tr|cut|git(?:\s+-C\s+\S+)*\s+(?:commit|tag|notes))(?=\s|$)`
  )
  const sansExecution = new RegExp(
    prefixe +
      String.raw`(?:cat|tee|wc|sort|uniq|head|tail|grep|egrep|fgrep|rg|jq|ls|stat|file|du|od|xxd|diff|cp|mv|rm|chmod|touch|git)(?=\s|$)`
  )
  const dansUnCorps = new Set<number>()
  for (const h of heredocs) for (let j = h.debut; j < h.fin; j++) dansUnCorps.add(j)
  const retires = new Set<number>()
  for (const h of heredocs) {
    // Chaque élément du tube (séparé par `|`, `$(` ou `(`) doit être un simple lecteur.
    const elements = h.tube
      .split(/\|(?!\|)|\$\(|\(/)
      .map((e) => e.trim())
      .filter(Boolean)
    if (!elements.every((e) => lecteur.test(e))) continue
    const nom = h.cible && !/^\/dev\//.test(h.cible) ? h.cible.split(/[\\/]/).pop() : undefined
    if (nom) {
      const echappe = nom.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      const cite = new RegExp(`(?:^|[\\s"'=\\\\/])${echappe}(?=["']?(?:\\s|$))`)
      const suite = [h.reste, ...lignes.filter((_, j) => j > h.fin && !dansUnCorps.has(j))].join(
        '\n'
      )
      const repris = suite
        .split(/[\n;&|]/)
        .some((morceau) => cite.test(morceau) && !sansExecution.test(morceau))
      if (repris) continue
    }
    for (let j = h.debut; j <= h.fin; j++) retires.add(j)
  }
  if (retires.size === 0) return brut
  return lignes.map((l, j) => (retires.has(j) ? '' : l)).join('\n')
}
