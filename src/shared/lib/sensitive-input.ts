/**
 * The props of an input that takes a sensitive number (SIN, bank account, transit, tax numbers):
 * spread on the `Input` (`<Input {...field} {...register('sin')} {...SENSITIVE_INPUT_PROPS} />`).
 *
 * - `autoComplete="off"`: the browser neither suggests nor stores the value;
 * - password managers ignore `autocomplete="off"`, so each is told by its own attribute not to save
 *   or fill the field (1Password `data-1p-ignore`, LastPass `data-lpignore`, Bitwarden
 *   `data-bwignore`, Dashlane `data-form-type="other"`);
 * - `spellCheck={false}`: some browsers send checked text to a server (enhanced spell check);
 * - `translate="no"`: a page translator never sends the value away.
 *
 * Used by the record's SIN and bank cards and the questionnaire's « Fiscalité et banque ».
 */
export const SENSITIVE_INPUT_PROPS = {
  autoComplete: 'off',
  'data-1p-ignore': true,
  'data-lpignore': 'true',
  'data-bwignore': 'true',
  'data-form-type': 'other',
  spellCheck: false,
  translate: 'no',
} as const
