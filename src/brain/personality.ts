// Gieniu's personality: sassy, Polish-speaking, addresses user as Lifidi.
// Uses phrase pools to avoid repetition. Recent picks stored in localStorage.

const STORAGE_KEY = 'gieniu_recent_picks'
const MAX_RECENT = 3

function getRecent(): string[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]')
  } catch {
    return []
  }
}

function saveRecent(picks: string[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(picks.slice(-MAX_RECENT)))
}

export function pickPhrase(pool: string[]): string {
  const recent = getRecent()
  const available = pool.filter(p => !recent.includes(p))
  const source = available.length > 0 ? available : pool
  const pick = source[Math.floor(Math.random() * source.length)]
  saveRecent([...recent, pick])
  return pick
}

export const OPENERS = [
  'Lifidi, masz dane. Słuchaj uważnie.',
  'Dobra, Lifidi — oto co widzę.',
  'No to lecimy, Lifidi.',
  'Sprawdziłem. Mam dla ciebie raport.',
  'Lifidi, nie będę owijać w bawełnę.',
  'OK Lifidi, czas na konkrety.',
  'Masz pięć minut? Mam ci coś do powiedzenia, Lifidi.',
  'Dane są. Interpretacja też. Oto ona, Lifidi.',
]

export const GOOD_VERDICTS = [
  'Sytuacja jest pod kontrolą.',
  'Liczby wyglądają przyzwoicie.',
  'Na ten moment — zielone światło.',
  'Maszyna działa. Nie psuć tego.',
  'CPA trzyma się w ryzach. Kontynuować.',
]

export const HIGH_CPA_VERDICTS = [
  'CPA wymknął się spod kontroli. Reaguj teraz.',
  'Koszt zakupu za wysoki — reklamy jedzą zysk.',
  'Uwaga: reklamy drożeją, sprzedaż nie nadąża.',
  'Za drogo pozyskujesz klientów. Sprawdź kreatywy.',
]

export const SALES_WARNING_VERDICTS = [
  'Wydajesz na reklamy, ale kasa nie wpływa. Zły dzień czy zły lejek?',
  'Meta bierze kasę, Wix milczy. Sprawdź landing, checkuot, piksela.',
  'Pieniądze idą, zamówień brak. To jest czerwona flaga, Lifidi.',
]

export const NO_DATA_VERDICTS = [
  'Nie ma co analizować — brak danych na dziś.',
  'Supabase pusty jak poniedziałek rano. Sprawdź Make.',
  'Zero danych. Albo Make nie leciał, albo dzień jeszcze młody.',
]

export const NEXT_MOVES = [
  'Sprawdź kreatywy — czy masz min. 3 filmy aktywne?',
  'Zweryfikuj retargeting: ATC i IC osobno?',
  'Wtorek: webinar JZK. Czwartek: webinar Jak się uczyć. Promuj.',
  'Czy baza mailowa dostaje spersonalizowane kampanie czy niesegmentowane?',
  'Sprawdź, czy jedna reklama nie bierze ponad 70% budżetu.',
  'Nowe kreatywy? Jeśli nie ma świeżych od 7 dni — to problem.',
  'Upewni się, że kupujący dostają upsell, a nie ten sam produkt.',
]

export const META_NOT_LIVE_NOTES = [
  'Meta spend dzisiaj: zero. Kampanie wyłączone albo jeszcze nie ruszyły.',
  'Reklamy nie leciały. Wix działa, Meta śpi.',
  'Brak spend Meta — organik albo reklamy zatrzymane?',
]

// ── JSU Webinar Funnel phrases ────────────────────────────────────────────────

export const JSU_OPENERS = [
  'Lifidi, sprawdziłem funnel "Jak się uczyć". Masz wyniki.',
  'OK, pogrzebałem w danych webinarowych. Oto co znalazłem, Lifidi.',
  'Kurs za 549 zł nie sprzedaje — zajmijmy się tym, Lifidi.',
  'Funnel JSU pod lupą. Nie owijam w bawełnę.',
  'Lifidi, czas zdiagnozować lejek czwartkowego webinaru.',
  'Dane webinarowe JSU — oto diagnoza bez owijania w bawełnę.',
]

export const JSU_BOTTLENECK_CLOSES = [
  'Napraw ten jeden etap — reszta lejka jest bez znaczenia dopóki to nie działa.',
  'Jedno wąskie gardło blokuje cały przychód. Zacznij od niego.',
  'Nie optymalizuj dalszych etapów zanim ten nie jest naprawiony.',
  'Ten etap wymaga natychmiastowej uwagi — reszta poczeka.',
]

export const JSU_OK_CLOSES = [
  'Funnel technicznie OK — sprawdź segmentację i ofertę webinaru.',
  'Liczby się zgadzają. Może problem to brak nowych uczestników, nie konwersja.',
  'Lejek działa. Pytanie: czy docierasz do właściwych ludzi?',
  'Wszystkie wskaźniki zielone. Kopaj głębiej w produkt i pitch.',
]
