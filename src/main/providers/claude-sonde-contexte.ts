import { spawn as spawnNode } from 'node:child_process'
import { lireReponseContexte, type ContexteStatique } from '../../shared/contexte-detaille'

/**
 * LA SONDE DE CONTEXTE — le detail par categorie du panneau « Contexte » (conv-1000, 2026-10-16).
 *
 * Le CLI Claude sait dire de quoi sa fenetre est faite : requete de controle `get_context_usage`
 * sur une entree `stream-json`. Mesure du 2026-10-16, CLI 2.1.301 : reponse en ~1,1 s, AUCUN appel
 * au modele (donc aucun cout), categories + outils MCP + fichiers memoire + skills.
 *
 * POURQUOI UN SECOND PROCESSUS, ET PAS LE TOUR LUI-MEME. Le tour lit son prompt sur stdin en TEXTE
 * (`-p` sans valeur) ; parler le protocole de controle exigerait `--input-format stream-json` sur
 * TOUS les appels — le coeur du provider et ses dizaines de tests. La sonde a son propre processus,
 * lance EN PARALLELE du tour avec les MEMES arguments : meme prompt systeme, memes outils, meme
 * serveur MCP (encore ouvert pendant le tour, ferme juste apres). Aucune latence ajoutee au tour.
 *
 * CE QU'ELLE NE TOUCHE PAS. `--resume` est retire et `--no-session-persistence` ajoute : la sonde
 * n'ouvre ni n'ecrit aucune session. Mesure du 2026-10-16 : sans ce drapeau, une reprise ajoutait
 * des lignes d'etat au transcript (empreinte changee) ; avec lui, empreinte identique.
 */

/** Drapeaux du tour sans objet pour une sonde, retires avec leur valeur eventuelle. */
const AVEC_VALEUR = new Set(['--resume', '--input-format', '--session-id'])
const SANS_VALEUR = new Set([
  '--include-partial-messages',
  '--no-session-persistence',
  '--continue'
])

/** Arguments de la sonde, derives de ceux du tour. Fonction pure. */
export function argumentsDeSonde(argsDuTour: readonly string[]): string[] {
  const sortie: string[] = []
  for (let i = 0; i < argsDuTour.length; i++) {
    const a = argsDuTour[i]!
    if (AVEC_VALEUR.has(a)) {
      i++
      continue
    }
    if (SANS_VALEUR.has(a)) continue
    sortie.push(a)
  }
  return [...sortie, '--input-format', 'stream-json', '--no-session-persistence']
}

export interface SondeContexteParams {
  bin: string
  argsDuTour: readonly string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  /** Le tour est arrete : la sonde l'est aussi. */
  signal?: AbortSignal
  /** Borne dure : au-dela, la sonde est tuee et ne rend rien. */
  delaiMs?: number
  /** Injectable pour les tests. */
  spawn?: typeof spawnNode
  maintenant?: () => number
}

/** Ce que la sonde rend : un detail, ou la raison exacte de son absence (jamais une exception). */
export type IssueSonde = { contexte: ContexteStatique } | { echec: string }

const REQUETE = 'autowin-contexte'

/**
 * Lance la sonde. Ne JETTE jamais : un echec rend `{ echec }`, que l'appelant journalise. Le detail
 * est un enrichissement du panneau — son absence laisse la jauge simple, elle ne casse aucun tour.
 */
export function sonderContexte(p: SondeContexteParams): Promise<IssueSonde> {
  const lancer = p.spawn ?? spawnNode
  const delaiMs = p.delaiMs ?? 20_000
  const maintenant = p.maintenant ?? Date.now
  return new Promise<IssueSonde>((resolve) => {
    let fini = false
    let enfant: ReturnType<typeof spawnNode> | undefined
    const terminer = (issue: IssueSonde): void => {
      if (fini) return
      fini = true
      clearTimeout(minuterie)
      p.signal?.removeEventListener('abort', surArret)
      try {
        enfant?.stdin?.end()
      } catch {
        /* deja ferme */
      }
      // La sonde n'a plus rien a dire : on ne l'attend pas, on la coupe (aucune session a sauver).
      if (enfant && enfant.exitCode === null) enfant.kill()
      resolve(issue)
    }
    const surArret = (): void => terminer({ echec: 'tour arrêté' })
    const minuterie = setTimeout(
      () => terminer({ echec: `aucune réponse en ${Math.round(delaiMs / 1000)} s` }),
      delaiMs
    )
    if (p.signal?.aborted) return terminer({ echec: 'tour arrêté' })
    p.signal?.addEventListener('abort', surArret, { once: true })
    try {
      enfant = lancer(p.bin, argumentsDeSonde(p.argsDuTour), {
        shell: false,
        windowsHide: true,
        cwd: p.cwd,
        env: p.env,
        stdio: ['pipe', 'pipe', 'ignore']
      })
    } catch (error) {
      return terminer({ echec: `lancement impossible : ${(error as Error).message}` })
    }
    enfant.on('error', (error) => terminer({ echec: `lancement impossible : ${error.message}` }))
    enfant.on('close', (code) => terminer({ echec: `CLI sorti (code ${code}) sans réponse` }))
    const envoyer = (
      requestId: string,
      subtype: string,
      extra: Record<string, unknown> = {}
    ): void => {
      enfant?.stdin?.write(
        `${JSON.stringify({ type: 'control_request', request_id: requestId, request: { subtype, ...extra } })}\n`
      )
    }
    const mesurer = (): void => envoyer(REQUETE, 'get_context_usage', { detail: 'full' })
    /*
     * ATTENDRE LES SERVEURS MCP. Interroge tout de suite, le CLI repond AVANT d'avoir connecte ses
     * serveurs : mesure du 2026-10-16, 0 outil MCP a 1,4 s, 27 a 4,7 s sur le meme serveur. On
     * demande donc `mcp_status` jusqu'a ce qu'aucun serveur ne soit plus « pending » (~2 s), puis on
     * mesure. La reponse porte la CONFIG du serveur — jeton compris : on n'en lit que les statuts,
     * rien n'en est garde ni journalise.
     */
    let sondagesMcp = 0
    const demanderEtatMcp = (): void => envoyer(`${REQUETE}-mcp-${++sondagesMcp}`, 'mcp_status')
    const attendreMcp = p.argsDuTour.includes('--mcp-config')
    let tampon = ''
    enfant.stdout?.on('data', (morceau: Buffer) => {
      tampon += morceau.toString('utf8')
      let fin: number
      while ((fin = tampon.indexOf('\n')) >= 0) {
        const ligne = tampon.slice(0, fin).trim()
        tampon = tampon.slice(fin + 1)
        if (!ligne.startsWith('{')) continue
        let evt: { type?: string; response?: Record<string, unknown> }
        try {
          evt = JSON.parse(ligne)
        } catch {
          continue
        }
        if (evt.type !== 'control_response' || !evt.response) continue
        const id = evt.response['request_id']
        if (typeof id === 'string' && id.startsWith(`${REQUETE}-mcp-`)) {
          const serveurs = (evt.response['response'] as { mcpServers?: { status?: string }[] })
            ?.mcpServers
          const enAttente = (serveurs ?? []).some((s) => s?.status === 'pending')
          // Borne : un serveur qui ne se connecte jamais ne doit pas priver de tout le reste.
          if (enAttente && sondagesMcp < 40) setTimeout(() => !fini && demanderEtatMcp(), 250)
          else mesurer()
          continue
        }
        if (id !== REQUETE) continue
        if (evt.response['subtype'] !== 'success') {
          return terminer({ echec: `refus du CLI : ${String(evt.response['error'] ?? 'inconnu')}` })
        }
        const contexte = lireReponseContexte(evt.response['response'], maintenant())
        return terminer(contexte ? { contexte } : { echec: 'réponse du CLI illisible' })
      }
    })
    enfant.stdin?.on('error', () => undefined)
    if (attendreMcp) demanderEtatMcp()
    else mesurer()
  })
}
