// Finance questions: which messages go to the finance path (get_finance tool) instead of the
// dashboard intents. ONE definition, imported by gieniu-command.js (server) and, for the
// timeout only, by src/lib/gieniuCommand.ts (same arrangement as businessDay / alertRules).
//
// Deliberately narrow. Today-based dashboard questions ("revenue today", "profit today",
// "how are campaigns doing") never match: they carry no payment-operator name, no finance
// word and no past-month reference.

export function normalize(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ą/g, 'a').replace(/ć/g, 'c').replace(/ę/g, 'e')
    .replace(/ł/g, 'l').replace(/ń/g, 'n').replace(/ó/g, 'o')
    .replace(/ś/g, 's').replace(/ź/g, 'z').replace(/ż/g, 'z')
    .replace(/[^\w\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const OPERATOR = /\b(stripe|p24|przelewy ?24|paypal|pay pal)\b/
// Finance vocabulary that cannot belong to a Wix / campaign / webinar question.
const FINANCE_WORD =
  /prowizj|commission|\bnetto\b|\bbrutto\b|\bzwrot|refund|subskrypcj|subscription|abonament|faktur|invoice|finans|ksiegow|accounting|wyplat|payout|oplat\w* bankow|koszty? (z )?bank|\bbank\b/
const MONTH_REF =
  /\b(styczn|stycz|luty|lutego|marz|kwie|maj\b|maja\b|czerw|lip|sierp|wrze|pazdz|listop|grud|january|february|march|april|may|june|july|august|september|october|november|december)\w*|\b\d{4}-(0[1-9]|1[0-2])\b|\b(zeszly|poprzedni|ostatni|ubiegly|ten|biezacy) miesiac|\b(last|previous|this|current) month\b/
const META_WORD = /\bmeta\b|insights|reklam|\bads?\b|obciazen|ad spend/

export function isFinanceQuestion(message) {
  const t = normalize(message)
  if (t === '') return false
  return OPERATOR.test(t) || FINANCE_WORD.test(t) || (MONTH_REF.test(t) && META_WORD.test(t))
}

// Costs from the bank, subscriptions, bank fees, invoices: the audit is not published,
// so the only honest answer is "nie mam tych danych: brak publikacji audytu".
const BANK_COST = /subskrypcj|subscription|abonament|faktur|invoice|oplat\w* bankow|koszty? (z )?bank|\bbank\b|wynagrodz|\bzus\b|\bpit\b|\bvat\b/

export function isBankCostQuestion(message) {
  const t = normalize(message)
  return BANK_COST.test(t) && !OPERATOR.test(t) && !/\bmeta\b/.test(t)
}
