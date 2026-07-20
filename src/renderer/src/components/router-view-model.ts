export function connectionIdentity(connection: { label?: string; email?: string }): string {
  if (connection.label && connection.email) return `${connection.label} · ${connection.email}`
  return connection.label ?? connection.email ?? 'Compte sans nom'
}

export function statusLabel(status: string): string {
  if (status === 'healthy') return 'Opérationnel'
  if (status === 'degraded') return 'Dégradé'
  if (status === 'active') return 'Actif'
  if (status === 'limited') return 'Limité'
  if (status === 'error') return 'Erreur'
  if (status === 'inactive') return 'Inactif'
  return 'Non connecté'
}
