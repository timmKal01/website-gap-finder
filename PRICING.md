# Pricing: website-gap-finder

Pay per event, set on Apify on 2026-10-01 (prices chosen by the user). The event names are
charged from `src/main.js` (names in `src/config.js`); `.actor/pay_per_event.json` mirrors the
events for reference (`apify push` does not read it).

| Event | Price | Charged when |
|---|---|---|
| `website-audited` (primary) | $0.003 | Per business whose website was fetched and audited, including sites found broken. |
| `lead-no-website` | $0.001 | Per business with no site to fetch: none, only a social/listing page, or a dead builder's domain. |
| `contacts-extracted` | $0.001 | Per business, only when `extractContacts` is on and an email, phone or WhatsApp link was found on the site. |
| `apify-actor-start` | $0.00005 (Apify default) | Automatically by Apify at the start of every run, one per GB of memory. Don't charge it in code (that fails). It also gives the run its first 5 seconds of compute free. |

**`apify-default-dataset-item` is not in the pricing.** Apify adds that synthetic event by default
and it charges for every dataset row, which would double-charge on top of the per-business events.
Check it stays absent whenever the pricing is edited.

Worked example (also in the README): 1,000 businesses, 600 with a website, 400 without, contacts
found on 300: 600 x $0.003 + 400 x $0.001 + 300 x $0.001 + $0.00005 = $2.50. Range for 1,000
businesses: $1 to $4.

## Decisions built into the code

- Businesses whose site **blocks automated checks** (bot protection, 401/403, robots.txt) are saved but not charged, with `opportunityScore: null`: the user gets nothing they can use from the audit.
- Businesses **filtered out** by `onlyOpportunities` are neither saved nor charged (Apify's guidance: charge for visible results). Unaudited sites are always filtered out there.
- Charges happen **when each row is saved**, and the run stops once the user's maximum cost per run is reached.
- Businesses sharing one website (chains) are fetched once but charged per business row.

## Cost to run

Plain HTTP, no browser, no proxy: 2 requests per business (3 with `auditDepth: "full"`).
Nairobi test, 2026-10-01: 170 businesses (49 websites fetched) in 48 seconds at 512 MB,
0.0066 CU, $0.0013 of platform usage. At these prices that run would have earned $0.29 in events
(49 x $0.003 + 119 x $0.001 + 25 x $0.001), so compute is a rounding error.
Default memory is 512 MB (min 256, max 1024 in `.actor/actor.json`).
