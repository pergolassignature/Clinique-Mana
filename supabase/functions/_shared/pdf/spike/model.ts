/**
 * Spike copy of the Task 3.30 document model (plan, Task 3.30 `model.ts`), so
 * the reference documents already have their final shape. Task 3.30 moves it
 * to `_shared/pdf/model.ts` and adds validation.
 */

export interface Run {
  text: string
  bold?: boolean
}

export type Block =
  | { type: 'heading'; level: 1 | 2 | 3; text: string }
  | { type: 'paragraph'; runs: Run[] }
  | { type: 'list'; ordered: boolean; items: Run[][] }
  | {
    type: 'table'
    columns: { label: string; width: number }[]
    rows: string[][]
  }
  | { type: 'image'; assetKey: string; width: number }
  | { type: 'pageBreak' }
  | { type: 'signaturePage'; signers: { role: string; label: string }[] }

export interface PdfDocument {
  title: string
  header?: { text: string; initialsFor?: string[] }
  footer: { text: string }
  blocks: Block[]
}

/** Position in percent of the page, origin top-left (Documenso's convention). */
export interface SigningField {
  role: string
  type: 'SIGNATURE' | 'INITIALS' | 'DATE' | 'NAME'
  page: number
  x: number
  y: number
  width: number
  height: number
}

export interface RenderedPdf {
  bytes: Uint8Array
  pageCount: number
  fields: SigningField[]
}
