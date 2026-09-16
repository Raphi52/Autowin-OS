/**
 * GARDE : UN `git reset --hard` N'EFFACE PAS LE TRAVAIL EN COURS DE L'UTILISATEUR.
 *
 * Mesure conv-587 (2026-09-16, saisie ts=1789550244094) : pour nettoyer un `git revert -n` d'essai,
 * l'agent a lance `git reset --hard`. La commande porte sur TOUT l'arbre de travail : elle a detruit
 * trois fichiers modifies non commites et sans rapport avec la tache (skills/kaizen/SKILL.md,
 * src/main/providers/claude.ts, src/main/providers/claude-bin-resolution.test.ts). Perte
 * IRREVERSIBLE : `git fsck --lost-found` n'a rendu aucun blob correspondant, aucun revert ne repare.
 *
 * La constitution l'interdit deja en prose — et la prose n'a pas tenu. Ce garde refuse le geste
 * AVANT qu'il parte, et NOMME la voie recuperable.
 *
 * PORTEE VOLONTAIREMENT ETROITE : seules les formes qui effacent l'arbre ENTIER sont refusees.
 * `git checkout HEAD -- <chemin>`, `git restore <chemin>`, `git revert --abort` restent libres :
 * ce sont precisement les sorties de secours proposees.
 *
 * CONTRAINTE : fonction AUTOPORTEE (aucun import) — elle est serialisee telle quelle dans le script
 * de hook du CLI, comme `refusLancementGraphique`.
 */
export function refusGitDestructeur(commande: string): string | undefined {
  const c = String(commande ?? '')
  if (!c.trim()) return undefined
  const motif = (quoi: string, voie: string): string =>
    `Effacement du travail en cours refusé (${quoi}) : cette commande porte sur TOUT l'arbre de travail ` +
    `et supprime définitivement les fichiers modifiés non commités, y compris ceux qui n'ont rien à voir ` +
    `avec ta tâche (mesuré conv-587 : 3 fichiers perdus, irrécupérables). ` +
    `Voie récupérable : ${voie}. ` +
    `Si l'effacement large est vraiment voulu, demande-le à l'utilisateur en nommant ce qui disparaît.`

  for (const brut of c.split(/;|&&|\|\||\||\r?\n/)) {
    const seg = brut.trim().replace(/^&\s*/, '')
    if (!/^git\b/i.test(seg)) continue
    // La SOUS-COMMANDE, pas un mot quelconque de la ligne : `git log -S "reset --hard"` cherche du
    // texte, il n'efface rien. Les options globales (-C <chemin>, -c k=v, --no-pager) sont sautees.
    const mots = seg.split(/\s+/).slice(1)
    let i = 0
    while (i < mots.length && /^-/.test(mots[i])) {
      i += /^(-C|-c|--git-dir|--work-tree|--exec-path)$/i.test(mots[i]) ? 2 : 1
    }
    const sous = (mots[i] ?? '').toLowerCase()
    const reste = mots.slice(i + 1)
    const a = (re: RegExp): boolean => reste.some((m) => re.test(m))
    // 1. reset --hard : git refuse de toute facon `reset --hard <chemin>`, la portee est l'arbre entier.
    if (sous === 'reset' && a(/^--hard$/i)) {
      return motif(
        'git reset --hard',
        'git revert --abort, git stash, ou git checkout HEAD -- <chemin>'
      )
    }
    // 2. checkout/restore de l'arbre entier : le dernier argument vise tout (`.`, `:/`, `*`).
    if (
      (sous === 'checkout' || sous === 'restore') &&
      /^(\.|:\/|\*)$/.test(reste[reste.length - 1] ?? '')
    ) {
      return motif(
        "rétablissement de tout l'arbre",
        'vise le seul fichier concerné : git checkout HEAD -- <chemin>'
      )
    }
    // 3. clean -f : les fichiers non suivis n'ont AUCUN objet git, rien ne les recupere.
    if (sous === 'clean' && a(/^-[a-z]*f/i) && !a(/^(-n|--dry-run)$/i)) {
      return motif('git clean', "git clean -n d'abord, puis supprime nommément ce que tu as vérifié")
    }
  }
  return undefined
}
