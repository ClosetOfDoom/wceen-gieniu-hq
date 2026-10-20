# Duplikaty z 15-20.08.2026 — co zostało usunięte i dlaczego

Wygenerowane 2026-10-20 przez `scripts/reconcile-wix-export.mjs`.
SQL: `supabase/migrations/20261020_dedup_august_duplicates.sql`.

Ten plik jest śladem. Po wykonaniu DELETE tylko tutaj zostaje zapis, że te
wiersze kiedykolwiek istniały — i tylko tutaj zostają **numery zamówień Wix**,
jeśli SQL przepisał je przy niewgranej kolumnie `orders.wix_order_number`.

## Co się stało

Make wyczerpał limit operacji i scenariusze stanęły na sześć dni. Zamówienia
wklejono ręcznie, z `external_order_id` w postaci `wix-<numer zamówienia Wix>`.
Po odblokowaniu limitu scenariusz pobrał część tych samych zamówień jeszcze
raz, już z prawdziwym UUID-em.

Wklejki wg `inserted_at`:

- `2026-08-14T10:29:15.034727+00:00` — 16 wierszy
- `2026-08-20T14:14:18.635945+00:00` — 68 wierszy

Z nich 67 zostało zdublowanych i jest do usunięcia, a 17 nie ma pary
i musi zostać.

## Do usunięcia — 67 wierszy, 8243.40 zł

Usuwany jest wiersz z wklejki. Zostaje wiersz z UUID-em: niesie własne id Wix
i pełną precyzję `order_created_at` (wklejka zaokrągliła do pełnej sekundy).
Kolumna "numer" to liczba wyjęta z `external_order_id` wklejki — jedyne
miejsce w bazie, gdzie numer zamówienia Wix w ogóle występuje.

| usuwany (wklejka) | zostaje (UUID) | order_created_at | kwota | produkt |
|---|---|---|---|---|
| wix-15181 | 21346d51-aaf6-490f-810f-4b35183700dd | 2026-08-15T05:36:49+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15182 | c9004b0e-2a55-46dd-8200-39123cde26d4 | 2026-08-15T08:17:32+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15184 | 9b6b02f7-eee6-4847-8aeb-6eef3594f5e3 | 2026-08-15T09:23:09+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15185 | b663111f-5e2a-42d9-8242-68023117ff8a | 2026-08-15T10:07:44+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15186 | 3494636e-eac6-4050-8092-1c014ddccf07 | 2026-08-15T10:33:35+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15187 | e637fe48-20ac-410a-8271-b0cdf468db62 | 2026-08-15T11:35:21+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15188 | ea9135d5-3cf5-4264-8d4f-10c4c406414e | 2026-08-15T16:08:13+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15189 | 9f2fbe4d-0b53-4552-889a-346062fad1c6 | 2026-08-15T17:08:23+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15190 | a2838a9b-bc49-417c-9d9a-1d77239b37d6 | 2026-08-15T18:56:16+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15191 | 46be6a5d-549d-4aaf-9e5c-ff71670bb4d1 | 2026-08-15T19:21:56+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15193 | ea835aed-aab2-4240-9d71-16b77da2de72 | 2026-08-15T21:29:27+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15194 | bcb4a40b-42ac-498f-a2f7-b71ee37caedb | 2026-08-16T04:19:32+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15195 | 57d4aa5b-5cca-43e1-ba94-e89a39d2a060 | 2026-08-16T05:41:06+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15196 | 936d3ab9-4f32-48ff-8c00-3f7567317723 | 2026-08-16T06:08:20+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15197 | 186c3bd3-97d5-479b-ad7f-dae560929766 | 2026-08-16T06:18:39+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15198 | 3f29d685-b523-4021-a05f-c08cddccacfc | 2026-08-16T06:24:39+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15199 | 110939df-7e30-4edd-9533-8f9de3c19a00 | 2026-08-16T07:18:50+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15200 | 657a57be-8f44-4097-8742-abc05d480f60 | 2026-08-16T08:34:59+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15201 | 1422ae04-2d1d-41ad-91cd-e2ac83980acb | 2026-08-16T08:59:23+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15202 | 2bef5dd2-c5d6-4fb8-a85e-a0a333c3d74b | 2026-08-16T09:19:29+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15203 | b8d28234-3f80-4dd7-bdd3-c7a5a45f556e | 2026-08-16T10:14:15+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15204 | 35691398-6827-405d-81f6-a64515eafc1e | 2026-08-16T14:21:29+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15205 | 5f52f460-f85f-4552-ba04-c0461e04da76 | 2026-08-16T17:23:18+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15206 | af366f87-8f4a-40a0-b84f-af9f523252d0 | 2026-08-16T17:44:26+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15207 | f018bb20-79aa-49d7-9300-aa64992e7479 | 2026-08-17T04:46:01+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15208 | 94a0f23c-17a0-4b5b-8d46-981c77c24f45 | 2026-08-17T05:40:18+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15209 | b4477d60-eb56-464e-b1a5-8b54337499ce | 2026-08-17T06:40:50+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15210 | 4050ce0b-5277-42d3-b76e-95aeecad9bb0 | 2026-08-17T09:25:27+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15211 | 5bdd6850-1944-4fd9-b2f5-98e4e4a24363 | 2026-08-17T11:14:04+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15212 | c633612c-b9b5-401b-b32f-4351b3c78321 | 2026-08-17T11:49:22+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15213 | 7ea5a0aa-3c30-4fef-84b9-5d7e4c07cf09 | 2026-08-17T12:19:54+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15214 | c4dc4df7-0162-4697-af55-07c7de1ed93f | 2026-08-17T16:58:43+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15215 | 744be5cb-390f-4a2f-8611-6aad3d6af052 | 2026-08-17T17:41:28+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15216 | e04995cd-9178-46ab-b68b-3f2ac2945452 | 2026-08-17T17:45:18+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15217 | 324cd5cd-479c-445b-915b-e6e196f8f367 | 2026-08-17T17:46:24+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15218 | 1b804a08-ee31-4bec-8b26-68ad3cc1ab0a | 2026-08-17T18:42:11+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15219 | 1aa9da93-806e-4a61-b8eb-3b26cee7d124 | 2026-08-17T18:58:30+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15220 | ab411d14-03d6-4204-9f14-d884b79cf20b | 2026-08-17T21:23:57+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15221 | 2ae63aae-6d9f-4109-b6c0-daff1409b615 | 2026-08-18T05:28:30+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15222 | 96d4fef1-b314-442c-8a38-394c8ea629cf | 2026-08-18T06:05:43+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15223 | b2b3c2a4-4452-4c47-ae02-815e3f33f379 | 2026-08-18T07:24:18+00:00 | 180.50 | Pamięć. Trening interaktywny |
| wix-15224 | 81baeedd-4801-4433-98a8-d119d3f96119 | 2026-08-18T08:06:32+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15225 | f88b828e-b05b-4305-a41c-dab6ad5bbb5f | 2026-08-18T08:53:44+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15226 | 3c41bc77-83f9-41ea-878a-fba29d8e4c6d | 2026-08-18T10:31:23+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15227 | 6c950e6e-7622-42a9-8b2f-e1df41116796 | 2026-08-18T11:26:51+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15228 | c7b1222b-5608-4453-b5dc-0437f1320182 | 2026-08-18T13:57:10+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15229 | 82caedb8-2819-4260-991a-2fbe72d9f3dd | 2026-08-18T17:27:23+00:00 | 347.00 | Językozak AI - aplikacja do nauki języków z mnemotechnik |
| wix-15230 | 41da22b6-4bdc-4eb0-83fd-c20ff7e78e46 | 2026-08-18T19:13:41+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15231 | 98067bee-d1b2-49a5-ab33-1a578f5d3a0c | 2026-08-18T20:40:25+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15232 | 8c4f9282-aec8-4da0-856e-c1e32e80ac93 | 2026-08-19T05:32:31+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15233 | e5d357f8-bfee-45c2-9a02-3b7a5bacddb8 | 2026-08-19T05:37:23+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15234 | a9c2dc2f-6c4c-4eaf-9a86-182a52c7a773 | 2026-08-19T06:39:31+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15235 | 7cbf1044-4972-498e-959d-021196e4f273 | 2026-08-19T06:41:20+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15236 | 1cfee7b5-7db6-4764-9cfd-c661cd780f1e | 2026-08-19T08:32:59+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15237 | e87e9eff-e93c-4a00-b61c-871c5f4d4a9f | 2026-08-19T08:49:56+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15238 | 13bdcbd6-7991-4c70-b523-771f90725075 | 2026-08-19T10:30:27+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15239 | 8076bde1-3306-4fbf-a591-c7b57fa6feda | 2026-08-19T10:52:26+00:00 | 99.90 | 3 Zadziwiające Techniki Nauki Języków - Pakiet Językowy |
| wix-15240 | 21acac51-f4e9-45c9-b06c-023ca8e0981c | 2026-08-19T11:11:40+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15241 | e729237e-63c4-4189-987d-68ab4378cb29 | 2026-08-19T13:34:53+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15242 | dd184c25-4beb-472f-9178-97523f339bac | 2026-08-19T13:52:42+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15243 | 4d63e600-f6cb-48ca-b1a3-9bf3e6936aba | 2026-08-19T15:36:54+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15244 | bc717a86-05e4-4973-8821-4902dac9e483 | 2026-08-19T19:28:11+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15245 | 55d4fca2-71c7-42c0-85f4-6d009aa467bc | 2026-08-19T20:57:39+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15246 | 02d4509a-9de1-4ebe-a47c-7b55846118d8 | 2026-08-20T05:33:25+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15247 | 10c39e74-357b-4453-a7f1-7ab667e1a458 | 2026-08-20T12:30:31+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15248 | d43788f9-5c49-450b-b8bb-c93b0b3abdad | 2026-08-20T13:07:00+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15249 | cb93846f-d75c-43dd-a582-536bbae94fc6 | 2026-08-20T13:44:04+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |

## NIE usuwać — 17 wierszy bez pary

Sync nigdy nie pobrał ich ponownie. To jedyna kopia tej sprzedaży.
`DELETE ... LIKE 'wix-%'` zabrałby je razem z duplikatami.

| external_order_id | order_created_at | kwota | produkt |
|---|---|---|---|
| wix-15159 | 2026-08-13T12:38:13+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15160 | 2026-08-13T13:36:48+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15161 | 2026-08-13T13:53:44+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15162 | 2026-08-13T14:03:43+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15164 | 2026-08-13T16:44:42+00:00 | 549.00 | Kurs online "Jak się uczyć" (11 modułów, 5h+ nagrań) (wa |
| wix-15165 | 2026-08-13T17:26:28+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15166 | 2026-08-13T18:01:59+00:00 | 549.00 | Kurs online "Jak się uczyć" (11 modułów, 5h+ nagrań) (wa |
| wix-15167 | 2026-08-14T04:21:27+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15168 | 2026-08-14T05:39:22+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15169 | 2026-08-14T05:54:15+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15171 | 2026-08-14T06:43:00+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15170 | 2026-08-14T06:43:03+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15172 | 2026-08-14T06:43:57+00:00 | 119.00 | Pakiet Pamięciowy – Pamięć + bonusy (…Jak się uczyć…) |
| wix-15173 | 2026-08-14T07:16:31+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15174 | 2026-08-14T08:39:15+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15175 | 2026-08-14T08:45:38+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
| wix-15180 | 2026-08-14T22:11:09+00:00 | 119.00 | Pamięć. Trening Interaktywny: Ebook + Druk (Wartość: 158 |
