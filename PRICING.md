# Pricing: website-gap-finder

**Not set on Apify yet. Prices below are placeholders to fill in after checking competitors.**

The event names are final: they are charged from `src/main.js` (names in `src/config.js`) and
defined for the monetization setup in `.actor/pay_per_event.json`, where `eventPriceUsd` is `0`
until you choose prices. `apify push` does not read that file, so nothing is priced by accident.

| Event | Placeholder price | Charged when |
|---|---|---|
| `apify-actor-start` | Apify default ($0.00005) | Automatically by Apify at the start of every run. Don't charge it in code (that fails). It also gives the run its first 5 seconds of compute free. |
| `website-audited` | **TBD** | Per business whose website was fetched and audited, including sites found broken. |
| `lead-no-website` | **TBD** (lower than `website-audited`) | Per business with no site to fetch: none, only a social/listing page, or a dead builder's domain. |
| `contacts-extracted` | **TBD** | Per business, only when `extractContacts` is on and an email, phone or WhatsApp link was found on the site. |

## Setting it up on Apify

1. Actor > Publication > Monetization: choose **Pay per event**.
2. Add the three custom events above with the titles and descriptions from `.actor/pay_per_event.json`, and make `website-audited` the primary event.
3. Keep `apify-actor-start` at its default price.
4. **Remove the `apify-default-dataset-item` synthetic event.** Apify adds it by default and it charges for every dataset row, which would double-charge on top of the per-business events.
5. Pricing takes about 14 days to activate after you save it.

## Decisions built into the code

- Businesses whose site **blocks automated checks** (bot protection, 401/403, robots.txt) are saved but not charged: the user gets nothing they can use from the audit.
- Businesses **filtered out** by `onlyOpportunities` are neither saved nor charged (Apify's guidance: charge for visible results).
- Charges happen **when each row is saved**, and the run stops once the user's maximum cost per run is reached.
- Businesses sharing one website (chains) are fetched once but charged per business row.

## Cost to run

Plain HTTP, no browser, no proxy: 2 requests per business (3 with `auditDepth: "full"`).
A local test of 17 businesses with full depth and contact extraction finished in 35 seconds.
Default memory is 512 MB (min 256, max 1024 in `.actor/actor.json`).
