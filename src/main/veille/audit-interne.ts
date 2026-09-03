/**
 * AUDIT INTERNE — des candidats de correction tirés d'Autowin lui-même, pas d'un changelog concurrent.
 *
 * Pourquoi ce module existe : la colonne « Corrections & autres » de la veille était alimentée par les
 * corrections de bugs DES CONCURRENTS, lues dans leurs changelogs. Proposer de corriger un bug qu'on
 * n'a pas n'a aucun sens — le modèle de candidat le dit déjà pour les ajouts, la remarque valait aussi
 * pour les corrections. Cette colonne doit lister ce qui cloche ICI.
 *
 * Deux règles de conception, tirées des défauts réellement vécus le 2026-08-13 :
 *
 *  1. **Déterministe, jamais un avis.** Chaque détecteur répond par oui/non sur du texte du dépôt, et
 *     produit une CITATION : le fichier, la ligne, et la ligne recopiée. C'est la même exigence de
 *     preuve que la veille impose à une entrée de changelog, et elle vaut mieux ici encore : un
 *     candidat sans ancrage est une opinion, et une opinion ne se corrige pas.
 *
 *  2. **Les classes détectées sont celles qui ont mordu.** Aucune n'est inventée pour faire nombre :
 *     un composant jamais monté (deux tours de travail dépensés à aligner une vue invisible), un canal
 *     IPC sans appelant (« exposé mais jamais appelé »), un garde-fou qui lit un fichier supprimé (il
 *     jette au lieu de vérifier), une assertion neutralisée par un octet de contrôle (`not.toMatch`
 *     toujours vrai), une classe CSS écrite par le JSX sans aucune règle (boutons au style par défaut
 *     du navigateur), un `Date.now()` pendant le rendu (deux mémoïsations annulées).
 *
 * Ce module est PUR : il reçoit les fichiers déjà lus, ne touche ni au disque ni au réseau, et se
 * teste sans Electron.
 */

/** Un fichier du dépôt, tel que l'appelant l'a lu. Chemin RELATIF à la racine, séparateurs `/`. */
export interface FichierAudite {
  chemin: string
  contenu: string
}

/** Ce qu'un détecteur trouve, avant d'être transformé en candidat. */
export interface ConstatInterne {
  /** Identifiant de la classe de défaut — sert de clé stable et de libellé de regroupement. */
  classe:
    | 'composant-jamais-monte'
    | 'canal-ipc-sans-appelant'
    | 'garde-sur-fichier-absent'
    | 'assertion-neutralisee'
    | 'classe-css-sans-regle'
    | 'impurete-au-rendu'
  titre: string
  /** `fichier:ligne` — l'ancrage vérifiable, à la place de l'URL d'une source web. */
  ancrage: string
  /** La ligne RECOPIÉE du dépôt. C'est elle qu'un vérificateur rejoue. */
  citation: string
  /** Ce que ça coûte à l'usage, en une phrase — sert à juger la valeur. */
  consequence: string
  /** Effort estimé, en tranches assumées : une estimation fine serait une fausse précision. */
  effort: 'petit' | 'moyen' | 'gros'
  /** Valeur : ce que la correction rapporte réellement. */
  valeur: 'faible' | 'moyenne' | 'forte'
}

const VALEURS = { faible: 30, moyenne: 65, forte: 95 } as const
const EFFORTS = { petit: 1, moyen: 1.6, gros: 2.6 } as const

/**
 * SCORE valeur/effort, 0-100, dans le champ `pertinence` du modèle de candidat.
 *
 * Deux tranches et une division, délibérément : un score à deux chiffres calculé depuis des
 * heuristiques donnerait une fausse précision — un /100 est un JUGEMENT, pas une mesure. Ce que la
 * formule garantit, c'est un ORDRE utile : à valeur égale, le moins coûteux passe devant.
 */
export function scoreValeurEffort(constat: Pick<ConstatInterne, 'valeur' | 'effort'>): number {
  return Math.round(VALEURS[constat.valeur] / EFFORTS[constat.effort])
}

function lignes(contenu: string): string[] {
  return contenu.split(/\r?\n/)
}

/**
 * Une ligne de COMMENTAIRE n'est pas du code.
 *
 * Constaté à la deuxième passe : ce module s'est signalé LUI-MÊME, parce qu'un de ses commentaires
 * cite un `ipcMain.handle` en exemple. Un détecteur qui lit les commentaires invente des défauts à
 * partir de prose — et c'est précisément ce qui remplit une colonne de bruit.
 */
function estCommentaire(ligne: string): boolean {
  return /^\s*(\/\/|\/\*|\*)/.test(ligne)
}

/**
 * Une ligne ENTIEREMENT contenue dans une chaine est un FIXTURE, pas du code executé.
 *
 * Constaté a la troisieme passe, et encore sur ce module : son propre fichier de tests contient
 * `"  const css = readFileSync(new URL('./Disparue.css', …))"` comme DONNEE d'entree. Le detecteur
 * y voyait trois lectures de fichiers absents. Un fixture commence par un guillemet — c'est
 * grossier, mais c'est vrai, et ca vaut mieux qu'un detecteur qui invente trois defauts.
 */
function estFixture(ligne: string): boolean {
  return /^\s*['"`]/.test(ligne)
}

/** Numéro de ligne (1-indexé) du premier motif trouvé, et la ligne elle-même. */
function trouver(
  fichier: FichierAudite,
  predicat: (ligne: string) => boolean
): { ligne: number; texte: string } | undefined {
  const tab = lignes(fichier.contenu)
  for (let i = 0; i < tab.length; i += 1) {
    if (predicat(tab[i])) return { ligne: i + 1, texte: tab[i].trim() }
  }
  return undefined
}

/**
 * Composant de vue présent dans le dépôt mais monté par AUCUN fichier.
 *
 * Vécu : `WorktreeMapView` est restée dans le dépôt sans être branchée, deux garde-fous la
 * surveillaient, et deux tours de travail y ont été dépensés avant qu'on remarque que l'écran ne
 * changeait pas. Le coût d'un composant mort n'est pas nul : il fait mentir ce qui l'entoure.
 */
export function detecterComposantsJamaisMontes(fichiers: FichierAudite[]): ConstatInterne[] {
  const vues = fichiers.filter((f) =>
    /^src\/renderer\/src\/components\/[A-Z]\w*View\.tsx$/.test(f.chemin)
  )
  const constats: ConstatInterne[] = []
  for (const vue of vues) {
    const nom = vue.chemin.split('/').pop()!.replace('.tsx', '')
    // Monté = un autre fichier NON-test écrit `<Nom ` ou `<Nom/`.
    const monte = fichiers.some(
      (f) =>
        f.chemin !== vue.chemin &&
        !/\.test\.tsx?$/.test(f.chemin) &&
        new RegExp(`<${nom}[\\s/>]`).test(f.contenu)
    )
    if (monte) continue
    const ancre = trouver(vue, (l) => l.includes(`export function ${nom}`))
    if (!ancre) continue
    constats.push({
      classe: 'composant-jamais-monte',
      titre: `${nom} n'est monté par aucune vue`,
      ancrage: `${vue.chemin}:${ancre.ligne}`,
      citation: ancre.texte,
      consequence:
        'Le composant est maintenu, testé et modifié sans jamais atteindre un écran : tout travail dessus est invisible, et les garde-fous qui le surveillent ne protègent rien.',
      effort: 'petit',
      valeur: 'moyenne'
    })
  }
  return constats
}

/**
 * Canal IPC déclaré côté main sans aucun appelant côté renderer.
 *
 * Vécu : `git:worktreeMap` est resté atteignable après la suppression de son unique consommateur.
 * Une surface IPC que personne n'appelle est une surface d'attaque et une promesse morte.
 */
export function detecterCanauxIpcSansAppelant(fichiers: FichierAudite[]): ConstatInterne[] {
  const constats: ConstatInterne[] = []
  const preload = fichiers.filter((f) => f.chemin.startsWith('src/preload/'))
  // Les APPELANTS possibles ne sont pas que les vues : les scripts de pilotage CDP consomment
  // legitimement des canaux (`captureTestPage`, `appState`, `fabricNodes` — verifie : 5, 5 et 1
  // script les appellent). Les traiter en code mort aurait propose de supprimer la surface de test
  // de l'app. Appelant = tout fichier qui n'est ni le main ni le preload.
  const appelants = fichiers.filter(
    (f) => !f.chemin.startsWith('src/main/') && !f.chemin.startsWith('src/preload/')
  )
  // Les TESTS sont exclus : un enregistrement de canal y apparait comme fixture, pas comme canal
  // reel. Sans cette exclusion, la premiere passe sortait 17 constats dont 17 faux — mesure faite
  // avant d'y croire, et c'est exactement le bruit que l'utilisateur a appele « a chier ».
  for (const f of fichiers.filter(
    (x) => x.chemin.startsWith('src/main/') && !/\.test\.tsx?$/.test(x.chemin)
  )) {
    for (const [i, ligne] of lignes(f.contenu).entries()) {
      if (estCommentaire(ligne)) continue
      const canal = /ipcMain\.handle\(\s*'([^']+)'/.exec(ligne)?.[1]
      // Un nom INTERPOLE (`${channel}`) n'est pas un canal : on ne peut rien conclure, donc on se tait.
      if (!canal || canal.includes('${')) continue
      // Le preload est le SEUL pont : si aucun `invoke('canal')` n'y figure, rien ne peut l'appeler.
      const pontee = preload.some((p) => p.contenu.includes(`'${canal}'`))
      if (!pontee) {
        constats.push({
          classe: 'canal-ipc-sans-appelant',
          titre: `Le canal IPC ${canal} n'est ponté par aucun preload`,
          ancrage: `${f.chemin}:${i + 1}`,
          citation: ligne.trim(),
          consequence:
            "Le canal est enregistré au démarrage et joignable, mais aucun code du renderer ne peut l'atteindre : c'est du code mort qui élargit la surface exposée.",
          effort: 'petit',
          valeur: 'moyenne'
        })
        continue
      }
      // Ponté mais jamais consommé : la fonction du preload existe et personne ne l'appelle.
      const nomExpose = preload
        .flatMap((p) => lignes(p.contenu))
        .find((l) => l.includes(`'${canal}'`) && /^\s*(\w+):/.test(l))
      const nom = nomExpose ? /^\s*(\w+):/.exec(nomExpose)?.[1] : undefined
      // `.nom(` NE SUFFIT PAS : l'app appelle massivement en chaînage optionnel — `window.api?.nom?.()`.
      // La première passe a donc signalé `getPreflight`, `pickGitRepo` et `getWorktreeStatus` comme
      // jamais appelés alors qu'ils le sont. Vérifié un par un avant d'y croire : 3 faux sur 10.
      const appele =
        nom &&
        appelants.some((r) => r.contenu.includes(`.${nom}(`) || r.contenu.includes(`.${nom}?.(`))
      if (nom && !appele) {
        constats.push({
          classe: 'canal-ipc-sans-appelant',
          titre: `L'API ${nom} (canal ${canal}) n'est appelée par aucune vue`,
          ancrage: `${f.chemin}:${i + 1}`,
          citation: ligne.trim(),
          consequence:
            "L'API est exposée au renderer et jamais consommée : « atteignable en IPC mais jamais appelé » est du théâtre, et son coût de maintenance est réel.",
          effort: 'petit',
          valeur: 'faible'
        })
      }
    }
  }
  return constats
}

/**
 * Test qui lit un fichier ABSENT du dépôt.
 *
 * Vécu : un garde-fou gardait un sélecteur mort dans `WorktreeMapView.css` après la suppression de la
 * feuille. Il ne vérifiait plus une interdiction — il jetait.
 */
export function detecterGardesSurFichierAbsent(fichiers: FichierAudite[]): ConstatInterne[] {
  const existants = new Set(fichiers.map((f) => f.chemin))
  const constats: ConstatInterne[] = []
  for (const f of fichiers.filter((x) => /\.test\.tsx?$/.test(x.chemin))) {
    const dossier = f.chemin.slice(0, f.chemin.lastIndexOf('/'))
    for (const [i, ligne] of lignes(f.contenu).entries()) {
      if (estCommentaire(ligne) || estFixture(ligne)) continue
      const cible = /['"`]\.\/([\w./-]+\.(?:css|tsx?|md))['"`]/.exec(ligne)?.[1]
      if (!cible) continue
      if (!/readFileSync|existsSync|source\(/.test(ligne)) continue
      const chemin = `${dossier}/${cible}`
      if (existants.has(chemin)) continue
      constats.push({
        classe: 'garde-sur-fichier-absent',
        titre: `Un test lit ${cible}, qui n'existe plus`,
        ancrage: `${f.chemin}:${i + 1}`,
        citation: ligne.trim(),
        consequence:
          "Le test jette au lieu de vérifier son invariant : il rougit pour une raison qui n'a rien à voir avec ce qu'il garde, et on apprend à ignorer son échec.",
        effort: 'petit',
        valeur: 'forte'
      })
    }
  }
  return constats
}

/**
 * Assertion neutralisée par un octet de contrôle brut dans une expression régulière.
 *
 * Vécu : un vrai BACKSPACE (0x08) écrit à la place de l'échappement `\b` rendait un `not.toMatch`
 * toujours vrai. Le test était vert et ne vérifiait rien depuis son écriture.
 */
export function detecterAssertionsNeutralisees(fichiers: FichierAudite[]): ConstatInterne[] {
  // Classe construite depuis les CODES : écrire ces octets en clair dans un fichier source serait
  // reproduire le défaut qu'on traque, et `no-control-regex` a raison de l'interdire.
  const controle = new RegExp(
    `[${[8, 9, 11, 12, 27].map((c) => `\\u${c.toString(16).padStart(4, '0')}`).join('')}]`
  )
  const constats: ConstatInterne[] = []
  for (const f of fichiers.filter((x) => /\.(test\.tsx?|ts|tsx)$/.test(x.chemin))) {
    for (const [i, ligne] of lignes(f.contenu).entries()) {
      if (estCommentaire(ligne)) continue
      if (!controle.test(ligne)) continue
      if (!/toMatch|test\(|exec\(|RegExp|\/[^/]*\//.test(ligne)) continue
      constats.push({
        classe: 'assertion-neutralisee',
        titre: `Un octet de contrôle brut neutralise une expression régulière`,
        ancrage: `${f.chemin}:${i + 1}`,
        // La citation est rendue LISIBLE : recopier l'octet le propagerait dans ce fichier.
        citation: ligne.trim().replace(controle, '<octet de contrôle>'),
        consequence:
          "L'expression cherche un caractère qui n'apparaît dans aucun DOM ni aucune source : un `not.toMatch` passe donc toujours, et l'assertion ne vérifie rien.",
        effort: 'petit',
        valeur: 'forte'
      })
    }
  }
  return constats
}

/**
 * Classe CSS écrite par un composant et stylée par aucune feuille qu'il importe.
 *
 * Vécu : les quatre classes du bloc « Réponse annulée » n'avaient aucune règle — les boutons
 * retombaient sur le style par défaut du navigateur, au milieu d'une vue soignée.
 */
export function detecterClassesCssSansRegle(fichiers: FichierAudite[]): ConstatInterne[] {
  const feuilles = fichiers.filter((f) => f.chemin.endsWith('.css'))
  const toutLeCss = feuilles.map((f) => f.contenu).join('\n')
  const constats: ConstatInterne[] = []
  const dejaVu = new Set<string>()
  for (const f of fichiers.filter(
    (x) =>
      x.chemin.startsWith('src/renderer/') && /\.tsx$/.test(x.chemin) && !/\.test\./.test(x.chemin)
  )) {
    for (const [i, ligne] of lignes(f.contenu).entries()) {
      // Uniquement les className LITTÉRALES : une classe calculée n'est pas décidable ici, et
      // signaler ce qu'on ne peut pas prouver ferait exactement le bruit qu'on veut éviter.
      if (estCommentaire(ligne)) continue
      const litteral = /className="([^"{}]+)"/.exec(ligne)?.[1]
      if (!litteral) continue
      const surLaLigne = litteral.trim().split(/\s+/).filter(Boolean)
      const stylee = (c: string): boolean => new RegExp(`\\.${c}(?=[\\s,:{[)>])`).test(toutLeCss)
      /**
       * L'ÉLÉMENT est-il stylé, et non « cette classe a-t-elle une règle » ?
       *
       * Erreur de la version précédente, et elle comptait : `className="domain-badge-alert
       * nav-alert-badge"` était signalé pour `nav-alert-badge`, alors que `.domain-badge-alert` est
       * stylé — l'élément a donc son apparence, et la seconde classe n'est qu'un CROCHET (test,
       * ciblage, marqueur sémantique). Idem pour `tnum run-cost-uncosted`, `btn
       * delete-confirm-cancel run-delete-cancel`, `directive-queue-send directive-queue-btw`.
       *
       * Le défaut réel — celui vécu sur « Réponse annulée » — c'est un élément dont AUCUNE classe
       * n'est stylée : lui seul retombe sur le style par défaut du navigateur.
       */
      if (surLaLigne.some(stylee)) continue
      for (const classe of surLaLigne) {
        if (dejaVu.has(classe)) continue
        // Les classes utilitaires courtes (`row`, `gap2`) vivent dans des feuilles globales.
        if (classe.length < 6 || !classe.includes('-')) continue
        if (stylee(classe)) continue
        dejaVu.add(classe)
        constats.push({
          classe: 'classe-css-sans-regle',
          titre: `La classe ${classe} est écrite par le JSX et stylée par aucune feuille`,
          ancrage: `${f.chemin}:${i + 1}`,
          citation: ligne.trim(),
          consequence:
            "L'élément retombe silencieusement sur le style par défaut du navigateur : rien ne casse, aucun test ne rougit, et le rendu détonne à l'écran.",
          effort: 'petit',
          valeur: 'moyenne'
        })
      }
    }
  }
  return constats
}

/**
 * Appel impur pendant le rendu d'un composant.
 *
 * Vécu : `const maintenant = Date.now()` dans le corps d'un composant, passé en dépendance de deux
 * `useMemo` — les mémoïsations ne mémoïsaient rien et l'affichage bougeait à chaque rendu.
 */
export function detecterImpuretesAuRendu(fichiers: FichierAudite[]): ConstatInterne[] {
  const constats: ConstatInterne[] = []
  for (const f of fichiers.filter(
    (x) =>
      x.chemin.startsWith('src/renderer/') && /\.tsx$/.test(x.chemin) && !/\.test\./.test(x.chemin)
  )) {
    for (const [i, ligne] of lignes(f.contenu).entries()) {
      // `const x = Date.now()` à DEUX espaces d'indentation = corps de composant, pas un callback
      // (indenté plus profond) ni une constante de module (colonne 0).
      if (!/^ {2}const \w+ = Date\.now\(\)/.test(ligne)) continue
      constats.push({
        classe: 'impurete-au-rendu',
        titre: `Un Date.now() est appelé pendant le rendu de ${f.chemin.split('/').pop()}`,
        ancrage: `${f.chemin}:${i + 1}`,
        citation: ligne.trim(),
        consequence:
          'La valeur change à chaque rendu : toute mémoïsation qui en dépend est annulée, et les durées affichées bougent sans raison. `eslint` le signale déjà à chaque exécution.',
        effort: 'moyen',
        valeur: 'moyenne'
      })
    }
  }
  return constats
}

/** Tous les détecteurs, dans l'ordre où ils sont utiles à lire. */
const DETECTEURS = [
  detecterGardesSurFichierAbsent,
  detecterAssertionsNeutralisees,
  detecterComposantsJamaisMontes,
  detecterCanauxIpcSansAppelant,
  detecterClassesCssSansRegle,
  detecterImpuretesAuRendu
] as const

/**
 * Passe d'audit complète : tous les détecteurs, triés par score décroissant.
 *
 * Le tri est le livrable autant que la liste : une colonne de vingt constats non ordonnés est ce que
 * l'utilisateur a appelé « à chier ». À valeur égale, le moins coûteux d'abord.
 */
export function auditerDepot(fichiers: FichierAudite[]): (ConstatInterne & { score: number })[] {
  return DETECTEURS.flatMap((d) => d(fichiers))
    .map((c) => ({ ...c, score: scoreValeurEffort(c) }))
    .sort((a, b) => b.score - a.score || a.ancrage.localeCompare(b.ancrage))
}

/**
 * Les constats d'audit, au format d'entrée de la veille — donc rangés dans la MÊME colonne, triés
 * par le même code, dédupliqués par la même clé.
 *
 * Le modèle de candidat était pensé pour une page web ; il accueille un défaut interne sans être
 * modifié, et chaque champ garde son sens :
 *   `concurrent` → le produit concerné, ici Autowin OS lui-même ;
 *   `url`        → l'ancrage `fichier:ligne`, qui joue exactement le rôle de l'URL : où aller voir ;
 *   `citation`   → la ligne fautive recopiée, que le vérificateur rejoue ;
 *   `pertinence` → le score valeur/effort.
 *
 * `dateSource` est la date de la PASSE et non celle du défaut : un défaut de code n'a pas de date de
 * publication, et inventer celle du dernier commit ferait passer une supposition pour un fait.
 */
export function candidatsDepuisAudit(
  constats: readonly (ConstatInterne & { score: number })[],
  maintenant: string
): {
  concurrent: string
  titre: string
  url: string
  dateSource: string
  citation: string
  type: 'correction'
  pertinence: number
  consequence: string
}[] {
  return constats.map((c) => ({
    concurrent: PRODUIT_INTERNE,
    titre: c.titre,
    url: c.ancrage,
    // La date de la passe, tronquée au jour : la journée suffit à situer, et l'heure donnerait une
    // fausse précision sur un défaut qui existait sans doute bien avant.
    dateSource: maintenant.slice(0, 10),
    citation: c.citation,
    type: 'correction' as const,
    pertinence: c.score,
    consequence: c.consequence
  }))
}

/**
 * Nom porté par les candidats internes dans la colonne, à la place d'un concurrent.
 *
 * Exporté, et non recopié : la vue et les tests le comparent pour distinguer « ce que fait un
 * concurrent » de « ce qui cloche chez nous », et deux littéraux finiraient par diverger.
 */
export const PRODUIT_INTERNE = 'Autowin OS'
