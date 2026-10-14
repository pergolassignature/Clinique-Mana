import { createContext } from 'react'

/**
 * True inside « Listes » (NAV-3), where a list is one tab: its title is then the tab panel's h2
 * (the page's h1 is « Listes ») and the « Lecture seule » notice is the page's, shown once.
 */
export const ReferenceListTabContext = createContext(false)
