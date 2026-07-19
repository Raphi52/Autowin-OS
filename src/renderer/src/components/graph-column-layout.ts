export type GraphColumnWidths = {
  theme: number
  visibility: number
  detail: number | null
}

export const GRAPH_COLUMN_LIMITS = {
  theme: { min: 120, max: 420 },
  visibility: { min: 160, max: 520 },
  detail: { min: 240, max: 760 },
  graph: 200,
  detailGraph: 240
} as const

export function fitNormalColumnWidths(
  widths: Pick<GraphColumnWidths, 'theme' | 'visibility'>,
  contentWidth: number
): Pick<GraphColumnWidths, 'theme' | 'visibility'> {
  let theme = Math.min(
    GRAPH_COLUMN_LIMITS.theme.max,
    Math.max(GRAPH_COLUMN_LIMITS.theme.min, widths.theme)
  )
  let visibility = Math.min(
    GRAPH_COLUMN_LIMITS.visibility.max,
    Math.max(GRAPH_COLUMN_LIMITS.visibility.min, widths.visibility)
  )
  const allowedSideWidth = Math.max(0, contentWidth - GRAPH_COLUMN_LIMITS.graph)
  const overflow = theme + visibility - allowedSideWidth
  if (overflow <= 0) return { theme, visibility }

  const themeFlex = theme - GRAPH_COLUMN_LIMITS.theme.min
  const visibilityFlex = visibility - GRAPH_COLUMN_LIMITS.visibility.min
  const totalFlex = themeFlex + visibilityFlex
  const themeReduction = totalFlex > 0 ? Math.min(themeFlex, (overflow * themeFlex) / totalFlex) : 0
  theme -= themeReduction
  visibility -= Math.min(visibilityFlex, overflow - themeReduction)
  const remainingOverflow = theme + visibility - allowedSideWidth
  if (remainingOverflow > 0) theme = Math.max(0, theme - remainingOverflow)

  const integralTheme = Math.floor(theme)
  return {
    theme: integralTheme,
    visibility: Math.floor(Math.min(visibility, allowedSideWidth - integralTheme))
  }
}
