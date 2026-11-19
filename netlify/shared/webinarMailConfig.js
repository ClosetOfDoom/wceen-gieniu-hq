// webinarMailConfig.js — the ONE place with the settings of the automatic webinar mails.
//
// Tuesday = language webinar, Thursday = memory webinar, both at 18:00 Europe/Warsaw.
// The function wakes at 06:00 Warsaw time, builds a Wix campaign from the next unsent template
// of the slot and (only when AUTO is ON and PAUZA is OFF) publishes it with sendAt 07:00.
// AUTO / PAUZA live in Netlify Blobs (toggled in the app), not here.

export const WEBINAR_MAIL_CONFIG = Object.freeze({
  timezone: 'Europe/Warsaw',
  /** Local hour at which the run is allowed to proceed (the cron fires at two UTC hours, see CRON). */
  wakeHour: 6,
  /** Local time of the scheduled send. Wix needs sendAt to be at least 30 minutes ahead. */
  sendAtLocal: '07:00',
  minLeadMinutes: 30,
  /** Warning in the app when the queue of ready templates has this many or fewer. */
  lowQueueThreshold: 3,
  /** Local dates (Europe/Warsaw) on which nothing is sent. */
  skipDates: Object.freeze(['2026-12-24', '2026-12-31']),
  /** Placeholder for the registration link inside the templates. */
  placeholder: '{{WEBINAR_URL}}',
  /** Everything goes to ALL Wix contacts: the same audience the dashboard campaigns used ("contacts-all"). */
  audience: Object.freeze({ labelIds: Object.freeze(['contacts-all']), activeContactsOnly: false }),
  /**
   * "Wyślij test" = the SAME Create + Publish as production, but to exactly ONE Wix contact.
   * testContactId is the existing Wix contact whose PRIMARY e-mail is testRecipient (checked 2026-11-20: SUBSCRIBED,
   * deliverability VALID; Wix sends a contactIds publish to the primary e-mail). Until 2026-11-20 the test contact was
   * fundacja@wceen.com (b2ccc71f-…).
   * Any other audience (a label such as contacts-all, a segment, more contacts) is rejected by assertTestAudience.
   */
  testRecipient: 'fundacjawceen@gmail.com',
  testContactId: 'df6fa121-fe39-426b-bc1b-fc8734bd0812',
  /**
   * A test is scheduled this many minutes ahead (Wix minimum for sendAt is 30). It cannot be immediate: Wix answers
   * HTTP 403 to a publish without sendAt (tried live 2026-11-19, see docs/webinar-mails.md, Blokady).
   */
  testLeadMinutes: 31,
  /**
   * Two UTC hours, so that 06:00 Warsaw is hit in winter (CET = UTC+1 → 05:00 UTC) and in summer
   * (CEST = UTC+2 → 04:00 UTC). On Tue/Thu the run at the wrong hour exits straight away.
   */
  cron: '0 4,5 * * 2,4',
  /**
   * When AUTO was last switched, for a state written before autoChangedAt existed (T2): the deploy of that fix.
   * MAILE_NIE_ODPALILY only counts days whose 06:00 run came AFTER AUTO was on (state.autoChangedAt ?? this).
   */
  autoChangedAtFallback: '2026-11-19T23:01:00.000Z',
  slots: Object.freeze({
    tuesday: Object.freeze({
      label: 'Webinar językowy (wtorek)',
      weekday: 2,
      webinarTime: '18:00',
      dir: 'webinar-mails/tuesday',
      /** Variants alternate per slot: landing page, then ClickMeeting registration, then landing again... */
      variants: Object.freeze({
        landing: 'https://www.wceen.com/webinar-jezyk-w-17h',
        clickmeeting: 'https://fundacjawceen.clickmeeting.com/nauka-jezykow-w-xxi-wieku/register',
      }),
      /** Fragments that identify a mail of this slot (used by the "no send today" safeguard). */
      markers: Object.freeze(['nauka-jezykow-w-xxi-wieku', 'webinar-jezyk-w-17h']),
    }),
    thursday: Object.freeze({
      label: 'Webinar pamięciowy (czwartek)',
      weekday: 4,
      webinarTime: '18:00',
      dir: 'webinar-mails/thursday',
      variants: Object.freeze({
        landing: 'https://www.wceen.com/darmowy-webinar',
        clickmeeting: 'https://fundacjawceen.clickmeeting.com/pamiec-czwartek/register',
      }),
      markers: Object.freeze(['pamiec-czwartek', 'darmowy-webinar']),
    }),
  }),
})
