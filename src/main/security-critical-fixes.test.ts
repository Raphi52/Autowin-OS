import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'

/** Chemin lisible dans un message d'échec : `src/main/...` plutôt qu'un absolu illisible. */
const entreeCourte = (chemin: string): string => relative(__dirname, chemin).replace(/\\/gu, '/')
import { loadTokens, saveTokens, type Tokens, type TokenVault } from './providers/codex-auth'

const dir = mkdtempSync(join(tmpdir(), 'secfix-'))
const authPath = join(dir, 'auth.json')
afterEach(() => {
  try {
    rmSync(authPath)
  } catch {
    /* absent */
  }
})

describe('critique #1 — persistance auth.json durcie', () => {
  const tok: Tokens = { accessToken: 'a', refreshToken: 'r', obtainedAt: 1, expiresInSec: 3600 }
  const secrets = new Map<string, string>()
  const vault: TokenVault = {
    get: (account) => secrets.get(account) ?? null,
    set: (account, value) => {
      secrets.set(account, value)
    }
  }

  it('save→load chiffre toujours les tokens sur disque, meme hors Electron', () => {
    const secret: Tokens = {
      ...tok,
      accessToken: 'SECRET_NE_DOIT_PAS_ETRE_EN_CLAIR'
    }
    saveTokens(secret, authPath, vault)
    expect(readFileSync(authPath).includes(Buffer.from(secret.accessToken))).toBe(false)
    expect(loadTokens(authPath, vault)).toEqual(secret)
  })

  it('migre un ancien fichier EN CLAIR (legacy) au chargement', () => {
    writeFileSync(authPath, JSON.stringify(tok, null, 2), 'utf8')
    expect(loadTokens(authPath, vault)).toEqual(tok) // lu + re-sauvé (migration best-effort)
  })

  it('fichier absent → null', () => {
    expect(loadTokens(join(dir, 'nope.json'))).toBeNull()
  })
})

describe('critique #2 — handlers IPC agentiques gardés', () => {
  const source = readFileSync(join(__dirname, 'index.ts'), 'utf8')
  const guarded = (channel: string): boolean => {
    const marker = `'${channel}'`
    const start = source.indexOf(marker)
    if (start < 0) return false
    const next = source.indexOf('ipcMain.handle(', start + marker.length)
    const block = source.slice(start, next < 0 ? source.length : next)
    // Un canal peut garder EN DÉLÉGUANT : `app:storage-migration` construit son handler par une
    // fabrique à laquelle on PASSE `assertTrustedRendererSender`, appelé en première ligne du
    // handler produit (`renderer-storage-migration.ts:23`). N'accepter que l'appel littéral
    // déclarait ce canal NON gardé alors qu'il l'est — un faux rouge, et un faux rouge finit par
    // décrédibiliser tout le fichier. On exige donc que le garde soit bien celui-là, pas n'importe
    // quelle fonction : il doit apparaître en argument de la fabrique.
    return (
      /assertTrustedRendererSender\(\s*event/.test(block) ||
      /createStorageMigrationReadHandler\([^)]*assertTrustedRendererSender/.test(block)
    )
  }
  it.each([
    // critiques
    'os:orchestrate',
    'os:pilotChat',
    'os:providerLogin',
    // hautes/moyennes (audit #3) : config + lectures fichier + brain
    'os:setRole',
    'os:topology:set',
    'os:profiles:apply',
    'os:profiles:save',
    'os:conversations:remove',
    'os:conversations:rename',
    'os:openFolder',
    'os:revealFile',
    'os:appCommand',
    'os:pilotChat:cancel',
    'os:pilotChat:resume',
    'os:orchestrate:cancel',
    'os:pilotChat:inject',
    'os:setActiveConversation',
    'os:causalTrace:displayed',
    'os:promptCalls',
    'os:causalTrace',
    'os:brainTraces',
    'os:runTrace',
    'os:loadBrainGraph',
    'os:readNodeFile',
    'app:storage-migration'
  ])('%s appelle assertTrustedRendererSender', (channel) => {
    expect(guarded(channel)).toBe(true)
  })

  it('couvre exhaustivement tous les ipcMain.handle exposes au renderer', () => {
    const handlers = [...source.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)]
    const unguarded = handlers.flatMap((match, index) => {
      const block = source.slice(match.index, handlers[index + 1]?.index ?? source.length)
      const channel = match[1]
      // La fabrique doit recevoir LE garde, pas seulement exister : accepter
      // `/createStorageMigrationReadHandler/` NU rendait cette variante plus LAXISTE que `guarded()`
      // ci-dessus — et c'est celle-ci qui porte la garantie de sécurité. Signalé par un audit externe.
      const genericGuard =
        /assertTrusted(?:Renderer|Behaviour)Sender\(\s*event/.test(block) ||
        /createStorageMigrationReadHandler\([^)]*assertTrustedRendererSender/.test(block) ||
        // Handler enregistré hors `index.ts` : le garde y est INJECTÉ (`deps.assertTrusted`), et le
        // site d'injection est vérifié séparément par le test « hors index.ts » plus bas.
        /\bassertTrusted\(\s*event/.test(block)
      const specializedGuard =
        (channel === 'app:storage-migration-complete' &&
          /isTrustedRendererUrl\(event\.senderFrame/.test(block)) ||
        (channel === 'model:question:answer' &&
          /questionWindows\.get\(event\.sender\.id\)/.test(block))
      return genericGuard || specializedGuard ? [] : [channel]
    })

    // `unguarded` porte la garantie de SÉCURITÉ ; le compte n'est qu'un fil-piège qui force une
    // relecture explicite à chaque nouveau canal exposé.
    //
    // RESYNCHRONISÉ le 2026-08-12, et il faut dire pourquoi : le littéral valait 128 alors que la
    // source en comptait déjà 135 AU COMMIT MÊME qui l'a figé (3855638, « checkpoint: consolidate
    // autowin dogfood improvements »). Ce test était donc rouge dès sa naissance et n'a jamais
    // passé — un fil-piège qu'on ne regarde plus ne protège rien. Ne pas chercher une dérive de
    // 9 canaux : il n'y en a eu que DEUX depuis, les deux ci-dessous, et `unguarded` est resté vide
    // sur toute la période (vérifié en rejouant la même détection sur les deux révisions).
    //
    // Les deux canaux ajoutés depuis, tous deux gardés en première ligne :
    //   `os:workflowProfiles:notice`            — lecture de la boîte de refus de workflow
    //   `os:workflowProfiles:acknowledgeNotice` — accusé de réception, id validé en entier sûr
    //
    // MISE À JOUR 2026-08-13 — 137 → 138. Cette fois le littéral était JUSTE à sa pose (vérifié :
    // au commit e9075c0, source = 137). UN seul canal est apparu depuis, et il est gardé dès sa
    // première ligne :
    //   `git:graph` — lecture du graphe git pour la vue Worktrees
    // `unguarded` est resté VIDE sur toute la période : aucune régression de sécurité, seulement
    // le fil-piège qui a fait son travail en réclamant cette relecture.
    //
    // MISE À JOUR 2026-08-13 — 138 → 140. DEUX canaux ajoutés, tous deux gardés dès leur première
    // ligne par `assertTrustedRendererSender(event, 'Pilote de routage shadow')` :
    //   `os:shadowRoutingPilot:get` — lecture de l'opt-in persistant du pilote de routage shadow
    //   `os:shadowRoutingPilot:set` — bascule de cet opt-in, valeur refusée si non booléenne
    // `unguarded` reste VIDE.
    //
    // MISE A JOUR 2026-08-14 — 140 → 134. Six canaux sans consommateur ont été retirés avec leurs
    // ponts preload : `git:brainRoot`, les deux `os:workflowSelection:*`, `os:fabric:pair`,
    // `os:restoreKnowledge` et `os:appCatalog`. Leurs services internes encore actifs restent testés.
    // `unguarded` reste VIDE : la réduction de surface ne relâche aucun garde.
    // MISE A JOUR 2026-08-17 — 134 → 135. Un canal AJOUTÉ : `worktree:preserve-release`, qui libère
    // une copie d'agent en PRÉSERVANT son travail dans `autowin/recovery/<id>` avant suppression.
    // Il existe parce que `worktree:discard-held`, seule voie exposée jusque-là, supprime SANS
    // préserver — inutilisable pour un ménage à l'initiative de l'utilisateur : 11 des copies
    // mesurées ce jour-là portaient des fichiers non committés. Il porte son garde
    // (`assertTrustedRendererSender`) et valide son argument par expression régulière, donc
    // `unguarded` reste VIDE : la surface grandit d'un canal, aucune garantie ne faiblit.
    // MISE A JOUR 2026-08-20 — 135 → 136. UN canal ajoute (commit d813b245, « un tour fantome ne
    // peut plus rendre une conversation muette ») : `os:pilotChat:active`, qui dit si un tour de chat
    // est encore actif pour une conversation. Il porte `assertTrustedRendererSender` des sa PREMIERE
    // ligne et valide son argument par `guardString` — relu ligne a ligne, `unguarded` reste VIDE.
    //
    // A noter pour la prochaine fois : le compte est assert AVANT `unguarded`, donc un fil-piege qui
    // saute masque la garantie de securite au lieu de la reveler. Le compte a echoue ici sans qu'on
    // sache, jusqu'a relecture manuelle, si un canal etait non garde.
    //
    // MISE A JOUR 2026-08-21 — 136 -> 138. DEUX canaux ajoutes par la vue Accueil, et la relecture a
    // ete faite AVANT de toucher le compte, dans cet ordre precis puisque le fichier previent lui-meme
    // du piege :
    //   `outlook:snapshot` — lecture SEULE du profil Outlook local (messages et rendez-vous) ;
    //   `outlook:ouvrir`   — ouvre UN element dans Outlook, par son identifiant.
    // Les deux portent `assertTrustedRendererSender(event, 'Outlook')` des leur PREMIERE ligne, et
    // `outlook:ouvrir` valide son identifiant par expression reguliere des DEUX cotes de la frontiere
    // (ici et dans le script PowerShell). Ils sont deliberement SEPARES : lire n'est pas agir, et la
    // garantie « lecture seule » de la passerelle est ce qui rend cette integration acceptable.
    // `unguarded` reste VIDE.
    //
    // MISE A JOUR 2026-08-23 — 138 -> 140. DEUX canaux ajoutes, et la relecture a ete faite AVANT de
    // toucher le compte, comme ce fichier le reclame lui-meme :
    //   `worktree:travaux-non-publies` — liste des travaux termines mais jamais publies, avec leurs
    //     fichiers. Lecture SEULE, sans argument.
    //   `worktree:patch-non-publie`    — le patch d'un de ces travaux, pour le lire avant d'en
    //     decider. Lecture SEULE.
    // Les deux portent `assertTrustedRendererSender` des leur PREMIERE ligne. Le second valide son
    // argument DEUX fois : type `string` ici, puis expression reguliere `SAFE_ID` dans le
    // gestionnaire de copies avant toute interpolation dans une commande git.
    //
    // POURQUOI ces canaux existent : le 2026-08-23, 14 travaux termines attendaient sur des branches
    // `autowin/recovery/`, et AUCUNE vue ne les montrait -- la seule qui porte des actions ne connait
    // que les bureaux vivants, et affichait « 0 bureau ». La seule option offerte etait donc de
    // fusionner ou supprimer A L'AVEUGLE. Ces deux canaux ne font que MONTRER, et c'est deliberement
    // tout ce qu'ils font : aucun ne mute quoi que ce soit.
    // `unguarded` reste VIDE.
    //
    // MISE A JOUR 2026-08-25 — 140 -> 141. UN canal ajoute, relu AVANT de toucher le compte, comme
    // ce fichier le reclame :
    //   `os:moteur:etat` — le processus principal qui tourne contient-il encore les sources ?
    //     Lecture SEULE, SANS ARGUMENT (donc aucune surface d'injection), et sa reponse ne porte
    //     qu'un booleen, un chemin RELATIF au projet et une duree. Il ne lit que les DATES de
    //     `src/main` et `src/preload` — jamais le contenu d'un fichier, jamais un chemin fourni par
    //     l'appelant. En mode empaquete il rend immediatement « non perime » sans toucher au disque.
    //     Il porte `assertTrustedRendererSender(event, 'Etat du moteur')` des sa PREMIERE ligne, et
    //     toute exception y est ravalee en « non perime » : un pied de page ne fait pas tomber l'app.
    //
    // POURQUOI ce canal existe : mesure du 2026-08-25, `electron-vite dev` ne reconstruit PAS le
    // processus principal, donc un correctif reste invisible dans l'application qui tourne sans que
    // rien ne le signale -- deux conclusions fausses ont ete tirees d'un binaire perime dans la
    // meme journee. Il ne fait que MONTRER, et c'est deliberement tout ce qu'il fait.
    // `unguarded` reste VIDE.
    //
    // MISE A JOUR 2026-08-27 — 141 -> 143. Le litteral etait DEJA desynchronise de 1 avant ce
    // changement (la source en comptait 142 : la detection du test compte aussi une occurrence que
    // le releve manuel avait manquee ; `unguarded` etait et reste VIDE, la garantie de securite
    // n'a jamais bouge). UN canal ajoute ici, relu avant de toucher le compte :
    //   `os:revealFile` — ouvre un fichier CITE par un agent dans le markdown du chat. La cible
    //     brute est RE-PARSEE cote main (`parseFileRef`), resolue contre la racine du workspace
    //     (`resolveFileRef`) et REFUSEE si elle sort de cette racine ou n'existe pas : le renderer
    //     n'est jamais cru sur un chemin. Il porte `assertTrustedRendererSender` des sa premiere
    //     ligne. Aucune ecriture, aucune execution : `shell.openPath`, sinon revelation dans
    //     l'explorateur.
    expect(handlers).toHaveLength(143)
    expect(unguarded).toEqual([])
  })

  it('ne laisse AUCUN canal hors d’index.ts échapper au garde', () => {
    // Le fil-piège ci-dessus ne lit QUE `index.ts` : deux canaux réels vivaient ailleurs
    // (`workflow-bench-ipc.ts`, exposés par `preload/index.ts`) et étaient donc invisibles au compte
    // comme à la détection. Ils sont gardés — mais rien ne l'imposait, et le compte « 138 » décrivait
    // une surface de 140. Signalé par un audit externe. On DÉCOUVRE désormais les fichiers au lieu de
    // les énumérer : un canal ajouté dans un nouveau fichier est couvert sans qu'on y pense.
    const racine = __dirname
    const fichiers: string[] = []
    const explorer = (dossier: string): void => {
      for (const entree of readdirSync(dossier, { withFileTypes: true })) {
        const chemin = join(dossier, entree.name)
        if (entree.isDirectory()) explorer(chemin)
        else if (
          entree.isFile() &&
          entree.name.endsWith('.ts') &&
          !entree.name.includes('.test.') &&
          entree.name !== 'index.ts'
        ) {
          const contenu = readFileSync(chemin, 'utf8')
          if (/ipcMain\.handle\(\s*['"]/.test(contenu)) fichiers.push(chemin)
        }
      }
    }
    explorer(racine)

    const nonGardes = fichiers.flatMap((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      const trouves = [...contenu.matchAll(/ipcMain\.handle\(\s*['"]([^'"]+)['"]/g)]
      return trouves.flatMap((match, index) => {
        const bloc = contenu.slice(match.index, trouves[index + 1]?.index ?? contenu.length)
        // Garde direct OU garde INJECTÉ (`deps.assertTrusted(event, …)`).
        const garde =
          /assertTrusted(?:Renderer|Behaviour)Sender\(\s*event/.test(bloc) ||
          /\bassertTrusted\(\s*event/.test(bloc)
        return garde ? [] : [`${entreeCourte(chemin)}:${match[1]}`]
      })
    })
    expect(nonGardes).toEqual([])

    // Et le site d'INJECTION doit passer LE VRAI garde : un `assertTrusted` injecté ne vaut que la
    // fonction qu'on lui donne, et injecter un `() => {}` passerait la vérification ci-dessus.
    // On exige donc que CHAQUE clé `assertTrusted:` d'`index.ts` délègue à `assertTrustedRendererSender`
    // — formulation qui ne devine aucun nom de fabrique (ma première version attrapait le premier
    // `export function` du fichier, soit `overrideFor`, qui n'enregistre rien : un test faux).
    // FENÊTRE autour de l'injection, et non un segment coupé à la virgule : la forme
    // `assertTrusted: (event, label) => assertTrustedRendererSender(event, label)` contient une
    // virgule DANS ses paramètres, ce qui tronquait la capture à `(event` — un faux rouge.
    const injections = [...source.matchAll(/assertTrusted:/g)].map((m) =>
      source.slice(m.index, (m.index ?? 0) + 160)
    )
    expect(injections.length, 'aucune injection trouvée : ce test mentirait').toBeGreaterThan(0)
    for (const fenetre of injections) {
      expect(fenetre, 'un garde injecté doit déléguer au vrai garde').toMatch(
        /assertTrustedRendererSender/
      )
    }
  })

  it('exige un conversationId avant toute lecture Brain', () => {
    const start = source.indexOf("'os:brainTraces'")
    const next = source.indexOf('ipcMain.handle(', start + 1)
    const block = source.slice(start, next)
    expect(block).toMatch(/guardString\(rawConversationId, 'conversationId'\)/)
    expect(block).not.toMatch(/readBrainTraces\([^)]*undefined/)
  })

  it('invalide tous les workers et le coordinateur apres toute mutation du Brain', () => {
    const helperStart = source.indexOf('const invalidateBrainRuntime')
    const helperEnd = source.indexOf('// Conversations persist', helperStart)
    const helper = source.slice(helperStart, helperEnd)
    expect(helper).toMatch(/brainSearchCoordinator\.invalidate\(\)/)
    expect(helper).toMatch(/brainWorker\.invalidate\(\)/)
    expect(helper).toMatch(/brainSearchWorker\.invalidate\(\)/)
    expect(helper).toMatch(/brainInboxWorker\.invalidate\(\)/)

    for (const channel of ['os:promoteInbox', 'os:rejectInbox', 'os:refreshBrain']) {
      const start = source.indexOf(`'${channel}'`)
      const next = source.indexOf('ipcMain.handle(', start + 1)
      expect(source.slice(start, next), channel).toMatch(/await invalidateBrainRuntime\(\)/)
    }
  })

  it('execute la collecte inbox dans un worker dedie et borne', () => {
    const start = source.indexOf("'os:listInbox'")
    const next = source.indexOf('ipcMain.handle(', start + 1)
    const block = source.slice(start, next)
    expect(block).toMatch(/async\s*\(event/)
    expect(block).toMatch(/brainInboxWorker\.requestWithTimeout\(/)
    expect(block).toMatch(/'listInbox'/)
    expect(block).not.toMatch(/listInboxCandidates\(/)
  })

  it('autorise le vault dans le worker borne avant tout retrieval global', () => {
    const start = source.indexOf("'os:searchBrain'")
    const next = source.indexOf('ipcMain.handle(', start + 1)
    const block = source.slice(start, next)
    expect(block).toMatch(/authorize:\s*\(root\).*?requestWithTimeout\(/s)
    expect(block).toMatch(/'authorizeVault'/)
    expect(block.indexOf('authorize:')).toBeLessThan(block.indexOf('retrieve:'))
  })
})

describe('haute — loadBrainGraph confine la lecture fichier (audit #3)', () => {
  it('un fichier graphe hors racine légitime est REFUSÉ', async () => {
    const { loadBrainGraph } = await import('./viz/fs-brains')
    const outside = join(mkdtempSync(join(tmpdir(), 'evil-')), 'graph.json')
    writeFileSync(outside, JSON.stringify({ nodes: [{ id: 'x' }], links: [] }), 'utf8')
    expect(() => loadBrainGraph(outside)).toThrow(/hors périmètre/)
    rmSync(outside)
  })
})
