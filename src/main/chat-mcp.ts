import type { CommandSpec } from './commands'
import type { SendOptions } from './providers/types'
import type { LanceurCommandeSkill } from './skill-node-tools'
import { bornerResultatDeCommande } from './resultat-de-commande-borne'
import {
  demarrerServeurOutilsNoeudSkill,
  NOM_SERVEUR_MCP,
  porteLesOutilsNatifs,
  resultatEnTexte,
  type PerimetreOutils
} from './skill-node-mcp'

/**
 * Les commandes du CHAT, servies AUSSI comme outils directs du modele (MCP), en plus du texte `<cmd>`.
 *
 * POURQUOI. Le chat ne lisait ses commandes que dans le texte de la reponse
 * (`parseOrderedPilotTokens`). Chaque `<cmd>` oblige donc a RELANCER le modele avec les resultats
 * (`RÉSULTATS:` dans `agent-pilot.ts`) : un appel payant de plus par aller-retour. Un outil direct
 * rend son resultat DANS le meme appel. Les etapes des runs ont ce canal depuis le 2026-08-20
 * (`skill-node-mcp.ts`) ; on reutilise CE serveur, avec un perimetre DERIVE du catalogue du bus.
 * Reprise de l'idee du commit 7cec6570, jamais fusionne, sur la base de main du 2026-10-10.
 *
 * CE QUI NE PASSE PAS PAR CE CANAL est ecrit SUR LA COMMANDE (`CommandSpec.horsCanalNatif`), jamais
 * dans une seconde liste : `orchestrate` et `ask` (leurs regles de fin de tour ne vivent que dans la
 * boucle texte du pilote) et les commandes de fichiers (le modele a deja ses propres outils).
 *
 * Le `<cmd>` reste le SECOURS : modele IA sans canal natif (codex, gemini, kimi), serveur qui ne
 * demarre pas, catalogue vide. Aucun de ces cas ne casse le tour : `{ repli }` dit pourquoi.
 */

/**
 * Plafond d'appels directs par envoi au modele. Au-dela, refus LISIBLE et rien n'est execute : le
 * modele rend alors son texte et le tour se clot comme d'habitude. Le cap d'iterations du pilote ne
 * voit pas ces appels, qui vivent DANS un seul envoi.
 */
export const APPELS_NATIFS_MAX_PAR_ENVOI = 60

/** Les noms servis au chat : le catalogue du bus, moins ce qui porte un motif d'exclusion. */
export function outilsDuChat(
  catalogue: ReadonlyArray<Pick<CommandSpec, 'name' | 'horsCanalNatif'>>
): string[] {
  return catalogue.filter((c) => c.horsCanalNatif === undefined).map((c) => c.name)
}

/**
 * Vrai si ce battement d'outil du CLI parle d'un outil direct de l'app (`mcp__autowin__…`).
 *
 * Le pilote affiche deja l'appel en carte d'action (commande + resultat) : le battement du CLI le
 * REPETAIT dans le fil. Mesure du 2026-10-10 dans l'instance cachee (tour b96ff4a2) : « mcp__autowin__
 * get_state — 0 s » au-dessus de la carte « 1 action terminee » du meme appel.
 */
export function estUnOutilDirectDuChat(statut: string): boolean {
  return statut.startsWith(`mcp__${NOM_SERVEUR_MCP}__`)
}

/** Cle d'un appel : nom + arguments a cles triees. Sert a ne jamais executer deux fois. */
export function cleAppelNatif(nom: string, args: Record<string, unknown>): string {
  const trie = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(trie)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.keys(v as Record<string, unknown>)
              .sort()
              .map((k) => [k, trie((v as Record<string, unknown>)[k])])
          )
        : v
  return `${nom}:${JSON.stringify(trie(args ?? {}))}`
}

export interface OutilsNatifsDuChat {
  /** A fusionner dans les `SendOptions` de l'envoi. */
  readonly options: NonNullable<SendOptions['skillNodeTools']>
  /** Les commandes servies, pour la ligne visible du fil. */
  readonly noms: readonly string[]
  arreter(): Promise<void>
}

export interface OuvertureOutilsNatifs {
  provider: string
  catalogue: readonly CommandSpec[]
  /** Execute UNE commande servie : c'est le pilote qui l'affiche et la compte comme un `<cmd>`. */
  exec: LanceurCommandeSkill['exec']
  /** Injectable pour les tests ; par defaut le vrai serveur. */
  demarrer?: typeof demarrerServeurOutilsNoeudSkill
}

/** Servi, ou la raison du retour au texte — jamais une exception. */
export type IssueOutilsNatifs = { servis: OutilsNatifsDuChat } | { repli: string }

/** Ouvre le serveur d'outils du chat pour UN envoi au modele. */
export async function ouvrirOutilsNatifsDuChat(
  o: OuvertureOutilsNatifs
): Promise<IssueOutilsNatifs> {
  if (!porteLesOutilsNatifs(o.provider)) {
    return { repli: `le modèle ${o.provider} ne reçoit pas d'outils directs` }
  }
  const outils = outilsDuChat(o.catalogue)
  if (outils.length === 0) {
    return { repli: "aucune commande du catalogue n'est servable en direct" }
  }
  let appels = 0
  const lanceur: LanceurCommandeSkill = {
    catalogue: () => o.catalogue.filter((c) => outils.includes(c.name)),
    exec: async (nom, args) => {
      appels += 1
      if (appels > APPELS_NATIFS_MAX_PAR_ENVOI) {
        return {
          ok: false,
          error: `plafond de ${APPELS_NATIFS_MAX_PAR_ENVOI} appels d'outils atteint pour cette réponse — rien n'a été exécuté ; conclus avec ce que tu as.`
        }
      }
      const r = await o.exec(nom, args)
      if (!r.ok) return r
      /*
       * MEME BORNE QU'UN `<cmd>` (`bornerResultatDeCommande`, 120 000 car. par defaut). Sans elle, un
       * `conversation_read` geant partait entier dans la conversation du modele — le defaut qui a
       * tue conv-312 sur le chemin texte (« Prompt is too long »).
       */
      const texte = resultatEnTexte(r.data)
      const borne = bornerResultatDeCommande(nom, texte)
      return borne === texte ? r : { ...r, data: borne }
    }
  }
  const perimetre: PerimetreOutils = {
    outils,
    refus: (nom) => {
      const motif = o.catalogue.find((c) => c.name === nom)?.horsCanalNatif
      return motif
        ? `REFUSÉ — \`${nom}\` ne passe pas par les outils directs : ${motif}. L'appel n'a pas eu ` +
            `lieu. Émets-la en texte : <cmd>{"name":"${nom}","args":{...}}</cmd>.`
        : `REFUSÉ — \`${nom}\` n'est pas une commande de l'app servie ici. L'appel n'a pas eu lieu.`
    }
  }
  try {
    const serveur = await (o.demarrer ?? demarrerServeurOutilsNoeudSkill)(lanceur, { perimetre })
    return {
      servis: {
        // Pas d'heritage des serveurs MCP du poste : le chat garde `--strict-mcp-config`.
        options: { mcpConfig: serveur.configMcp(), allowedTools: serveur.nomsExposes() },
        noms: outils,
        arreter: () => serveur.arreter()
      }
    }
  } catch (error) {
    return {
      repli: `serveur d'outils indisponible : ${error instanceof Error ? error.message : String(error)}`
    }
  }
}
