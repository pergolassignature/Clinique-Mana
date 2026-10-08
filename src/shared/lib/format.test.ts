import { describe, expect, it } from 'vitest'
import { compactTaxNumber, formatPhone, formatPostalCode, formatRate, formatTaxNumber, initialsOf, parsePhone, parseRate, regroupPhone } from './format'

// French typography puts a no-break space before « % ». Engines differ on which one Intl emits
// (U+00A0 or the narrow U+202F), so the assertions compare with every space made regular.
const plainSpaces = (s: string) => s.replace(/[\u00A0\u202F]/g, ' ')

describe('formatPhone', () => {
  it('shows a stored E.164 number the Québec way', () => {
    expect(formatPhone('+15145551234')).toBe('514 555-1234')
  })

  it('shows nothing for a missing number', () => {
    expect(formatPhone(null)).toBe('')
    expect(formatPhone(undefined)).toBe('')
    expect(formatPhone('')).toBe('')
  })

  it('leaves a value it does not recognise untouched', () => {
    expect(formatPhone('+33123456789')).toBe('+33123456789')
  })
})

describe('regroupPhone', () => {
  it('regroups a valid number in the Québec format and leaves anything else as typed', () => {
    expect(regroupPhone('4189079754')).toBe('418 907-9754')
    expect(regroupPhone('+1 (514) 555.1234')).toBe('514 555-1234')
    expect(regroupPhone('555')).toBe('555')
    expect(regroupPhone('')).toBe('')
  })
})

describe('parsePhone', () => {
  it.each([
    [' (514) 555-1234 ', '+15145551234'],
    ['1 514 555 1234', '+15145551234'],
    ['514.555.1234', '+15145551234'],
    ['+1 514-555-1234', '+15145551234'],
    ['5145551234', '+15145551234'],
    ['514\u2013555\u20131234', '+15145551234'], // en dash
    ['514\u2014555\u20141234', '+15145551234'], // em dash
    ['+15145551234', '+15145551234'],
  ])('turns %j into E.164', (input, expected) => {
    expect(parsePhone(input)).toBe(expected)
  })

  it.each([['555-1234'], [''], ['   '], ['2 514 555 1234'], ['514 555 12345'], ['514-555-abcd'], ['514 555 1234 poste 12'], ['+65 6123 4567'], ['+514 555 1234']])(
    'rejects %j',
    (input) => {
      expect(parsePhone(input)).toBeNull()
    },
  )

  it('round-trips with formatPhone', () => {
    expect(parsePhone(formatPhone('+15145551234'))).toBe('+15145551234')
  })
})

describe('formatPostalCode', () => {
  it.each([
    ['h2x1y4', 'H2X 1Y4'],
    [' h2x 1y4 ', 'H2X 1Y4'],
    ['H2X1Y4', 'H2X 1Y4'],
    ['h2x-1y4', 'H2X 1Y4'],
    ['h2x\u20131y4', 'H2X 1Y4'],
    ['H2X \u2014 1Y4', 'H2X 1Y4'],
  ])('formats %j (spaces, hyphens and en/em dashes removed, as the schema does)', (input, expected) => {
    expect(formatPostalCode(input)).toBe(expected)
  })

  it('uppercases a partial value without inventing a space', () => {
    expect(formatPostalCode('h2x')).toBe('H2X')
  })

  it('shows nothing for a missing value', () => {
    expect(formatPostalCode(null)).toBe('')
    expect(formatPostalCode(undefined)).toBe('')
  })
})

describe('formatRate', () => {
  it('uses the French decimal comma and drops trailing zeros', () => {
    expect(plainSpaces(formatRate(0.09975))).toBe('9,975 %')
    expect(plainSpaces(formatRate(0.05))).toBe('5 %')
    expect(plainSpaces(formatRate(0.15))).toBe('15 %')
    expect(plainSpaces(formatRate(0))).toBe('0 %')
    expect(plainSpaces(formatRate(0.099751))).toBe('9,9751 %') // the 4 decimals a stored rate can have, in percent
  })

  it('keeps « % » on the same line as the number', () => {
    expect(formatRate(0.05)).toBe('5\u00A0%')
  })
})

describe('parseRate', () => {
  it.each([
    ['9,975', 0.09975],
    ['9.975', 0.09975],
    [' 5 ', 0.05],
    ['5 %', 0.05],
    ['5%', 0.05],
    ['9,975\u202F%', 0.09975],
    ['0', 0],
    [',5', 0.005],
    ['14,975', 0.14975],
  ])('reads %j as %d', (input, expected) => {
    expect(parseRate(input)).toBe(expected)
  })

  it('rounds to 6 decimals, the precision stored in the database', () => {
    expect(parseRate('9,9751234')).toBe(0.099751)
    expect(parseRate('9,97516')).toBe(0.099752)
  })

  it.each([[''], ['  '], ['abc'], ['9,9,75'], ['-5'], ['5 % %'], ['1e2'], ['%']])('rejects %j', (input) => {
    expect(parseRate(input)).toBeNull()
  })

  it.each([[0.09975], [0.099751], [0.05], [0.000001]])('round-trips %d with formatRate', (rate) => {
    expect(parseRate(formatRate(rate))).toBe(rate)
  })
})

describe('initialsOf', () => {
  it('takes the first letter of the first two words', () => {
    expect(initialsOf('Camille Tremblay')).toBe('CT')
    expect(initialsOf('Marie-Ève de la Fontaine')).toBe('MD')
  })

  it('upper-cases accented letters and keeps a single word', () => {
    expect(initialsOf('élise')).toBe('É')
    expect(initialsOf('  émile   ouellet ')).toBe('ÉO')
  })

  it('shows a question mark for a missing name', () => {
    expect(initialsOf('')).toBe('?')
    expect(initialsOf('   ')).toBe('?')
    expect(initialsOf(null)).toBe('?')
  })
})

describe('formatTaxNumber', () => {
  it('groups a stored GST or QST number around its program identifier', () => {
    expect(formatTaxNumber('123456789RT0001')).toBe('123456789 RT 0001')
    expect(formatTaxNumber('1234567890TQ0001')).toBe('1234567890 TQ 0001')
  })

  it('regroups a number typed with spaces, dashes or in lower case', () => {
    expect(formatTaxNumber(' 123456789 rt-0001 ')).toBe('123456789 RT 0001')
    expect(formatTaxNumber('1234567890\u2013tq\u20140001')).toBe('1234567890 TQ 0001')
  })

  it('shows nothing for a missing number', () => {
    expect(formatTaxNumber(null)).toBe('')
    expect(formatTaxNumber(undefined)).toBe('')
    expect(formatTaxNumber('')).toBe('')
  })

  it('leaves a value it does not recognise as typed (the schema reports it)', () => {
    expect(formatTaxNumber('12345 RT')).toBe('12345 RT')
    expect(formatTaxNumber('123456789XX0001')).toBe('123456789XX0001')
  })
})

describe('compactTaxNumber', () => {
  it('removes spaces, hyphens and en/em dashes, and upper-cases', () => {
    expect(compactTaxNumber(' 123456789 rt-0001 ')).toBe('123456789RT0001')
    expect(compactTaxNumber('1234567890\u2013tq\u20140001')).toBe('1234567890TQ0001')
    expect(compactTaxNumber('123456789 RT 0001')).toBe('123456789RT0001')
  })

  it('does not validate', () => {
    expect(compactTaxNumber('12 x')).toBe('12X')
  })
})
