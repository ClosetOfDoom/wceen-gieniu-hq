// Bilingual intent detection for GIENIU Command Gateway.
// Handles English and Polish commands with diacritic normalization.

export type IntentName =
  | 'revenue_today'
  | 'profit_today'
  | 'orders_freshness'
  | 'meta_freshness'
  | 'campaigns_today'
  | 'jsu_funnel'
  | 'clickmeeting_funnel'
  | 'data_health'
  | 'red_flags'
  | 'pipeline'
  | 'creative_recommendations'
  | 'retargeting'
  | 'email_rhythm'
  | 'normal_chat'

export interface IntentDetection {
  intent: IntentName
  confidence: number          // 0–1, ≥ 0.4 means deterministic intent
  language: 'en' | 'pl' | 'mixed'
  matchedTerms: string[]
}

// ── Normalization ─────────────────────────────────────────────────────────────

export function normalizeQuery(s: string): string {
  return s
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

// ── Intent phrase definitions ──────────────────────────────────────────────────
// Phrases are normalized at match time.
// Longer phrases score higher (more specific match = more confident).

const INTENT_DEFS: { intent: IntentName; phrases: string[] }[] = [
  {
    intent: 'profit_today',
    phrases: [
      'ile na czysto', 'zysk dzisiaj', 'zysk dzis', 'jaki zysk', 'ile zysku',
      'profit today', 'how much profit', 'net profit today', 'earned today',
      'profit after ads', 'margin today', 'how much did we earn',
      'zysk po reklamie', 'ile zarobil', 'czy sie oplaca', 'oplaca sie',
      'marza dzis', 'marza dzisiaj', 'profit netto', 'na czysto',
      'estimated profit', 'szacowany zysk', 'ile zarobiony',
    ],
  },
  {
    intent: 'revenue_today',
    phrases: [
      'jak idzie dzisiaj', 'jak idzie', 'ile sprzedalismy', 'ile dzisiaj sprzedalismy',
      'revenue today', 'how are we doing today', 'how are we doing',
      'what are sales', 'sales today', 'wix revenue today', 'how much did we make',
      'today revenue', 'co dzisiaj', 'wyniki dzisiaj', 'ile dzisiaj',
      'how much today', 'how much did we sell', 'total revenue', 'przychod dzisiaj',
    ],
  },
  {
    intent: 'orders_freshness',
    phrases: [
      'czy zamowienia sie aktualizuja', 'zamowienia aktualizuja', 'czy zamowienia sa aktualne',
      'are orders updating', 'orders updating', 'orders fresh', 'orders stale',
      'wix aktualizuje', 'czy wix dziala', 'czy sa zamowienia dzis',
      'wix updating', 'sync zamowien', 'are orders fresh', 'orders sync',
      'zamowienia dzis', 'are wix orders updating',
    ],
  },
  {
    intent: 'meta_freshness',
    phrases: [
      'czy meta sie aktualizuje', 'meta aktualizuje', 'czy meta dziala',
      'is meta updating', 'meta fresh', 'meta stale', 'meta data updating',
      'facebook updating', 'ads updating', 'reklamy sie aktualizuja',
      'czy reklamy dzialaja', 'is facebook updating',
    ],
  },
  {
    intent: 'campaigns_today',
    phrases: [
      'co z kampaniami', 'kampanie dzis', 'co sie dzieje z reklamami',
      'why are campaigns not showing', 'campaigns not showing', 'campaign performance',
      'which campaigns', 'best campaign', 'top campaign', 'show me campaigns',
      'campaign data', 'pokaz kampanie', 'jakie kampanie', 'what campaigns',
    ],
  },
  {
    intent: 'jsu_funnel',
    phrases: [
      'czemu kurs jak sie uczyc sie nie sprzedaje', 'kurs jak sie uczyc',
      'czemu kurs sie nie sprzedaje', 'why did jsu not sell', 'why jsu not selling',
      'jsu funnel', 'webinar jsu', 'jsu webinar', 'funnel jsu',
      'who attended and bought', 'kto byl i kupil', 'kto kupil',
      'attendance rate', 'webinar funnel', 'co z webinarem', 'jsu',
      'jak sie uczyc nie sprzedaje', 'czemu nie sprzedaje',
    ],
  },
  {
    intent: 'data_health',
    phrases: [
      'data health', 'data status', 'co z danymi', 'czy dane sa aktualne',
      'are data fresh', 'is data fresh', 'data freshness', 'dane aktualne',
      'diagnoza', 'co jest nie tak z danymi', 'status danych',
      'co nie dziala', 'what is not working', 'system status',
    ],
  },
  {
    intent: 'red_flags',
    phrases: [
      'what needs attention', 'what should i fix first', 'co naprawic najpierw',
      'co wymaga uwagi', 'what is wrong', 'co jest nie tak', 'co zle',
      'issues today', 'red flags', 'what to fix', 'co naprawic',
      'what is broken', 'biggest problem', 'what is the problem',
      'co poprawic', 'co wymaga natychmiastowej uwagi',
    ],
  },
  {
    intent: 'retargeting',
    phrases: [
      'co przepala kase', 'co przepala budzet', 'co ubic', 'what to kill',
      'what should i kill', 'stop campaigns', 'kill campaigns', 'pause campaigns',
      'wasting money', 'what is wasting money', 'co skalowac', 'what to scale',
      'what should i scale', 'scale ads', 'retargeting', 'retarget',
    ],
  },
  {
    intent: 'creative_recommendations',
    phrases: [
      'creative recommendations', 'best ad creative', 'top performing ad',
      'which ad is best', 'creative performance', 'ad creative analysis',
      'najlepsza reklama', 'co dziala w reklamach',
    ],
  },
  {
    intent: 'email_rhythm',
    phrases: [
      'czy mailing siadl', 'mailing siadl', 'email performance', 'email rhythm',
      'newsletter performance', 'czy mailing dziala', 'email sending',
      'mailing performance', 'deliverability', 'czy emaile docieraja',
    ],
  },
  {
    intent: 'pipeline',
    phrases: [
      'compare today vs yesterday', 'porownaj dzis do wczoraj', 'how was yesterday',
      'week so far', 'ten tydzien', 'compare days', 'weekly trend',
      'compare yesterday', 'tydzien podsumowanie', 'weekly summary',
    ],
  },
  {
    intent: 'clickmeeting_funnel',
    phrases: [
      'clickmeeting', 'click meeting', 'webinar platform', 'clickmeeting funnel',
    ],
  },
]

// ── Language detection ─────────────────────────────────────────────────────────

const PL_MARKERS = ['ile', 'jak', 'czy', 'co', 'czemu', 'kto', 'gdzie', 'dlaczego',
  'kiedy', 'jaki', 'jaka', 'jakie', 'nie', 'sie', 'jest', 'sa', 'byl', 'czy']

function detectLanguage(message: string): 'en' | 'pl' | 'mixed' {
  const hasPolishChars = /[ąćęłńóśźż]/i.test(message)
  const norm = normalizeQuery(message)
  const words = norm.split(/\s+/)
  const hasPolishWords = words.some(w => PL_MARKERS.includes(w))
  const hasEnglishWords = words.some(w => ['how', 'what', 'why', 'are', 'is', 'did', 'the', 'today'].includes(w))

  if (hasPolishChars || hasPolishWords) {
    return hasEnglishWords ? 'mixed' : 'pl'
  }
  return 'en'
}

// ── Main detectIntent() ────────────────────────────────────────────────────────

export function detectIntent(message: string): IntentDetection {
  const norm = normalizeQuery(message)
  const lang = detectLanguage(message)

  let bestScore = 0
  let bestIntent: IntentName = 'normal_chat'
  let bestMatches: string[] = []

  for (const def of INTENT_DEFS) {
    const matches: string[] = []
    for (const phrase of def.phrases) {
      const phraseNorm = normalizeQuery(phrase)
      if (norm.includes(phraseNorm)) {
        matches.push(phrase)
      }
    }
    if (matches.length > 0) {
      // Score by longest phrase matched (more words = more specific = higher confidence)
      const maxWords = Math.max(...matches.map(m => m.split(/\s+/).length))
      const score = 0.4 + Math.min((maxWords - 1) * 0.15, 0.55)  // 1-word=0.4, 2=0.55, 3=0.7, 4+=0.95
      if (score > bestScore) {
        bestScore = score
        bestIntent = def.intent
        bestMatches = matches
      }
    }
  }

  const confidence = Math.min(bestScore, 1.0)
  return {
    intent: confidence >= 0.4 ? bestIntent : 'normal_chat',
    confidence,
    language: lang,
    matchedTerms: bestMatches,
  }
}
