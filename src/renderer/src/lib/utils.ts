import { createCn } from 'cn/config'

/**
 * Tailwind class merging that knows the interface text sizes (text-ui-* in styles/globals.css) are font sizes. The cn
 * package's default reads an unknown text-* class as a colour, so "text-ui-sm text-foreground-subtle" would lose its size (a
 * lesson learnt before). Lint refuses importing cn from the package directly.
 */
export const cn = createCn({
  extend: {
    classGroups: {
      'font-size': [{ text: ['ui-xs', 'ui-sm', 'ui-caption', 'ui-base', 'ui-lg', 'ui-xl', 'ui-title'] }],
    },
  },
})
