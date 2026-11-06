import { useCallback, useEffect, useState } from 'react'
import { useLangue } from '../langue'

/**
 * Serveurs MCP de l'utilisateur (plan-b0502bd3, lot 2).
 *
 * Pourquoi : le chat Claude part avec `--strict-mcp-config`, il n'hérite d'aucun serveur du poste.
 * Ce panneau tient la liste déclarée dans Autowin (IPC `os:mcpServers:*` du lot 1) : ajouter,
 * activer/désactiver, supprimer. Blender a sa carte prédéfinie, car il ne sert qu'avec son add-on
 * ouvert dans Blender (ahujasid/blender-mcp, socket local 9876).
 *
 * Textes : table locale FR/EN plutôt que des clés dans `textes-ecrans/` — le lot ne touche que ses
 * deux fichiers (d'autres fils éditent les tables en parallèle).
 */
type Reponse = Awaited<ReturnType<Window['api']['mcpServersList']>>
type Serveur = Extract<Reponse, { ok: true }>['serveurs'][number]

const TEXTES = {
  fr: {
    titre: 'Serveurs MCP',
    eyebrow: 'Outils externes',
    description:
      'Serveurs d’outils que le chat Claude peut appeler. Seuls ceux déclarés ici sont chargés, et seulement s’ils sont actifs.',
    aucun: 'Aucun serveur déclaré.',
    actif: 'Actif',
    inactif: 'Inactif',
    activer: 'Activer',
    desactiver: 'Désactiver',
    supprimer: 'Supprimer',
    ajouter: 'Ajouter',
    nouveau: 'Ajouter un serveur',
    id: 'Identifiant',
    nom: 'Nom',
    commande: 'Commande',
    args: 'Arguments (un par ligne)',
    env: 'Variables (NOM=valeur, une par ligne)',
    blenderAide:
      'Installez l’add-on blender-mcp dans Blender (Edit › Preferences › Add-ons › Install addon.py), puis cliquez « Connect » dans son panneau (onglet BlenderMCP), et activez ce serveur.',
    blenderAjouter: 'Ajouter Blender',
    blenderPresent: 'Déjà dans la liste',
    imagesAide:
      'Génère des images (OpenAI, Google Gemini ou Stable Diffusion). Ajouté inactif : saisissez votre clé dans la variable IMAGE_GENERATION_MCP_OPENAI_API_KEY ou IMAGE_GENERATION_MCP_GOOGLE_API_KEY de la ligne du serveur, puis activez-le. Source : github.com/pvliesdonk/image-generation-mcp.',
    imagesAjouter: 'Ajouter la génération d’images',
    erreurLecture: 'Impossible de lire la liste des serveurs MCP.',
    erreurVariable: 'Variable mal formée (attendu NOM=valeur) : '
  },
  en: {
    titre: 'MCP servers',
    eyebrow: 'External tools',
    description:
      'Tool servers the Claude chat can call. Only those declared here are loaded, and only when active.',
    aucun: 'No server declared.',
    actif: 'Active',
    inactif: 'Inactive',
    activer: 'Enable',
    desactiver: 'Disable',
    supprimer: 'Delete',
    ajouter: 'Add',
    nouveau: 'Add a server',
    id: 'Identifier',
    nom: 'Name',
    commande: 'Command',
    args: 'Arguments (one per line)',
    env: 'Variables (NAME=value, one per line)',
    blenderAide:
      'Install the blender-mcp add-on in Blender (Edit › Preferences › Add-ons › Install addon.py), click “Connect” in its panel (BlenderMCP tab), then enable this server.',
    blenderAjouter: 'Add Blender',
    blenderPresent: 'Already in the list',
    imagesAide:
      'Generates images (OpenAI, Google Gemini or Stable Diffusion). Added disabled: enter your key in the IMAGE_GENERATION_MCP_OPENAI_API_KEY or IMAGE_GENERATION_MCP_GOOGLE_API_KEY variable of the server row, then enable it. Source: github.com/pvliesdonk/image-generation-mcp.',
    imagesAjouter: 'Add image generation',
    erreurLecture: 'Could not read the MCP server list.',
    erreurVariable: 'Malformed variable (expected NAME=value): '
  }
} as const

const SERVEUR_BLENDER: Serveur = {
  id: 'blender',
  nom: 'Blender',
  commande: 'uvx',
  args: ['blender-mcp'],
  env: {},
  actif: false
}

/** Clés nommées et VIDES : l'utilisateur les remplit ici, rien n'est écrit dans le dépôt. */
const SERVEUR_IMAGES: Serveur = {
  id: 'images',
  nom: 'Génération d’images',
  commande: 'uvx',
  args: ['--from', 'image-generation-mcp[all]', 'image-generation-mcp', 'serve'],
  env: { IMAGE_GENERATION_MCP_OPENAI_API_KEY: '', IMAGE_GENERATION_MCP_GOOGLE_API_KEY: '' },
  actif: false
}

/** `NOM=valeur` par ligne → objet ; rend la ligne fautive plutôt que de la jeter en silence. */
function lireVariables(texte: string): Record<string, string> | { fautive: string } {
  const env: Record<string, string> = {}
  for (const brute of texte.split(/\r?\n/)) {
    const ligne = brute.trim()
    if (!ligne) continue
    const i = ligne.indexOf('=')
    if (i <= 0) return { fautive: ligne }
    env[ligne.slice(0, i).trim()] = ligne.slice(i + 1)
  }
  return env
}

export function McpServersSettings(): React.JSX.Element {
  const langue = useLangue()
  const tx = TEXTES[langue === 'en' ? 'en' : 'fr']
  const [serveurs, setServeurs] = useState<Serveur[] | null>(null)
  const [erreur, setErreur] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [id, setId] = useState('')
  const [nom, setNom] = useState('')
  const [commande, setCommande] = useState('')
  const [args, setArgs] = useState('')
  const [env, setEnv] = useState('')

  const run = useCallback(
    async (action: () => Promise<Reponse>): Promise<boolean> => {
      setBusy(true)
      try {
        const r = await action()
        if (r.ok) {
          setServeurs(r.serveurs)
          setErreur(null)
          return true
        }
        setErreur(r.erreur)
        return false
      } catch {
        setErreur(tx.erreurLecture)
        return false
      } finally {
        setBusy(false)
      }
    },
    [tx]
  )

  useEffect(() => {
    queueMicrotask(() => void run(() => window.api.mcpServersList()))
  }, [run])

  const ajouter = async (): Promise<void> => {
    const variables = lireVariables(env)
    if ('fautive' in variables && typeof variables.fautive === 'string') {
      setErreur(tx.erreurVariable + variables.fautive)
      return
    }
    const ok = await run(() =>
      window.api.mcpServersSave({
        id: id.trim(),
        nom: nom.trim() || id.trim(),
        commande: commande.trim(),
        args: args
          .split(/\r?\n/)
          .map((a) => a.trim())
          .filter(Boolean),
        env: variables as Record<string, string>,
        actif: true
      })
    )
    if (ok) {
      setId('')
      setNom('')
      setCommande('')
      setArgs('')
      setEnv('')
    }
  }

  const blenderPresent = serveurs?.some((s) => s.id === SERVEUR_BLENDER.id) ?? false
  const imagesPresent = serveurs?.some((s) => s.id === SERVEUR_IMAGES.id) ?? false

  return (
    <section
      className="settings-execution-workspace surface-panel"
      aria-label={tx.titre}
      data-testid="mcp-servers"
    >
      <header>
        <div>
          <span className="domain-eyebrow">{tx.eyebrow}</span>
          <h2>{tx.titre}</h2>
        </div>
      </header>
      <p>{tx.description}</p>
      {erreur && (
        <p role="alert" data-testid="mcp-erreur" style={{ color: 'var(--err)' }}>
          {erreur}
        </p>
      )}

      <div
        data-testid="mcp-carte-blender"
        style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 10,
          background: 'var(--bg-2)'
        }}
      >
        <strong>Blender</strong> <code>uvx blender-mcp</code>
        <p data-testid="mcp-blender-aide" style={{ color: 'var(--text-dim)', margin: '6px 0' }}>
          {tx.blenderAide}
        </p>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="mcp-blender-ajouter"
          disabled={busy || serveurs === null || blenderPresent}
          onClick={() => void run(() => window.api.mcpServersSave({ ...SERVEUR_BLENDER }))}
        >
          {blenderPresent ? tx.blenderPresent : tx.blenderAjouter}
        </button>
      </div>

      <div
        data-testid="mcp-carte-images"
        style={{
          border: '1px solid var(--line)',
          borderRadius: 8,
          padding: 10,
          background: 'var(--bg-2)'
        }}
      >
        <strong>{SERVEUR_IMAGES.nom}</strong> <code>uvx image-generation-mcp serve</code>
        <p data-testid="mcp-images-aide" style={{ color: 'var(--text-dim)', margin: '6px 0' }}>
          {tx.imagesAide}
        </p>
        <button
          type="button"
          className="btn btn-sm"
          data-testid="mcp-images-ajouter"
          disabled={busy || serveurs === null || imagesPresent}
          onClick={() => void run(() => window.api.mcpServersSave({ ...SERVEUR_IMAGES }))}
        >
          {imagesPresent ? tx.blenderPresent : tx.imagesAjouter}
        </button>
      </div>

      {serveurs && serveurs.length === 0 && <p data-testid="mcp-vide">{tx.aucun}</p>}
      {serveurs && serveurs.length > 0 && (
        <ul data-testid="mcp-liste" style={{ listStyle: 'none', padding: 0 }}>
          {serveurs.map((s) => (
            <li
              key={s.id}
              data-testid={`mcp-serveur-${s.id}`}
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                padding: '6px 0',
                borderBottom: '1px solid var(--line)'
              }}
            >
              <span
                data-testid={`mcp-etat-${s.id}`}
                style={{ color: s.actif ? 'var(--ok)' : 'var(--text-dim)', minWidth: 60 }}
              >
                {s.actif ? tx.actif : tx.inactif}
              </span>
              <span style={{ flex: 1 }}>
                <strong>{s.nom}</strong> <code>{[s.commande, ...s.args].join(' ')}</code>
                {Object.keys(s.env).length > 0 && (
                  <span style={{ color: 'var(--text-dim)' }}>
                    {' '}
                    · {Object.keys(s.env).join(', ')}
                  </span>
                )}
              </span>
              <button
                type="button"
                className="btn btn-sm"
                data-testid={`mcp-basculer-${s.id}`}
                disabled={busy}
                onClick={() => void run(() => window.api.mcpServersToggle(s.id, !s.actif))}
              >
                {s.actif ? tx.desactiver : tx.activer}
              </button>
              <button
                type="button"
                className="btn btn-sm"
                data-testid={`mcp-supprimer-${s.id}`}
                disabled={busy}
                onClick={() => void run(() => window.api.mcpServersDelete(s.id))}
              >
                {tx.supprimer}
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>{tx.nouveau}</h3>
      <label>
        {tx.id}
        <input
          type="text"
          value={id}
          placeholder="mon-serveur"
          data-testid="mcp-champ-id"
          onChange={(e) => setId(e.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <label>
        {tx.nom}
        <input
          type="text"
          value={nom}
          data-testid="mcp-champ-nom"
          onChange={(e) => setNom(e.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <label>
        {tx.commande}
        <input
          type="text"
          value={commande}
          placeholder="uvx"
          data-testid="mcp-champ-commande"
          onChange={(e) => setCommande(e.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <label>
        {tx.args}
        <textarea
          value={args}
          rows={2}
          data-testid="mcp-champ-args"
          onChange={(e) => setArgs(e.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <label>
        {tx.env}
        <textarea
          value={env}
          rows={2}
          data-testid="mcp-champ-env"
          onChange={(e) => setEnv(e.target.value)}
          style={{ width: '100%' }}
        />
      </label>
      <p>
        <button
          type="button"
          className="btn"
          data-testid="mcp-ajouter"
          disabled={busy || !id.trim() || !commande.trim()}
          onClick={() => void ajouter()}
        >
          {tx.ajouter}
        </button>
      </p>
    </section>
  )
}
