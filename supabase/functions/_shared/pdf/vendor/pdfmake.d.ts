/**
 * Types for the part of the vendored pdfmake 0.3 (Node build, `pdfmake.js`)
 * that `../render.ts` uses. pdfmake ships no types for its Node build.
 */

/** A pdfmake document definition (content, styles, header, footer…). */
export type DocumentDefinition = Record<string, unknown>

/** Font files by style, as names written to `virtualfs`. */
export interface FontFiles {
  normal: string
  bold?: string
  italics?: string
  bolditalics?: string
}

/** The module-wide pdfmake instance (its settings are shared by every render). */
export interface Pdfmake {
  /** In-memory files that fonts and images can name instead of a path. */
  virtualfs: { writeFileSync(name: string, content: Uint8Array): void }
  /** Registers the font families documents may use. */
  setFonts(fonts: Record<string, FontFiles>): void
  /** Called before every URL fetch (images, fonts); false refuses it. */
  setUrlAccessPolicy(allow: (url: string) => boolean): void
  /** Called before every local file read; false refuses it. */
  setLocalAccessPolicy(allow: (path: string) => boolean): void
  /** Lays out a definition; `getBuffer` resolves to the PDF bytes. */
  createPdf(definition: DocumentDefinition): {
    getBuffer(): Promise<Uint8Array>
  }
}

declare const pdfmake: Pdfmake
export default pdfmake
