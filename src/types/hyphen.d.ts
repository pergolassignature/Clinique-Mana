declare module 'hyphen/fr' {
  export function hyphenateSync(word: string): string
  export function hyphenate(word: string): Promise<string>
}
