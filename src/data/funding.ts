// Funding radar — data copied verbatim from FUNDUSZE/dashboard.html (the "radar
// finansowania"). 13 opportunities. Criteria order in `crit` matches C_CRITERIA_LABELS.
// Single source of truth for the FUNDING tab and the Stanley LLM context.
// Do NOT invent programmes, amounts or deadlines outside this table.

export type FundingVerdict = 'GO' | 'MAYBE' | 'SKIP'
export type FundingPathKey = "cogni" | "edukacja" | "ekologia" | "infrastruktura" | "ngo-pes" | "promocja" | "przychod"

export interface FundingItem {
  id: string
  ttl: string
  funder: string
  paths: FundingPathKey[]
  region: string
  type: string
  amtMin: number | null
  amtMax: number | null
  amtNote: string | null
  own: string
  deadline: string | null   // hard date (YYYY-MM-DD) — the ONLY field to count days from
  timing: string            // descriptive text — show literally, never parse to a date
  verdict: FundingVerdict
  crit: number[]            // 10 scores, order = C_CRITERIA_LABELS
  why: string
  entry: string
  link: string
  verify: boolean           // true => UNVERIFIED lead
}

// Path key -> Polish label (from PATHS in dashboard.html).
export const FUNDING_PATHS: Record<FundingPathKey, string> = {
  cogni: "Cogni / IT",
  edukacja: "Edukacja",
  ekologia: "Ekologia",
  infrastruktura: "Infrastruktura",
  "ngo-pes": "NGO / PES",
  promocja: "Promocja",
  przychod: "Przychód / 1,5%",
}

// Criteria labels (from C_LABELS in dashboard.html) — crit[i] corresponds to index i.
export const C_CRITERIA_LABELS: string[] = ["Kwota","Niski wkład","Wkład niefin.","Fit WCEEN","Fit Cogni","Fit infrastr.","Realność","Szybkość","Łączenie","Skalowanie"]

export const FUNDING: FundingItem[] = [
  {
    id: "sektor30", ttl: "Fundusz Sektor 3.0 (#TechForGood)", funder: "FRSI / Polsko-Amerykańska Fundacja Wolności",
    paths: ["cogni", "ngo-pes"], region: "ogólnopolski", type: "dotacja + inkubacja",
    amtMin: null, amtMax: 170000, amtNote: "do 170 tys. zł",
    own: "0% (brak wymaganego wkładu)", deadline: null, timing: "horyzont (nabór cykliczny, ostatni do 26.10.2025 → ed. 2026/27 ~jesień 2026)",
    verdict: "GO", crit: [7, 10, 9, 8, 10, 1, 7, 4, 8, 9],
    why: "Najlepsze dopasowanie do Cogni: grant dla fundacji na demo/wdrożenie cyfrowego narzędzia rozwiązującego problem społeczny, do 170 tys. zł, plus 3-miesięczna inkubacja z mentorami. Bez wymaganego wkładu gotówkowego.",
    entry: "Zgłoś Cogni jako narzędzie przeciw wykluczeniu edukacyjnemu (pamięć, koncentracja, nauka dla seniorów i uczniów z trudnościami). Zespół 2–5 osób. Pilnuj otwarcia ed. 2026/27 i złóż w pierwszych dniach.",
    link: "https://sektor3-0.pl/fundusz/", verify: false,
  },
  {
    id: "pes", ttl: "Pożyczki PES — TISE / OIC Lublin", funder: "TISE · OIC Poland (Lublin)",
    paths: ["ngo-pes", "infrastruktura"], region: "lubelskie / PL", type: "pożyczka preferencyjna (umarzalna)",
    amtMin: null, amtMax: null, amtNote: "zależnie od zdolności",
    own: "0% (brak wymaganego wkładu)", deadline: null, timing: "nabór ciągły (4–10 tyg. do wypłaty)",
    verdict: "GO", crit: [7, 9, 5, 7, 5, 7, 8, 9, 9, 7],
    why: "Najszybsza droga do gotówki (4–10 tyg.), bez wymaganego wkładu, z potencjałem umorzenia do ~40%. Idealna jako finansowanie pomostowe pod dotacje i na pilny remont bazy terenowej.",
    entry: "Napisz do TISE (pes@tise.pl) i OIC Lublin (sekretariat@oic.lublin.pl). Przygotuj uproszczony biznesplan działalności odpłatnej (warsztaty, turnusy, licencje Cogni).",
    link: "https://www.tise.pl/", verify: false,
  },
  {
    id: "oppmech", ttl: "1,5% podatku PIT (mechanizm OPP)", funder: "mechanizm OPP — kampania własna",
    paths: ["przychod", "ngo-pes"], region: "PL", type: "przychód stały (nie grant)",
    amtMin: null, amtMax: null, amtNote: "zależne od kampanii",
    own: "0%", deadline: "2027-04-30", timing: "szczyt: rozliczenia PIT (marzec–kwiecień)",
    verdict: "GO", crit: [5, 10, 9, 9, 5, 5, 8, 5, 9, 8],
    why: "Nie grant, lecz stały strumień przychodu dzięki statusowi OPP — zero kosztu wejścia. Wymaga kampanii (połącz z Google Ad Grants). Najtańszy kapitałowo zasób, który WCEEN już ma.",
    entry: "Zrób prostą stronę „przekaż 1,5%” z numerem KRS, dodaj KRS na wszystkich materiałach, odpal kampanię marzec–kwiecień (wykorzystaj darmowe Google Ads).",
    link: "", verify: false,
  },
  {
    id: "googlead", ttl: "Google Ad Grants dla NGO", funder: "Google for Nonprofits (via ngo.pl)",
    paths: ["promocja", "cogni"], region: "globalny / PL", type: "grant rzeczowy (kredyt reklamowy)",
    amtMin: null, amtMax: null, amtNote: "~10 tys. USD/mc w reklamach",
    own: "0%", deadline: null, timing: "nabór całoroczny",
    verdict: "GO", crit: [5, 10, 10, 7, 8, 1, 8, 8, 7, 7],
    why: "Stały, całoroczny kredyt na reklamy Google Ads — zero gotówki. Idealny do promocji Cogni i naboru uczestników warsztatów. Nie sfinansuje remontu ani pensji, ale tnie koszt dotarcia do zera.",
    entry: "Zweryfikuj kwalifikację (strona eccehomo21.com, treści zgodne z polityką), załóż konto Google for Nonprofits, uruchom kampanie pod Cogni i zielone szkoły.",
    link: "https://fundusze.ngo.pl/aktualne", verify: false,
  },
  {
    id: "nowefio", ttl: "NOWEFIO 2027", funder: "NIW-CRSO",
    paths: ["ngo-pes", "edukacja"], region: "ogólnopolski", type: "dotacja",
    amtMin: 100000, amtMax: 250000, amtNote: null,
    own: "niski / 0% finansowego", deadline: null, timing: "otwarcie naboru ~listopad 2026",
    verdict: "GO", crit: [7, 9, 8, 8, 5, 4, 7, 5, 7, 6],
    why: "Sztandarowy program FIO dla NGO; granty rzędu 100–250 tys., niski lub zerowy wkład finansowy, status OPP punktuje w ocenie. Naturalne miejsce na projekt edukacji pozaformalnej + zielone szkoły z komponentem Cogni.",
    entry: "Przygotuj koncepcję z wyprzedzeniem (edukacja pozaformalna + zielone szkoły + Cogni jako narzędzie). Zgłoś w pierwszym możliwym naborze ~XI 2026.",
    link: "https://niw.gov.pl/", verify: false,
  },
  {
    id: "erasmus", ttl: "Erasmus+ KA2 — partnerstwa małej skali", funder: "FRSE (Erasmus+)",
    paths: ["cogni", "edukacja"], region: "UE", type: "dotacja ryczałtowa (lump sum)",
    amtMin: 130000, amtMax: 260000, amtNote: "30 000 / 60 000 EUR",
    own: "0% (ryczałt)", deadline: null, timing: "nabór ~marzec 2027",
    verdict: "GO", crit: [7, 10, 9, 7, 9, 2, 6, 4, 7, 7],
    why: "Partnerstwa edtech w duchu Cogni — finansowanie ryczałtowe (30/60 tys. EUR), brak wymaganego wkładu finansowego. Warunek: partner zagraniczny. Buduje też prestiż międzynarodowy fundacji.",
    entry: "Zacznij teraz budować 1–2 partnerstwa zagraniczne (szkoły/NGO/edtech). Koncepcja: Cogni w nauczaniu hybrydowym i nauce języków. Nabór ~III 2027.",
    link: "https://erasmusplus.org.pl/", verify: false,
  },
  {
    id: "wfos", ttl: "Edukacja ekologiczna — WFOŚiGW Lublin", funder: "WFOŚiGW w Lublinie",
    paths: ["ekologia", "edukacja", "infrastruktura"], region: "lubelskie", type: "dotacja",
    amtMin: null, amtMax: null, amtNote: "zależnie od edycji",
    own: "częściowy (możliwy niefinansowy)", deadline: null, timing: "okno ~I–II kwartał 2027",
    verdict: "GO", crit: [6, 6, 6, 9, 3, 7, 7, 5, 7, 5],
    why: "Regionalny fundusz wprost pod edukację ekologiczną i zielone szkoły — w samym sercu profilu WCEEN i pod bazę terenową. Najbliższy realny grant „eko” o lokalnej, przyjaznej dla młodej fundacji skali.",
    entry: "Monitoruj ogłoszenia WFOŚiGW Lublin. Przygotuj projekt zielonych szkół / warsztatów terenowych z bazą jako miejscem realizacji.",
    link: "https://www.wfos.lublin.pl/", verify: false,
  },
  {
    id: "niwmrw", ttl: "Fundusz Inicjatyw Międzynar. Roku Wolontariatu", funder: "NIW-CRSO",
    paths: ["ngo-pes", "edukacja"], region: "ogólnopolski", type: "dotacja",
    amtMin: 40000, amtMax: 2100000, amtNote: "pula 2,5 mln",
    own: "niski (sprawdź regulamin)", deadline: null, timing: "otwarty (zweryfikuj termin na ngo.pl)",
    verdict: "MAYBE", crit: [9, 8, 6, 7, 4, 3, 6, 6, 7, 6],
    why: "Duża pula (2,5 mln; granty do 2,1 mln) na zwiększanie aktywności społecznej i wolontariatu. WCEEN może wpisać wolontariat edukacyjny i warsztaty; OPP punktuje. Motyw „wolontariat” trzeba dopasować realnie, nie sztucznie.",
    entry: "Pobierz regulamin, sprawdź czy edukacja pozaformalna + wolontariat młodzieży kwalifikuje. Jeśli tak — projekt łączący zielone szkoły z wolontariatem.",
    link: "https://fundusze.ngo.pl/aktualne", verify: false,
  },
  {
    id: "orlen", ttl: "Program grantowy „Więcej ciepła”", funder: "Fundacja ORLEN",
    paths: ["edukacja", "ngo-pes"], region: "ogólnopolski (zweryfikuj zasięg)", type: "dotacja (CSR)",
    amtMin: null, amtMax: 500000, amtNote: "do 500 tys. zł",
    own: "zależnie od regulaminu", deadline: null, timing: "otwarty / wkrótce (zweryfikuj)",
    verdict: "MAYBE", crit: [8, 7, 6, 8, 4, 5, 6, 6, 7, 6],
    why: "Grant dla NGO działających na rzecz dzieci, młodzieży, seniorów i osób z niepełnosprawnościami; do 500 tys. zł. Edukacja i seniorzy = mocne dopasowanie. Wątpliwość: zasięg terytorialny (oddział „dla Pomorza”).",
    entry: "Sprawdź regulamin i zasięg. Jeśli ogólnopolski — projekt edukacyjny dla seniorów (trening pamięci, Cogni) z wyraźnym wątkiem społecznym.",
    link: "https://fundusze.ngo.pl/aktualne", verify: true,
  },
  {
    id: "felu", ttl: "FELU — infrastruktura / edukacja (7.x)", funder: "Fundusze Europejskie dla Lubelskiego 2021–27",
    paths: ["infrastruktura", "edukacja"], region: "lubelskie", type: "dotacja UE",
    amtMin: null, amtMax: 2000000, amtNote: "do ~2 mln zł",
    own: "znaczny (15–20%+, część niefinansowa)", deadline: null, timing: "horyzont (długi proces)",
    verdict: "MAYBE", crit: [10, 3, 5, 7, 5, 9, 4, 2, 8, 8],
    why: "Największe kwoty i wprost pod bazę/infrastrukturę edukacyjną, ale wysoki wkład własny, długi proces i ostra konkurencja — trudne dla młodej fundacji w pojedynkę. Realne raczej w partnerstwie i z pożyczką pomostową.",
    entry: "Długi horyzont. Najpierw zbuduj historię mniejszymi grantami; rozważ partnerstwo z JST/szkołą; pożyczka PES jako finansowanie pomostowe pod refundację.",
    link: "https://www.funduszeeuropejskie.gov.pl/nabory-wnioskow/", verify: true,
  },
  {
    id: "techedu", ttl: "Mikrogrant: technologia + edukacja + ekologia", funder: "lead z ngo.pl (do weryfikacji)",
    paths: ["cogni", "ekologia", "edukacja"], region: "ogólnopolski", type: "dotacja",
    amtMin: 5000, amtMax: 20000, amtNote: null,
    own: "zwykle niski", deadline: null, timing: "otwarty (lead)",
    verdict: "MAYBE", crit: [3, 8, 7, 8, 7, 2, 7, 7, 6, 4],
    why: "Mała kwota, ale temat w dziesiątkę (technologie + edukacja + ekologia + III sektor). Dobry na szybki pilotaż Cogni albo mikrowarsztat eko-edukacyjny, by zbudować portfolio przed większymi naborami.",
    entry: "Wejdź na ngo.pl, odfiltruj kategorie technologie/edukacja/ekologia, dopasuj konkretny program i złóż szybki, prosty wniosek pilotażowy.",
    link: "https://fundusze.ngo.pl/aktualne?page=1&cats%5B630%5D=631&cats%5B630%5D=637", verify: true,
  },
  {
    id: "big175", ttl: "Program prywatny 40 tys.–1,75 mln zł", funder: "lead z ngo.pl (do weryfikacji)",
    paths: ["ngo-pes"], region: "centralny / prywatny", type: "dotacja",
    amtMin: 40000, amtMax: 1750000, amtNote: null,
    own: "do sprawdzenia", deadline: null, timing: "otwarty (lead)",
    verdict: "MAYBE", crit: [9, 6, 5, 6, 4, 4, 5, 5, 7, 6],
    why: "Wysoki pułap kwotowy z listy prywatnych/centralnych funduszy na ngo.pl — ale bez potwierdzonego zakresu tematycznego. Warte 15 minut weryfikacji, bo górna granica jest poważna.",
    entry: "Otwórz listę „centralne/prywatne” na ngo.pl, znajdź ten program, sprawdź temat i uprawnionych. Jeśli pasuje do edukacji — awansuj do GO.",
    link: "https://fundusze.ngo.pl/aktualne?page=1&cats%5B630%5D=631&cats%5B630%5D=637", verify: true,
  },
  {
    id: "seniorzy15", ttl: "Działania dla seniorów i społeczności (zdrowa żywność)", funder: "Federacja UTW (via ngo.pl)",
    paths: ["edukacja"], region: "lubelskie (m.in.)", type: "dotacja",
    amtMin: 13000, amtMax: 15000, amtNote: null,
    own: "niski", deadline: "2026-07-06", timing: "otwarty — termin 6 lipca 2026",
    verdict: "SKIP", crit: [3, 7, 6, 4, 1, 1, 6, 7, 4, 3],
    why: "WCEEN kwalifikuje się terytorialnie (lubelskie), ale motyw to zdrowa lokalna żywność i integracja wokół rolnictwa — poza profilem fundacji. Wpisalibyśmy się tylko sztucznie, a kwota jest symboliczna.",
    entry: "Pomiń — chyba że masz realny pomysł łączący edukację seniorów ze zdrową żywnością. Lepiej skupić energię na PES, Sektor 3.0 i NOWEFIO.",
    link: "https://fundusze.ngo.pl/aktualne", verify: false,
  },
]
