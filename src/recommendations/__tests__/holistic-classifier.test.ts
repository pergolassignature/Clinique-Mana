// src/recommendations/__tests__/holistic-classifier.test.ts
// Unit tests for holistic intent classification

import { describe, it, expect } from 'vitest'
import {
  classifyHolisticIntent,
  createEmptyHolisticSignal,
  HOLISTIC_KEYWORDS,
  CLINICAL_OVERRIDE_KEYWORDS,
} from '../holistic-classifier'

describe('classifyHolisticIntent', () => {
  describe('Fixture A: Strong holistic signal → Naturopathe recommended', () => {
    it('should recommend naturopath for "approche globale / corps / digestion / sommeil / énergie"', () => {
      const text = 'approche globale / corps / digestion / sommeil / énergie'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(true)
      expect(result.score).toBeGreaterThanOrEqual(0.5)
      expect(result.category).toBe('global') // 'approche globale' is highest priority
      expect(result.hasClinicalOverride).toBe(false)
      expect(result.matchedKeywords).toContain('approche globale')
      expect(result.matchedKeywords).toContain('corps')
      expect(result.matchedKeywords).toContain('digestion')
      expect(result.matchedKeywords).toContain('sommeil')
    })

    it('should recommend naturopath for body/energy focus', () => {
      const text = 'Je cherche à améliorer mon alimentation et mon sommeil. Je ressens de la fatigue chronique et des problèmes de digestion.'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(true)
      expect(result.score).toBeGreaterThanOrEqual(0.5)
      expect(result.hasClinicalOverride).toBe(false)
    })

    it('should recommend naturopath for lifestyle/equilibrium focus', () => {
      const text = 'équilibre de vie / habitudes de vie / routine quotidienne'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(true)
      expect(result.category).toBe('lifestyle')
    })
  })

  describe('Fixture B: Clinical override → Psychologue preferred (naturopath NOT recommended)', () => {
    it('should NOT recommend naturopath when "idées noires" present', () => {
      const text = 'fatigue / épuisement / idées noires / détresse importante'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.hasClinicalOverride).toBe(true)
      // clinicalKeywordsFound returns original keywords (with accents)
      expect(result.clinicalKeywordsFound).toContain('idées noires')
      expect(result.clinicalKeywordsFound).toContain('détresse importante')
      // Score may still be > 0 because holistic keywords are present
      expect(result.matchedKeywords.length).toBeGreaterThan(0)
    })

    it('should NOT recommend naturopath when "suicidaire" present', () => {
      const text = 'problèmes de sommeil / pensées suicidaires'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.hasClinicalOverride).toBe(true)
    })

    it('should NOT recommend naturopath when "trauma" present', () => {
      const text = 'fatigue chronique suite à un trauma'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.hasClinicalOverride).toBe(true)
      expect(result.clinicalKeywordsFound.some(k => k.includes('trauma'))).toBe(true)
    })

    it('should NOT recommend naturopath when "violence" present', () => {
      const text = 'équilibre de vie / situation de violence conjugale'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.hasClinicalOverride).toBe(true)
    })

    it('should NOT recommend naturopath when "automutilation" present', () => {
      const text = 'stress chronique / automutilation'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.hasClinicalOverride).toBe(true)
    })
  })

  describe('Fixture C: No holistic signal → Standard recommendation (psychothérapeute)', () => {
    it('should NOT recommend naturopath for relational/communication issues', () => {
      const text = 'stress relationnel + conflits + communication'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.score).toBeLessThan(0.5)
      expect(result.category).toBe('none')
      expect(result.matchedKeywords.length).toBe(0)
    })

    it('should NOT recommend naturopath for anxiety/depression without body focus', () => {
      const text = 'anxiété / dépression / difficultés relationnelles'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.score).toBeLessThan(0.5)
    })

    it('should NOT recommend naturopath for couple/family issues', () => {
      const text = 'problèmes de couple / médiation familiale / séparation'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.score).toBeLessThan(0.5)
    })
  })

  describe('Edge cases', () => {
    it('should handle empty string', () => {
      const result = classifyHolisticIntent('')

      expect(result.recommendNaturopath).toBe(false)
      expect(result.score).toBe(0)
      expect(result.category).toBe('none')
      expect(result.matchedKeywords).toEqual([])
    })

    it('should handle null-ish input gracefully', () => {
      // @ts-expect-error - testing edge case
      const result = classifyHolisticIntent(null)

      expect(result.recommendNaturopath).toBe(false)
      expect(result.score).toBe(0)
    })

    it('should be case-insensitive', () => {
      const result = classifyHolisticIntent('APPROCHE GLOBALE / CORPS / ÉNERGIE')

      expect(result.recommendNaturopath).toBe(true)
      expect(result.matchedKeywords).toContain('approche globale')
    })

    it('should be accent-insensitive', () => {
      const result = classifyHolisticIntent('energie / fatigue / equilibre de vie')

      expect(result.score).toBeGreaterThan(0)
      // Keywords should be found even without accents
    })

    it('should handle mixed holistic and clinical keywords correctly', () => {
      // Holistic present but clinical override
      const text = 'approche globale / corps / énergie / idées noires'
      const result = classifyHolisticIntent(text)

      expect(result.recommendNaturopath).toBe(false) // Clinical override wins
      expect(result.hasClinicalOverride).toBe(true)
      expect(result.score).toBeGreaterThan(0) // Still has holistic score
      expect(result.matchedKeywords.length).toBeGreaterThan(0)
    })
  })

  describe('Score calculation', () => {
    it('should give higher score for more category matches', () => {
      const singleCategory = classifyHolisticIntent('fatigue')
      const multiCategory = classifyHolisticIntent('fatigue / corps / équilibre de vie / approche globale')

      expect(multiCategory.score).toBeGreaterThan(singleCategory.score)
    })

    it('should give higher score for "approche globale" (explicit intent)', () => {
      const withGlobal = classifyHolisticIntent('approche globale')
      const withoutGlobal = classifyHolisticIntent('fatigue')

      expect(withGlobal.score).toBeGreaterThan(withoutGlobal.score)
    })

    it('should cap score at 1.0', () => {
      // Load up with lots of keywords
      const text = Object.values(HOLISTIC_KEYWORDS).flat().join(' / ')
      const result = classifyHolisticIntent(text)

      expect(result.score).toBeLessThanOrEqual(1.0)
    })
  })

  describe('Category determination', () => {
    it('should prioritize "global" category', () => {
      const result = classifyHolisticIntent('approche globale / fatigue / corps')
      expect(result.category).toBe('global')
    })

    it('should use "lifestyle" as second priority', () => {
      const result = classifyHolisticIntent('équilibre de vie / fatigue / corps')
      expect(result.category).toBe('lifestyle')
    })

    it('should use "energy" as third priority', () => {
      const result = classifyHolisticIntent('fatigue / sommeil / corps')
      expect(result.category).toBe('energy')
    })

    it('should use "body" as last priority', () => {
      const result = classifyHolisticIntent('corps / digestion')
      expect(result.category).toBe('body')
    })
  })
})

describe('createEmptyHolisticSignal', () => {
  it('should return default empty signal', () => {
    const signal = createEmptyHolisticSignal()

    expect(signal.score).toBe(0)
    expect(signal.matchedKeywords).toEqual([])
    expect(signal.category).toBe('none')
    expect(signal.recommendNaturopath).toBe(false)
    expect(signal.hasClinicalOverride).toBe(false)
    expect(signal.clinicalKeywordsFound).toEqual([])
  })
})

describe('Keyword lists', () => {
  it('should have non-empty holistic keyword lists', () => {
    expect(HOLISTIC_KEYWORDS.body.length).toBeGreaterThan(0)
    expect(HOLISTIC_KEYWORDS.energy.length).toBeGreaterThan(0)
    expect(HOLISTIC_KEYWORDS.lifestyle.length).toBeGreaterThan(0)
    expect(HOLISTIC_KEYWORDS.global.length).toBeGreaterThan(0)
  })

  it('should have non-empty clinical override list', () => {
    expect(CLINICAL_OVERRIDE_KEYWORDS.length).toBeGreaterThan(0)
  })

  it('should have no duplicates in holistic keywords', () => {
    const allKeywords = Object.values(HOLISTIC_KEYWORDS).flat()
    const uniqueKeywords = new Set(allKeywords)
    expect(allKeywords.length).toBe(uniqueKeywords.size)
  })

  it('should have no duplicates in clinical keywords', () => {
    const uniqueKeywords = new Set(CLINICAL_OVERRIDE_KEYWORDS)
    expect(CLINICAL_OVERRIDE_KEYWORDS.length).toBe(uniqueKeywords.size)
  })
})
