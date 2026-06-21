// Polish UI strings — mirrors the structure of en.ts exactly.
import type { Strings } from './en'

const pl: Strings = {
  kpi: {
    wixOrders:        'Zamówienia Wix',
    wixRevenue:       'Przychód Wix',
    adSpend:          'Wydatki Meta',
    estProfit:        'Szac. Zysk',
    realCpa:          'Realne CPA',
    realRoas:         'Realne ROAS',
    marginBeforeAds:  'Marża przed reklamą',
    profitPerOrder:   'Zysk / zamówienie',
    trueCpa:          'Prawdziwe CPA',
    marginRoas:       'ROAS marży',
    unmappedRevenue:  'Niezmapowany przychód',
    metaAttr:         'Atrybucja Meta',
  },

  sublabel: {
    marginMinusSpend:   'Marża − wydatki Meta',
    metaSpendPerOrder:  'Wydatki Meta / zamówienia Wix',
    revenuePerSpend:    'Przychód Wix / wydatki Meta',
    knownContribution:  'Znana marża kontrybucyjna',
    afterAdSpend:       'Po wydatkach na reklamy',
    adSpendPerOrder:    'Wydatki Meta ÷ opłacone zamówienia',
    revenuePerAdSpend:  'Przychód ÷ wydatki Meta',
    needsMapping:       'Wymaga mapowania marży',
    allProductsMapped:  'Wszystkie produkty zmapowane',
    metaReported:       'Zakupy wg Meta',
  },

  status: {
    loading:            'Ładowanie danych…',
    noDataYet:          'Brak danych na dziś — pokazuję ostatnie dostępne',
    filterMismatch:     '⚠ Punkt profit zwrócił 0 zamówień, ale ordersData pokazuje zamówienia na dziś — niezgodność filtru lub stary cache.',
    unmappedWarning:    '⚠ przychód z niezmapowanych produktów — marża kontrybucyjna nie jest uwzględniona w szac. zysku.',
  },

  panel: {
    revenueTrend:   'Trend przychodu — 7 dni',
    roasFormula:    'Realne ROAS = Przychód Wix ÷ Wydatki Meta',
    cpaFormula:     'Realne CPA = Wydatki Meta ÷ Zamówienia Wix',
    campaigns:      'Kampanie',
    jsuFunnel:      'Lejek webinaru JSU',
    diagnostics:    'Diagnostyka',
    settings:       'Ustawienia',
  },

  voice: {
    listening:      'Słucham…',
    thinking:       'Myślę…',
    tapToSpeak:     'Dotknij, żeby mówić',
    holdToSpeak:    'Przytrzymaj, żeby mówić',
    notSupported:   'Rozpoznawanie mowy nie jest obsługiwane w tej przeglądarce.',
  },

  freshness: {
    fresh:    'aktualne',
    stale:    'nieaktualne',
    unknown:  'nieznane',
    today:    'dziś',
  },
}

export default pl
