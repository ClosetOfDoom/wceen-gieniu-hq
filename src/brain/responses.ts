import type { DailyPerformance, DataStatus } from '../services/data'
import type { JsuFunnelSummary } from '../services/webinarFunnel'
import { pct } from '../services/webinarFunnel'
import {
  pickPhrase,
  OPENERS, GOOD_VERDICTS, HIGH_CPA_VERDICTS, SALES_WARNING_VERDICTS,
  NO_DATA_VERDICTS, NEXT_MOVES, META_NOT_LIVE_NOTES,
  JSU_OPENERS, JSU_BOTTLENECK_CLOSES, JSU_OK_CLOSES,
} from './personality'

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number | null | undefined, decimals = 0, suffix = ''): string {
  if (n == null) return '—'
  return n.toFixed(decimals) + suffix
}

function fmtZl(n: number | null | undefined): string {
  if (n == null) return '—'
  return n.toFixed(2) + ' zł'
}

function statusLabel(s: DataStatus): string {
  switch (s) {
    case 'OK': return 'OK'
    case 'META_NOT_LIVE': return 'META NIE LECIAŁA'
    case 'SALES_WARNING': return 'OSTRZEŻENIE SPRZEDAŻ'
    case 'NO_DATA': return 'BRAK DANYCH'
  }
}

// ── Dashboard command types ───────────────────────────────────────────────────

export type CommandKey =
  | 'revenue dzisiaj'
  | 'raport operacyjny'
  | 'pipeline'
  | 'progi CPA'
  | 'progi CPA językowy'
  | 'red flagi'
  | 'kreatywy'
  | 'retargeting'
  | 'rytm maili'
  | 'co tydzień'

export const COMMANDS: { key: CommandKey; label: string }[] = [
  { key: 'revenue dzisiaj', label: 'Przychód dziś' },
  { key: 'raport operacyjny', label: 'Raport operacyjny' },
  { key: 'pipeline', label: 'Pipeline' },
  { key: 'progi CPA', label: 'Progi CPA' },
  { key: 'progi CPA językowy', label: 'Progi CPA językowy' },
  { key: 'red flagi', label: 'Red flagi' },
  { key: 'kreatywy', label: 'Kreatywy' },
  { key: 'retargeting', label: 'Retargeting' },
  { key: 'rytm maili', label: 'Rytm maili' },
  { key: 'co tydzień', label: 'Co tydzień' },
]

// ── JSU command type ──────────────────────────────────────────────────────────

export type JsuCommandKey =
  | 'webinar jak się uczyć'
  | 'czemu kurs się nie sprzedaje'
  | 'funnel JSU'
  | 'porównaj webinary JSU'
  | 'deliverability'
  | 'czy mailing siadł'
  | 'attendance rate'
  | 'kto był i kupił'

// ── Dashboard builders ────────────────────────────────────────────────────────

export function buildRevenueReport(
  perf: DailyPerformance | null,
  status: DataStatus
): string {
  const opener = pickPhrase(OPENERS)
  const nextMove = pickPhrase(NEXT_MOVES)

  if (status === 'NO_DATA') {
    return `${opener}\n\n${pickPhrase(NO_DATA_VERDICTS)}\n\nKolejny ruch: sprawdź scenariusze Make w panelu automatyzacji.`
  }

  const orders = perf?.wix_orders ?? 0
  const revenue = perf?.wix_revenue ?? 0
  const spend = perf?.meta_spend ?? 0
  const cpa = perf?.real_cpa ?? null
  const roas = perf?.real_roas ?? null

  let verdict = ''
  if (status === 'META_NOT_LIVE') {
    verdict = pickPhrase(META_NOT_LIVE_NOTES)
  } else if (status === 'SALES_WARNING') {
    verdict = pickPhrase(SALES_WARNING_VERDICTS)
  } else if (cpa && cpa > 50) {
    verdict = pickPhrase(HIGH_CPA_VERDICTS)
  } else {
    verdict = pickPhrase(GOOD_VERDICTS)
  }

  const lines = [
    opener,
    '',
    verdict,
    '',
    `Zamówienia Wix: ${orders}`,
    `Przychód Wix: ${fmtZl(revenue)}`,
    `Wydatki Meta: ${fmtZl(spend)}`,
    `Realny koszt zakupu: ${cpa != null ? fmtZl(cpa) : '—'}`,
    `Realny ROAS: ${roas != null ? fmt(roas, 2, 'x') : '—'}`,
    '',
    `Kolejny ruch: ${nextMove}`,
  ]

  return lines.join('\n')
}

export function buildOperationalReport(
  perf: DailyPerformance | null,
  status: DataStatus
): string {
  const opener = pickPhrase(OPENERS)
  if (!perf || status === 'NO_DATA') {
    return `${opener}\n\nBrak danych operacyjnych na dziś. Sprawdź Make i połączenie Supabase.`
  }

  const lines = [
    opener,
    '',
    '— RAPORT OPERACYJNY —',
    '',
    `Zamówienia Wix: ${perf.wix_orders}`,
    `Przychód: ${fmtZl(perf.wix_revenue)}`,
    `Meta spend: ${fmtZl(perf.meta_spend)}`,
    `Wyświetlenia: ${fmt(perf.impressions)}`,
    `Kliknięcia linku: ${fmt(perf.link_clicks)}`,
    `Realny koszt zakupu: ${perf.real_cpa != null ? fmtZl(perf.real_cpa) : '—'}`,
    `Realny ROAS: ${perf.real_roas != null ? fmt(perf.real_roas, 2, 'x') : '—'}`,
    `Aktywne reklamy: ${perf.ads_count ?? '—'}`,
    '',
    `Status: ${statusLabel(status)}`,
  ]
  return lines.join('\n')
}

export function buildPipelineReport(): string {
  const opener = pickPhrase(OPENERS)
  return `${opener}

— PIPELINE WCEEN —

Ścieżka pamięć:
  Meta Ads → Pakiet Pamięciowy 119 zł → onboarding mail → webinar "Jak się uczyć" (czw. 18:00) → kurs 549 zł → WSZTP

Ścieżka języki:
  Meta Ads → Pakiet Językowy 114 zł → onboarding mail → webinar Językozak AI (wt. 18:00) → Językozak AI → WSZTP

CPA progi — Pamięć: cel maks. 40 zł / alarm 50 zł / stop 60 zł
CPA progi — Języki: cel 20–25 zł / alarm 30–35 zł / break-even 40 zł

Baza aktywna: ~5000 kontaktów. Segmentuj lub nie pisz do nich.`
}

export function buildCPAThresholds(): string {
  return `${pickPhrase(OPENERS)}

— PROGI CPA — PAKIET PAMIĘCIOWY —
Cel: maks. 40 zł
Alarm: powyżej 50 zł
Nie skalować: powyżej 60 zł
Strata: powyżej 70 zł (chyba że LTV uzasadnia)

Formuła zysku netto:
Liczba zakupów × 70 zł − wydatki Meta = zysk netto po reklamie`
}

export function buildCPAThresholdsLang(): string {
  return `${pickPhrase(OPENERS)}

— PROGI CPA — PAKIET JĘZYKOWY —
Cel: 20–25 zł
Alarm: 30–35 zł
Break-even: 40 zł
Powyżej 40 zł: strata na froncie

Pakiet Językowy to wejście. Cel: domknięcie na Językozaka AI.`
}

export function buildRedFlags(perf: DailyPerformance | null): string {
  const flags: string[] = []

  if (!perf) {
    return `${pickPhrase(OPENERS)}\n\nBrak danych — nie mogę ocenić flag. Sprawdź Make.`
  }

  const cpa = perf.real_cpa ?? 0
  const spend = perf.meta_spend ?? 0
  const orders = perf.wix_orders ?? 0
  const lc = perf.link_clicks ?? 0

  if (cpa > 50) flags.push('CPA Pakietu Pamięciowego przekracza 50 zł')
  if (spend > 0 && orders === 0) flags.push('Duży spend, zero zamówień — sprawdź lejek')
  if (lc > 0 && orders === 0) flags.push('Kliknięcia linku są, zakupów brak — sprawdź landing')
  if (perf.ads_count === 1) flags.push('Tylko jedna aktywna reklama — brak planu B')

  if (flags.length === 0) {
    return `${pickPhrase(OPENERS)}\n\nNa dziś brak czerwonych flag. Ale nie zasypiaj — sprawdź kreatywy.`
  }

  return `${pickPhrase(OPENERS)}\n\n— CZERWONE FLAGI —\n\n${flags.map(f => `⚠ ${f}`).join('\n')}`
}

export function buildCreativesReport(): string {
  return `${pickPhrase(OPENERS)}

— KREATYWY — minimum aktywne —

Pakiet Pamięciowy: 3 filmy + 2 obrazy + 1 advertorial
Pakiet Językowy: 3 filmy + 2 obrazy + 1 advertorial lub quiz

Kąty Pamięć:
  1. Szkoła Cię oszukała
  2. Twój mózg nie jest słaby
  3. Zapamiętaj X informacji w krótkim czasie
  4. Największy błąd podczas nauki
  5. Test pamięci

Kąty Języki:
  1. Nie masz problemu z językami. Masz problem z metodą.
  2. Słówka nie muszą wylatywać z głowy
  3. Język jako gra, nie kara
  4. Most do Językozaka AI

Brak nowych kreacji przez 7+ dni = czerwona flaga.`
}

export function buildRetargetingReport(): string {
  return `${pickPhrase(OPENERS)}

— RETARGETING —

Segmenty:
  • View Content: 7 / 14 / 30 dni
  • Add To Cart: 7 / 14 dni
  • Initiate Checkout: 7 / 14 dni
  • Engagers: 30 / 60 / 90 dni
  • Buyers: 180 dni

Lejek upsell:
  Pakiet Pamięciowy → webinar "Jak się uczyć"
  Kurs "Jak się uczyć" → WSZTP
  Pakiet Językowy → Językozak AI
  Językozak AI → WSZTP / inne programy

ATC i IC muszą mieć osobne zestawy reklam.`
}

export function buildMailRhythm(): string {
  return `${pickPhrase(OPENERS)}

— RYTM MAILI —

Pn: edukacja / historia / problem tygodnia
Wt: Językozak AI — zaproszenie na webinar 18:00
Śr: follow-up po wtorku / sprzedaż JZK / case / replay
Cz: webinar "Jak się uczyć" 18:00
Pt: follow-up po czwartku / sprzedaż kursu / most do WSZTP
Wk: storytelling / dowód społeczny / wartości WCEEN

Pytanie kontrolne: Do którego segmentu piszemy i jaki jest następny logiczny krok tej osoby?`
}

export function buildWeeklyPlan(): string {
  return `${pickPhrase(OPENERS)}

— CO TYDZIEŃ —

Każdy tydzień musi mieć:
  ✓ Wtorek 18:00 — webinar Językozak AI
  ✓ Czwartek 18:00 — webinar "Jak się uczyć"
  ✓ Min. 1 nowa kreacja (film lub obraz)
  ✓ Segmentowany mailing do bazy
  ✓ Sprawdzenie CPA Pakietu Pamięciowego i Językowego
  ✓ Retargeting ATC/IC aktywny
  ✓ Raport operacyjny poniedziałek rano

Nadrzędna zasada: Czy to zwiększa zysk, obniża CPA albo przesuwa klienta bliżej droższego produktu?`
}

// ── JSU Webinar Funnel builders ───────────────────────────────────────────────

function noJsuData(what: string): string {
  return `${pickPhrase(JSU_OPENERS)}\n\n${what}\n\nUruchom najpierw supabase/webinar_funnel_schema.sql i podłącz Make.`
}

export function buildJsuWebinarReport(s: JsuFunnelSummary | null): string {
  if (!s || s.bottleneck === 'NO_DATA') {
    return noJsuData('Brak danych webinarowych JSU w Supabase.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const close = s.bottleneck === 'OK' ? pickPhrase(JSU_OK_CLOSES) : pickPhrase(JSU_BOTTLENECK_CLOSES)

  const lines = [
    opener,
    '',
    '— WEBINAR "JAK SIĘ UCZYĆ" —',
    '',
    `Sesji w historii: ${s.sessions.length}`,
    `Wysłano maili: ${s.hasEmailData ? s.totals.email_sent.toLocaleString('pl-PL') : 'brak danych z ESP'}`,
    `Dostarczono: ${s.hasEmailData ? s.totals.email_delivered.toLocaleString('pl-PL') : '—'} (${pct(s.rates.delivery_rate)})`,
    `Otwarcia: ${s.hasEmailData ? s.totals.email_opens.toLocaleString('pl-PL') : '—'} (OR: ${pct(s.rates.open_rate)})`,
    `Kliknięcia: ${s.hasEmailData ? s.totals.email_clicks.toLocaleString('pl-PL') : '—'} (CTR: ${pct(s.rates.click_rate)})`,
    `Zapisy webinar: ${s.hasClickMeetingData ? s.totals.registered.toLocaleString('pl-PL') : 'brak danych z ClickMeeting'}`,
    `Obecni: ${s.hasClickMeetingData ? s.totals.attendees.toLocaleString('pl-PL') : '—'} (frekwencja: ${pct(s.rates.attendance_rate)})`,
    `Zakupy 7d: ${s.totals.purchases} (konwersja: ${pct(s.rates.purchase_rate)})`,
    `Przychód 7d: ${s.totals.revenue.toFixed(2)} zł`,
    '',
    `Diagnoza: ${s.diagnosis}`,
    '',
    close,
  ]
  return lines.join('\n')
}

export function buildWhyCourseNotSelling(s: JsuFunnelSummary | null): string {
  if (!s || s.bottleneck === 'NO_DATA') {
    return noJsuData('Nie mam pełnych danych funnel — diagnoza niemożliwa.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const missing: string[] = []
  if (!s.hasEmailData) missing.push('Nie mam danych z mailingu, więc nie rozstrzygam deliverability.')
  if (!s.hasClickMeetingData) missing.push('Nie mam danych z ClickMeeting, więc nie rozstrzygam zapisów i obecności.')

  const lines = [
    opener,
    '',
    '— CZEMU KURS "JAK SIĘ UCZYĆ" NIE SPRZEDAJE? —',
    '',
  ]
  if (missing.length) lines.push(...missing, '')
  lines.push(
    `Wąskie gardło: ${s.bottleneck}`,
    '',
    s.diagnosis,
  )
  if (s.bottleneck === 'OK') {
    lines.push(
      '',
      'Możliwe przyczyny przy poprawnym funnelu:',
      '  1. Baza kupujących Pakiet Pamięciowy już kupiła kurs — brak nowych kandydatów.',
      '  2. Brak nowego ruchu na kurs (Meta Ads → PP stop lub niski spend).',
      '  3. Oferta webinaru nie zakomunikowana w follow-upie 24/48/72h.',
      '  4. Sezonowość lub koliduje z innym wydarzeniem.',
    )
  }
  return lines.join('\n')
}

export function buildJsuFunnelReport(s: JsuFunnelSummary | null): string {
  if (!s || s.sessions.length === 0) {
    return noJsuData('Brak sesji JSU w tabeli webinar_sessions.')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const recent3 = s.sessions.slice(0, 3)
  const lines = [
    opener,
    '',
    '— FUNNEL JSU — ostatnie webinary —',
  ]
  for (const sess of recent3) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit', year: 'numeric' })
    lines.push(
      '',
      `Webinar ${date}:`,
      `  Dostarczono: ${sess.email_delivered > 0 ? sess.email_delivered : 'brak'} maili`,
      `  Frekwencja: ${sess.attendee_count}/${sess.registered_count} (${sess.attendance_rate_pct ?? '—'}%)`,
      `  Zakupy: ${sess.purchases}, przychód: ${sess.revenue.toFixed(0)} zł`,
    )
  }
  lines.push('', `Diagnoza: ${s.diagnosis}`)
  return lines.join('\n')
}

export function buildCompareJsuWebinars(s: JsuFunnelSummary | null): string {
  if (!s || s.sessions.length < 2) {
    return noJsuData('Za mało sesji JSU do porównania (minimum 2).')
  }
  const opener = pickPhrase(JSU_OPENERS)
  const lines = [opener, '', '— PORÓWNANIE WEBINARÓW JSU —']
  for (const sess of s.sessions.slice(0, 6)) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
    const attend = sess.attendance_rate_pct != null ? sess.attendance_rate_pct + '%' : '—'
    const conv   = sess.purchase_rate_pct != null ? sess.purchase_rate_pct + '%' : '—'
    lines.push(`  ${date}  frekw: ${attend.padEnd(6)}  konw: ${conv.padEnd(6)}  zakupy: ${sess.purchases}  przych: ${sess.revenue.toFixed(0)} zł`)
  }
  lines.push('', `Wąskie gardło: ${s.bottleneck}`)
  return lines.join('\n')
}

export function buildDeliverabilityReport(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasEmailData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNie mam jeszcze danych z mailingu, więc nie rozstrzygam deliverability.\nPodłącz Make → ESP → Supabase (tabela email_campaigns).`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const delivRate = s.rates.delivery_rate
  const openRate  = s.rates.open_rate
  const isOk = delivRate != null && delivRate >= 0.85

  const lines = [
    opener,
    '',
    '— DELIVERABILITY MAILINGÓW JSU —',
    '',
    `Wysłano: ${s.totals.email_sent.toLocaleString('pl-PL')}`,
    `Dostarczono: ${s.totals.email_delivered.toLocaleString('pl-PL')} (${pct(delivRate)})`,
    `Otwarcia: ${s.totals.email_opens.toLocaleString('pl-PL')} (OR: ${pct(openRate)})`,
    '',
    isOk
      ? 'Dostarczalność OK — powyżej 85%. Problem leży gdzie indziej.'
      : 'Dostarczalność poniżej 85% — sprawdź SPF/DKIM/DMARC, bounces, reputację domeny nadawcy.',
  ]
  return lines.join('\n')
}

export function buildMailingDiagnosis(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasEmailData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNie mam danych z mailingu JSU. Podłącz Make → ESP → Supabase.`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const or = s.rates.open_rate
  const cr = s.rates.click_rate
  const dr = s.rates.delivery_rate

  const verdict = (() => {
    if (dr !== null && dr < 0.85) return 'MAILING SIADŁ — problem z dostarczalnością. Sprawdź domenę i listę.'
    if (or !== null && or < 0.15) return 'Open rate nisko — temat słaby albo maile w spamie/promocjach.'
    if (cr !== null && cr < 0.02) return 'Click rate nisko — CTA w mailu nie pracuje. Zmień copy lub układ.'
    return 'Mailing wygląda OK. Problem leży dalej w funnelu.'
  })()

  return [
    opener, '',
    '— CZY MAILING DO JSU SIADŁ? —', '',
    `Delivery rate: ${pct(dr)}`,
    `Open rate: ${pct(or)}`,
    `Click rate: ${pct(cr)}`,
    '', verdict,
  ].join('\n')
}

export function buildAttendanceRateReport(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasClickMeetingData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNie mam jeszcze danych z ClickMeeting, więc nie rozstrzygam zapisów i obecności.\nPodłącz Make → ClickMeeting → Supabase (webinar_sessions, webinar_participants).`
  }
  const opener = pickPhrase(JSU_OPENERS)
  const ar = s.rates.attendance_rate
  const verdict = ar !== null && ar < 0.60
    ? `Frekwencja ${pct(ar)} — poniżej 60%. Sprawdź sekwencję przypomnień: email 24h + 1h przed. Godzina 18:00 w czwartek się sprawdza, ale przypomnienia mogą podnieść show-up.`
    : `Frekwencja ${pct(ar)} — OK lub brak danych historycznych do porównania.`

  const lines = [opener, '', '— ATTENDANCE RATE JSU —', '']
  for (const sess of s.sessions.slice(0, 5)) {
    const date = new Date(sess.scheduled_at).toLocaleDateString('pl-PL', { day: '2-digit', month: '2-digit' })
    lines.push(`  ${date}  ${sess.attendee_count}/${sess.registered_count}  (${sess.attendance_rate_pct ?? '—'}%)`)
  }
  lines.push('', verdict)
  return lines.join('\n')
}

export function buildWhoAttendedAndBought(s: JsuFunnelSummary | null): string {
  if (!s || !s.hasClickMeetingData) {
    return `${pickPhrase(JSU_OPENERS)}\n\nNie mam danych z ClickMeeting.\nPodłącz Make → ClickMeeting → webinar_participants w Supabase.`
  }
  const opener = pickPhrase(JSU_OPENERS)
  return [
    opener, '',
    '— KTO BYŁ I KUPIŁ — JSU —', '',
    `Łącznie uczestników (wszystkie sesje): ${s.totals.attendees}`,
    `Łącznie zakupów: ${s.totals.purchases}`,
    `Konwersja uczestnik → zakup: ${pct(s.rates.purchase_rate)}`,
    `Przychód łącznie: ${s.totals.revenue.toFixed(2)} zł`,
    '',
    'Lista uczestników w zakładce JSU — kliknij "Pokaż uczestników".',
    '',
    s.totals.purchases === 0 && s.totals.attendees > 0
      ? 'Zero zakupów przy obecnych uczestnikach — sprawdź product mapping w Make (email → wix_order_id).'
      : s.diagnosis,
  ].join('\n')
}
