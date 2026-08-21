/**
 * Answer-pet theme renderer: inline the theme's SVG markup inside the existing
 * pet art slot. The theme's scoped CSS (injected once by pet-styles) animates
 * the SVG via `data-ap-theme` / `data-ap-phase` / `data-ap-click-blink`
 * attributes that the PetOverlay host sets on the `.dsd-pet` button.
 */
import type { ReactNode } from 'react'
import { resolveApTheme } from './ap-themes.ts'

export interface ApPetProps {
  themeId: string
}

/** Render the theme's SVG markup (trusted static string from ap-themes.ts). */
export function ApPet({ themeId }: ApPetProps): ReactNode {
  const theme = resolveApTheme(themeId)
  return (
    <span
      className="dsd-pet__art-ap"
      dangerouslySetInnerHTML={{ __html: theme.markup }}
    />
  )
}