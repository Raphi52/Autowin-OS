import { describe, expect, it, afterEach } from 'vitest'
import { readFileSync, readdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { sourceProcessPrincipal } from './source-process-principal.test-helpers'

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
  /*
   * « source » = LE PROCESS PRINCIPAL, pas `index.ts` seul.
   *
   * Les canaux sortent progressivement d'`index.ts` vers `src/main/ipc/` (voix neuronale et
   * enregistrements parles le 2026-09-02). Compter dans `index.ts` seul ferait BAISSER la surface
   * mesuree a chaque demenagement, et un canal deplace echapperait au fil-piege sans que personne
   * ne le voie : exactement l'angle mort que ce controle existe pour fermer.
   */
  const source = sourceProcessPrincipal()
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
    //
    // MISE A JOUR 2026-08-28 — 143 -> 147. QUATRE canaux ajoutes, relus AVANT de toucher le compte :
    //   `tests:projects` / `tests:saveProjects` / `tests:pickProject` / `tests:run` — le registre
    //     des projets de la vue Tests et le lancement de leur verification declaree ; plus
    //     `os:conversations:removeMany` (suppression en lot, meme garde que le canal unitaire).
    //     Tous portent `assertTrustedRendererSender` des leur PREMIERE ligne. `tests:run` ne CROIT
    //     PAS la racine recue : elle doit correspondre EXACTEMENT a un projet deja enregistre
    //     (`loadTestProjects().find`), sinon le canal jette — aucune commande n'est construite
    //     depuis une chaine libre du renderer. `tests:pickProject` n'ouvre qu'un selecteur de
    //     dossier natif, sans argument. `os:conversations:removeMany` valide chaque identifiant
    //     par `guardString`.
    // `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    //
    // MISE A JOUR 2026-08-28 (2) — 147 -> 148. UN canal ajoute, relu AVANT de toucher le compte :
    //   `perf:turnLatency` — onglet Latence de la vue Tests. LECTURE SEULE d'un seul fichier de
    //     donnees de l'app (`<appdata>/turn-timing.jsonl`, ecrit par `turn-timing.ts`). Aucun
    //     chemin ne vient du renderer : son unique argument est un NOMBRE de lignes, plafonne par
    //     `Math.floor` et retombant sur 200 si ce n'est pas un nombre positif. Il porte
    //     `assertTrustedRendererSender(event, 'PerfTurnLatency')` des sa PREMIERE ligne. Aucune
    //     ecriture, aucune execution.
    //
    // MISE A JOUR 2026-08-28 (3) — 148 -> 149. UN canal ajoute, relu AVANT de toucher le compte :
    //   `perf:gels` — section « Gels du process principal » de l'onglet Latence. LECTURE SEULE d'un
    //     seul fichier de donnees de l'app (`<appdata>/gels.jsonl`, ecrit par le battement de
    //     `gel-main.ts`). Aucun chemin ne vient du renderer : son unique argument est un NOMBRE de
    //     lignes, plafonne par `Math.floor` et retombant sur 200 si ce n'est pas un nombre positif.
    //     Il porte `assertTrustedRendererSender(event, 'PerfGels')` des sa PREMIERE ligne. Aucune
    //     ecriture, aucune execution.
    // MISE A JOUR 2026-08-31 — 149 -> 151. Le compte etait DEJA en derive avant ce tour : la
    //   branche portait 150 handlers pour un inventaire fige a 149, un canal ayant ete ajoute
    //   sans que ce compteur soit touche. La garde forte, elle, n a jamais cede : la liste des
    //   canaux NON gardes est restee vide, donc aucun canal sans garde n a ete expose. Le 151e
    //   est ajoute ici, relu AVANT de toucher le compte :
    //   perf:gelRenderer — depot d un gel du thread d interface dans le journal commun
    //     gels.jsonl. Son unique argument est un NOMBRE de millisecondes, plancher a zero et
    //     tronque par Math.floor ; aucun chemin, aucune chaine ne vient du renderer. Il porte
    //     assertTrustedRendererSender(event, 'PerfGelRenderer') des sa PREMIERE ligne.
    //     L ecriture va au seul puits d observabilite existant, best-effort, jamais bloquante.
    // MISE A JOUR 2026-08-31 (2) — 151 -> 154. TROIS canaux ajoutes, relus AVANT de toucher le
    //   compte : la reconnaissance vocale LOCALE de Jarvis (whisper.cpp), rendue necessaire parce
    //   que `webkitSpeechRecognition` rend le code d erreur `network` sur cette application —
    //   MESURE, capture datee du 2026-08-31 citee dans l en-tete de `whisper-local.ts` ; le micro
    //   s ouvrait et rien n etait jamais reconnu. La CAUSE de ce code n est pas etablie ici.
    //   os:whisper:etat — LECTURE SEULE de deux chemins fixes sous `userData` (le modele et la
    //     CLI). Aucun argument ne vient du renderer.
    //   os:whisper:installer — telechargement EXPLICITE, declenche par un clic, vers deux URL
    //     CONSTANTES du module (`MODELE_WHISPER.url`, `BINAIRE_WHISPER.url`) : le renderer ne
    //     fournit ni URL, ni chemin, ni nom de fichier. L installation est serialisee cote main.
    //   os:whisper:transcrire — recoit des OCTETS (un WAV), jamais un chemin : le fichier est
    //     ecrit par le main dans un dossier temporaire qu il cree et supprime lui-meme, et la
    //     taille est plafonnee a 8 Mo. Aucune chaine du renderer n entre dans la ligne de commande.
    //   Les trois portent `assertTrustedRendererSender` des leur PREMIERE ligne.
    // MISE A JOUR 2026-09-01 — 154 -> 156. DEUX canaux ajoutes, relus AVANT de toucher le compte :
    //   os:conversations:searchContent — LECTURE SEULE en memoire. Recherche litterale d un terme
    //     dans les messages deja charges (`conversations.rechercherParContenu`) : aucun chemin,
    //     aucune commande, aucune ecriture. Son unique argument est une chaine, ignoree si elle est
    //     vide, et le nombre de resultats est plafonne cote store (max 5000). Il porte
    //     `assertTrustedRendererSender(event, 'Conversations content search')` des sa PREMIERE ligne.
    //   os:saisie:journaliser — AJOUT d une ligne au seul journal de saisies de l app
    //     (`<appdata>/saisies-utilisateur.jsonl`, chemin CONSTANT calcule cote main). Le renderer ne
    //     fournit ni chemin ni nom de fichier : trois chaines validees par `guardString`, et la voie
    //     doit valoir exactement `message` ou `orientation`, sinon le canal rend `{ ok: false }`.
    //     L ecriture est best-effort et ne leve jamais. Il porte
    //     `assertTrustedRendererSender(event, 'User input journal')` des sa PREMIERE ligne.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-01 (2) — 156 -> 161. CINQ canaux ajoutes, relus AVANT de toucher le
    //   compte : les enregistrements parles (widget « Enregistrements »). Le texte dicte ne
    //   s ecrivait NULLE PART — il vivait en memoire de fenetre, plafonne a 40 lignes, perdu au
    //   rechargement. Le dossier cible est CONSTANT cote main
    //   (`dossierTranscripts(app.getPath('userData'))`) et aucun canal n accepte de chemin :
    //   os:transcript:demarrer — cree un fichier dont le NOM est calcule cote main a partir de
    //     l horloge. Aucun argument ne vient du renderer.
    //   os:transcript:ajouter — ajoute une ligne. Deux chaines : un identifiant de session opaque,
    //     qui doit exister dans la table cote main (sinon l appel leve), et le texte dicte. Le
    //     chemin ecrit vient de cette table, jamais du renderer.
    //   os:transcript:terminer — retire la session de la table. Rien n est ecrit.
    //   os:transcript:lister — LECTURE SEULE du dossier constant, filtree aux `.txt`.
    //   os:transcript:revealer — met un fichier en evidence dans l explorateur, et UNIQUEMENT un
    //     fichier deja rendu par `lister` : le chemin recu est compare a cette liste, jamais
    //     utilise tel quel.
    //   Les cinq portent `assertTrustedRendererSender` des leur PREMIERE ligne.
    // MISE A JOUR 2026-09-02 — 161 -> 165. QUATRE canaux ajoutes, relus AVANT de toucher le
    //   compte, et TOUS portent `assertTrustedRendererSender` des leur PREMIERE ligne :
    //   os:conversationFileTraces — LECTURE SEULE des traces de fichiers d'une conversation. Le
    //     seul argument est un identifiant valide par `guardString`, et il ne touche AUCUN chemin :
    //     `readConversationFileTraces` lit TROIS fichiers constants du spool
    //     (`events.jsonl`, `events.previous.jsonl`, `events.archive.jsonl`) puis filtre EN MEMOIRE
    //     sur `trace.conversationId`. Aucune traversee possible.
    //   os:piper:etat — sans argument. Rend l'etat d'installation de la voix neuronale locale.
    //   os:piper:installer — sans argument. Telecharge la voix et le binaire depuis des URL
    //     CONSTANTES cote main (`VOIX_PIPER.url`, `BINAIRE_PIPER.url` dans `piper-local.ts`) vers
    //     un dossier calcule cote main : la fenetre ne fournit ni adresse ni destination.
    //   os:piper:parler — une chaine validee par `guardString`, plafonnee a 1 000 caracteres, puis
    //     prononcee en local. Aucune ecriture, aucun chemin, aucun reseau a l'usage.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-02 — 165 -> 164. AUCUN canal supprime : `tickets:people` a REJOINT ses
    //   six freres dans `tickets-ipc.ts`, ou il s'enregistre par l'`ipc` INJECTE. Ce fil-piege
    //   compte les `ipcMain.handle` de la zone du process principal, il ne le voit donc plus. Il
    //   n'echappe pas au controle pour autant : le scan ci-dessous, elargi dans le meme
    //   changement, couvre desormais AUSSI les enregistrements par `ipc` injecte — ce qui ferme
    //   au passage un angle mort ANTERIEUR de 16 canaux (tickets, task-manager, veille).
    // MISE A JOUR 2026-09-03 — 164 -> 165. UN canal ajoute, garde des sa PREMIERE ligne par
    //   `assertTrustedRendererSender(event, 'Reglages micro')` :
    //   `os:micro:reglages` — ouvre la page micro de Windows. Il ne prend AUCUNE url : l'adresse
    //     est une constante ecrite cote main, la fenetre ne peut que la declencher.
    //   `unguarded` reste VIDE.
    // MISE A JOUR 2026-09-04 — 165 -> 167. DEUX canaux, tous deux gardes des leur PREMIERE ligne :
    //   `outlook:repondre` — arrive avec la tuile Interlocuteurs (commit 51f65bb7) SANS que ce compte
    //     soit remis a jour : le fil-piege etait donc rouge avant ce changement, sur 166. Il ECRIT
    //     (envoie une reponse), l'identifiant et le corps sont valides cote main, et le corps part
    //     par un fichier temporaire — jamais concatene dans une ligne de commande.
    //   `outlook:marquer-lu` — marque des messages comme lus. Ecrit aussi dans la boite, et rien n'en
    //     sort : chaque identifiant est valide contre `^[0-9A-Fa-f]{16,512}$` cote main AVANT de
    //     partir dans un appel COM, et ils voyagent par un fichier temporaire.
    //   `unguarded` reste VIDE.
    // MISE A JOUR 2026-09-05 - 170 -> 172. DEUX canaux, arrives avec la bascule de branche
    //   depuis la barre du chat (commit 058bd531), tous deux gardes des leur PREMIERE ligne
    //   par `assertTrustedRendererSender` (`src/main/ipc/git.ts:43` et `:51`) :
    //   `git:branches` - LIT les branches locales du depot. Aucune ecriture. Le dossier recu est
    //     accepte seulement s'il est une chaine, sinon `process.cwd()`.
    //   `git:checkout` - bascule sur une branche LOCALE existante, REFUSEE si l'arbre de travail
    //     est sale. Le nom de branche n'est pas concatene dans une ligne de commande.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-06 - 174 -> 173. La surface RETRECIT, pour une fois :
    //   `app:test:seed-conversation-scope` est RETIRE. C'etait une fixture d'instance isolee, semant
    //   des traces de fichiers et de Brain pour la preuve d'isolation du panneau Source control. Sa
    //   sonde a ete retiree le meme jour — le panneau n'est plus un onglet, il s'ouvre par un noeud
    //   du graphe, donc la preuve n'avait plus de chemin d'acces —, et ce canal n'avait plus AUCUN
    //   appelant. Un canal IPC sans appelant reste une porte : on la ferme.
    // MISE A JOUR 2026-09-07 - 173 -> 174. UN canal ajoute, garde des sa PREMIERE ligne par
    //   `assertTrustedRendererSender(event, 'Outlook')` :
    //   `outlook:nouveau-message` - ENVOIE un message neuf depuis la tuile Interlocuteurs (adresse,
    //     objet, premier message). Il ECRIT et il SORT du poste. Contrairement a
    //     `outlook:repondre`, rien n'est herite d'un element existant : l'adresse vient d'une
    //     saisie. Elle est validee contre `^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}$` cote
    //     main ET dans le script, l'objet est ramene sur une ligne, et objet comme corps partent par
    //     des fichiers temporaires -- jamais concatenes dans une ligne de commande.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-07 - 174 -> 175. UN canal ajoute par le commit 803ac88c, garde des sa
    //   PREMIERE ligne par `assertTrustedRendererSender(event, 'Couleur des boutons de fenetre')` :
    //   `app:titlebar-symbol-color` - pose la couleur des boutons de fenetre pour que la barre de
    //     titre suive le theme. La valeur part vers une API NATIVE de Windows : elle n'est donc
    //     acceptee que sous la forme d'un hexadecimal strict (`^#[0-9a-fA-F]{6}$`), et la fenetre
    //     visee est celle de l'emetteur, jamais un identifiant fourni par le renderer.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-09 - 175 -> 177. DEUX canaux, mesures un par un en rejouant la MEME
    //   detection sur les revisions concernees (175 au commit 2c58539d qui a pose le litteral, 176
    //   avant le surlignage, 177 apres) : le fil-piege etait donc DEJA rouge a 176 avant ce
    //   changement, pour un canal qui n'avait pas ete inscrit. Les deux sont gardes des leur
    //   PREMIERE ligne :
    //   `worktree:rapport-retention` (commit 35d1f351, `src/main/ipc/worktree.ts:59`,
    //     `assertTrustedRendererSender(event, 'RapportRetention')`) - LIT le rapport du balayage de
    //     retention pour l'afficher. Aucune ecriture, aucun parametre recu.
    //   `os:conversations:setHighlight` (`src/main/ipc/conversations.ts:194`,
    //     `assertTrustedRendererSender(event, 'Conversations')`) - pose ou retire le repere visuel
    //     d'une conversation. Il ECRIT, mais rien ne SORT du poste : l'identifiant passe par
    //     `guardString`, et l'etat est ramene a un booleen strict (`rawOn === true`) - aucune valeur
    //     du renderer n'atteint le disque telle quelle, aucun chemin n'est construit depuis l'appel.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-10 - 177 -> 178. UN canal, garde des sa premiere ligne :
    //   `os:conversations:setClaudeAccount` (`src/main/ipc/conversations.ts`,
    //     `assertTrustedRendererSender(event, 'Conversations')`) - memorise le compte Claude
    //     d'UNE conversation. Il ECRIT, mais rien ne SORT du poste : l'identifiant et l'id de
    //     compte passent par `guardString`, `null` est le seul autre cas accepte, et aucun
    //     chemin n'est construit depuis l'appel (le dossier du compte est derive cote store).
    // MISE A JOUR 2026-09-12 - 178 -> 184. SIX canaux ajoutes, relus un par un AVANT de toucher le
    //   compte. Le fil-piege etait DEJA rouge avant ce tour : les six existaient sans que ce
    //   compteur soit repris. Tous portent `assertTrustedRendererSender` des leur PREMIERE ligne.
    //   QUATRE viennent de l'onglet « Files » du panneau de droite (`src/main/ipc/project-files.ts`) :
    //   `project:root` - rend la racine du projet courant. Aucune ecriture, aucun parametre recu.
    //   `project:list` - liste UN dossier. Le renderer n'envoie qu'un chemin RELATIF ; la racine
    //     vient du processus principal, jamais de l'appel.
    //   `project:read` - lit UN fichier texte sous cette racine (`guardString` sur le chemin).
    //   `project:write` - REMPLACE le contenu d'un fichier EXISTANT sous cette racine. Il ECRIT,
    //     mais rien ne SORT du poste : chemin et contenu passent par `guardString`, le chemin est
    //     resolu puis verifie sous la racine (un `..`, un chemin absolu ou un lien qui sort est
    //     refuse), et aucun fichier n'est cree.
    //   DEUX viennent de la diarisation locale (`src/main/ipc/diarisation.ts`) :
    //   `os:diarisation:etat` - LECTURE SEULE de la presence du modele. Aucun argument du renderer.
    //   `os:diarisation:installer` - telechargement EXPLICITE vers des URL CONSTANTES du module :
    //     le renderer ne fournit ni URL, ni chemin, ni nom de fichier.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-12 - 184 -> 185. UN canal ajoute par le commit 2d0bd9ca, relu AVANT de
    //   toucher le compte, garde des sa PREMIERE ligne par
    //   `assertTrustedRendererSender(event, 'ArenaDuelsParWorkflow')` :
    //   `arena:duelsParWorkflow` (`src/main/ipc/perf.ts`) - LECTURE SEULE des mesures de duels
    //     deja ecrites dans les donnees de l'application. Aucune ecriture, et rien ne sort du
    //     poste. Le renderer ne fournit AUCUN chemin ni chaine : son unique argument est un
    //     nombre, ramene a un entier strictement positif (`Math.floor`), 500 par defaut des qu'il
    //     n'est pas un nombre. La racine des donnees vient du processus principal.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-13 - 185 -> 187. DEUX canaux ajoutes par le commit c1faa566, relus AVANT
    //   de toucher le compte, gardes des leur PREMIERE ligne par `assertTrustedRendererSender` :
    //   `os:disk-usage` (index.ts) - LECTURE SEULE de l'inventaire du dossier de donnees deja
    //     calcule au demarrage. Aucun argument venant du renderer, aucune ecriture, rien ne sort
    //     du poste ; la racine des donnees vient du processus principal.
    //   `chat:orientations` (index.ts) - LECTURE SEULE des consignes deja journalisees pour UNE
    //     conversation. Son unique argument est rejete s'il n'est pas une chaine non vide.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-13 - 187 -> 188. UN canal ajoute par ce tour, garde des sa PREMIERE
    //   ligne par `assertTrustedRendererSender(event, 'Presence systeme des runs')` :
    //   `os:presence` (index.ts) - la fenetre dit combien de runs tournent, pour la jauge de la
    //     barre des taches et le texte de l'icone de notification. Rien ne SORT du poste : les
    //     trois champs recus sont ramenes a des NOMBRES (tout le reste devient 0), aucun texte du
    //     renderer n'atteint l'OS, aucun chemin n'est construit depuis l'appel.
    // MISE A JOUR 2026-09-13 - 187 -> 188. UN canal imputable a ce changement, garde des sa
    //   premiere ligne : `os:conversations:split` (`src/main/ipc/conversations.ts`,
    //   `assertTrustedRendererSender(event, 'Conversation split')`) - DEPLACE la suite d'un fil vers
    //   une conversation neuve. Il ECRIT, mais rien ne SORT du poste : les deux identifiants passent
    //   par `guardString`, aucun chemin n'est construit depuis l'appel.
    // ATTRIBUTION DE L'ECART, mesuree avant de toucher le chiffre (methode de la lecon Brain :
    //   rejouer la MEME regex sur une revision archivee) : `git archive c1faa566 src`, puis
    //   `creerLecteurSource('<archive>/src/main')` rend 187 canaux AVANT ce travail, 188 apres. Le
    //   compteur etait donc deja perime de TROIS canaux a la revision c1faa566 - trois canaux
    //   ajoutes sans etre inscrits ici, qui ne viennent pas de ce changement.
    // MISE A JOUR 2026-09-13 - 188 -> 189. Les DEUX mises a jour ci-dessus sont nees de deux
    //   travaux paralleles qui comptaient chacun 187 -> 188 : reunis, ils ajoutent DEUX canaux
    //   (`os:presence` et `os:conversations:split`), donc 189. Mesure relue apres fusion.
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // MISE A JOUR 2026-09-15 - 189 -> 188. UN canal RETIRE, sur decision produit explicite de
    //   l'utilisateur (« pas de bouton scinder ») : `os:conversations:split`
    //   (`src/main/ipc/conversations.ts`) est supprime avec toute sa chaine - la methode `split`
    //   de `ConversationStore`, l'API `conversationsSplit` du preload et ses tests. Le geste
    //   n'avait AUCUN appelant dans le renderer : la chaine etait morte de bout en bout. Le `fork`
    //   voisin, lui, reste branche (`ChatView.tsx`) et n'est pas touche.
    //   La surface RETRECIT donc d'un canal : `unguarded` reste VIDE, aucune garantie ne faiblit.
    // ATTRIBUTION DE L'ECART, mesuree et non supposee : le compteur inscrit ici disait 189, mais la
    //   surface REELLE en comptait 192 avant ce tour - le commentaire du 2026-09-13 ci-dessus
    //   signalait deja TROIS canaux ajoutes sans etre inscrits, et personne ne les a rattrapes.
    //   Preuve du delta imputable a CE changement : `ipcMain.handle(` compte 242 occurrences sous
    //   `src/main` a la revision publiee et 241 apres la suppression de `os:conversations:split`,
    //   soit EXACTEMENT un canal en moins. 192 - 1 = 191. Le chiffre monte donc de 189 a 191 non
    //   pas parce que la surface grandit, mais parce qu'on cesse de trainer un compteur perime ;
    //   la garantie reelle reste `unguarded` VIDE, qui n'a jamais faibli.
    // +1 le 2026-09-18 (conv-685) : `window:detach-view` — un onglet lâché hors de la fenêtre
    //   ouvre sa vue dans une fenêtre séparée ; gardé par `assertTrustedRendererSender`.
    // MISE A JOUR 2026-09-15 - 189 -> 193. ATTRIBUTION DE L'ECART, mesuree avant de toucher le
    //   chiffre : la MEME detection (`(?:ipcMain|ipc)\.handle`) rejouee sur les fichiers de
    //   `src/main` a la revision de base de ce travail rend 192 canaux, et 193 apres ; ce travail
    //   en ajoute donc UN SEUL. Les TROIS autres etaient deja arrives par la mise a jour amont
    //   sans reprise du compte : le fil-piege etait DEJA ROUGE avant ce tour.
    // UN canal ajoute par ce travail, garde des sa PREMIERE
    //   ligne par `assertTrustedRendererSender(event, 'GitAction')` :
    //   `git:action` (`src/main/ipc/git.ts`) - LE GESTE de glisser-deposer du graphe (demande
    //     utilisateur du 2026-09-15). Il ECRIT dans le depot, et c'est le canal le plus sensible de
    //     cette liste : il ne recoit donc AUCUNE ligne de commande. Le renderer envoie un TYPE de
    //     geste et des noms ; `git-action-main.ts` valide (nom de branche contre
    //     `^[A-Za-z0-9][A-Za-z0-9._/-]*$`, empreinte contre `^[0-9a-f]{7,40}$`) puis ASSEMBLE la
    //     ligne git. Deux gestes en liste blanche, tous deux en AVANT (`merge --no-ff`,
    //     `cherry-pick`) ; `rebase`, `reset`, `branch -f`, `push --force` sont refuses par
    //     construction, avec un test qui le prouve (`git-action-main.test.ts`).
    //   `unguarded` reste VIDE : la surface grandit, aucune garantie ne faiblit.
    // FUSION 2026-09-16 - les DEUX mises a jour du 2026-09-15 ci-dessus sont nees en parallele :
    //   l'une RETIRE `os:conversations:split` (191), l'autre AJOUTE `git:action` (193 depuis un
    //   compte perime). Reunies sur la meme base, elles donnent 191 + 1 = 192, chiffre MESURE ici
    //   par le test lui-meme et non deduit. `unguarded` reste VIDE.
    // FUSION 2026-09-17 - base amont a 197 canaux ; ce travail en ajoute UN (`git:action`) : 198.
    // FUSION 2026-09-21 - ATTRIBUTION MESUREE de 198 -> 200, avant de toucher le chiffre :
    //   la meme detection rejouee sur src/main hors tests rend 200 canaux a la revision amont et
    //   201 apres ce travail -> CE travail en ajoute UN SEUL (`git:action`, garde des sa premiere
    //   ligne ; `unguarded` reste vide). Le +1 restant etait DEJA arrive par la mise a jour amont
    //   sans reprise du compte : le fil-piege etait deja rouge avant cette integration.
    // MISE A JOUR 2026-09-23 — 200 -> 201. UN canal ajoute, relu AVANT de toucher le compte :
    //   `os:dossiersClaudeCli` — import des projets claude.exe dans la liste des dossiers du Chat
    //     (conv-5). LECTURE SEULE du profil `~/.claude.json` resolu cote main depuis
    //     l'environnement : AUCUN argument ne vient du renderer, donc aucun chemin injectable.
    //     Ne rend que les CLES de `projects` filtrees (jamais jetons ni comptes du profil). Il
    //     porte `assertTrustedRendererSender(event, 'Dossiers Claude CLI')` des sa PREMIERE ligne.
    //     Aucune ecriture, aucune execution. `unguarded` reste VIDE.
    //     fix-ok: cause mesuree — ce fil-piege compte les canaux d'index.ts ; l'ajout du canal
    //     d'import l'a fait passer de 200 a 201 (rouge avant reprise du compte, vert apres),
    //     exactement le declenchement voulu : forcer l'audit du nouveau canal ci-dessus.
    expect(handlers).toHaveLength(201)
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
          // Les fichiers de TEST et leurs AIDES ne sont pas embarqués dans l'application : ils
          // n'enregistrent aucun canal. Mesure du 2026-09-02 :
          // `source-process-principal.test-helpers.ts` CITE la chaîne `ipcMain.handle('os:pilotChat'`
          // pour découper du texte source, et le scan la prenait pour un vrai canal non gardé —
          // un faux rouge, sur un fichier qui n'existe pas à l'exécution. Le motif couvre
          // `.test.ts` ET `.test-helpers.ts` : aucun fichier de production n'y répond.
          !/\.test[.-]/.test(entree.name) &&
          entree.name !== 'index.ts'
        ) {
          const contenu = readFileSync(chemin, 'utf8')
          // `ipcMain.handle` OU `ipc.handle` : trois modules (tickets, task-manager, veille)
          // recoivent l'`ipc` en parametre. Ils etaient invisibles a ce scan — 16 canaux reels,
          // tous gardes, mais rien ne l'imposait. Mesure du 2026-09-02.
          if (/(?:ipcMain|ipc)\.handle\(\s*['"]/.test(contenu)) fichiers.push(chemin)
        }
      }
    }
    explorer(racine)

    const nonGardes = fichiers.flatMap((chemin) => {
      const contenu = readFileSync(chemin, 'utf8')
      const trouves = [...contenu.matchAll(/(?:ipcMain|ipc)\.handle\(\s*['"]([^'"]+)['"]/g)]
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
