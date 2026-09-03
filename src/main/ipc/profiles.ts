/**
 * LES CANAUX DES PROFILS DE WORKFLOW, sortis de `src/main/index.ts`.
 *
 * Trois canaux : lister les profils, en enregistrer un, en appliquer un.
 *
 * Déplacement MÉCANIQUE depuis `index.ts` : corps identiques, mêmes gardes d'expéditeur, même
 * attente du catalogue de modèles avant toute écriture, même migration de forme à la LECTURE
 * comme à l'APPLICATION (un profil enregistré avant un panneau récent doit rester applicable).
 *
 * La topologie courante est une variable RÉASSIGNÉE dans `index.ts` : elle est donc reçue comme
 * lecteur (`lireTopologie`) et écrivain (`appliquerTopologie`), jamais comme valeur — sinon
 * l'enregistrement figerait la topologie du démarrage.
 */
import { ipcMain } from 'electron'
import { assertTrustedRendererSender } from '../ipc-senders'
import { guardProfile, guardString } from '../ipc-guards'
import { migrateTopologyShape } from '../topology'
import type { AgentTopology } from '../topology'
import type { AutowinOS } from '../os'
import type { ProfileStore, AutowinProfile } from '../profile-store'

/** Ce que les canaux de profils prenaient dans `index.ts` — désormais passé explicitement. */
export type ProfilesIpcDeps = {
  os: AutowinOS
  profiles: ProfileStore
  /** Le catalogue de modèles : attendu avant toute écriture, comme dans `index.ts`. */
  agentModelsReady: Promise<unknown>
  /** La topologie courante, LUE à l'instant de l'appel (elle est réassignée ailleurs). */
  lireTopologie: () => AgentTopology
  /** Persiste la topologie, resynchronise les rôles et rend celle qui a été retenue. */
  appliquerTopologie: (topology: AgentTopology) => AgentTopology
  /** Prévenir les écrans que les rôles ont changé. */
  broadcastRolesRefresh: () => void
}

export function registerProfilesIpc({
  os,
  profiles,
  agentModelsReady,
  lireTopologie,
  appliquerTopologie,
  broadcastRolesRefresh
}: ProfilesIpcDeps): void {
  ipcMain.handle('os:profiles:list', (event) => {
    assertTrustedRendererSender(event, 'Workflow profiles')
    return profiles.list().map((profile) => ({
      ...profile,
      topology: migrateTopologyShape(profile.topology) as AgentTopology
    }))
  })
  ipcMain.handle('os:profiles:save', async (event, profile: AutowinProfile) => {
    assertTrustedRendererSender(event, 'Profiles')
    await agentModelsReady
    /*
     * VALIDER A LA FRONTIERE avant de persister. `ProfileStore.save` ne verifie RIEN et ecrit la
     * charge utile telle quelle -- et il compose `[profile, ...list().filter(...)]`, donc un `id`
     * absent fait atterrir l'objet douteux EN TETE de liste. Le lecteur etant tolerant, le degat est
     * silencieux : pas un plantage, de la donnee pourrie.
     *
     * Meme classe que l'incident du meme jour sur les conversations, ou le lecteur etait STRICT et
     * l'app en est devenue inbootable. Le cout differe, la cause est identique : un ecrivain qui
     * accepte une forme que rien ne verifie.
     */
    const verifie = guardProfile(profile)
    const safe = {
      ...verifie,
      topology: lireTopologie(),
      roles: os.roles.all(),
      updatedAt: new Date().toISOString()
    }
    return profiles.save(safe as AutowinProfile)
  })
  ipcMain.handle('os:profiles:apply', async (event, id: string) => {
    assertTrustedRendererSender(event, 'Profiles')
    await agentModelsReady
    const profile = profiles.list().find((item) => item.id === guardString(id, 'profile.id'))
    if (!profile) throw new Error('Profil introuvable')
    // Rétrocompat : un profil sauvegardé avant un panel récent peut ne pas l'avoir → on migre
    // la forme avant validation (sinon assertTopology jetterait « Profil introuvable/incohérent »).
    const topology = appliquerTopologie(migrateTopologyShape(profile.topology) as AgentTopology)
    // `roles` reste dans le schéma des anciens profils pour la lecture rétrocompatible, mais Agent
    // Studio n'édite que `topology`. Le réappliquer ici recréerait une seconde autorité invisible.
    broadcastRolesRefresh()
    return { ...profile, topology }
  })
}
