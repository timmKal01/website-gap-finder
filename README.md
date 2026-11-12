# Website Gap Finder: Businesses Without Websites + Audit

For web design agencies, freelancers and lead sellers: search a city for a type of business, or give it the businesses from a Google Maps scrape (or your own list), and get back which ones have no working website, a broken one or an outdated one, each scored 0 to 100 with a one-line pitch to open your outreach with.

## What you get

- **A one-step search:** pick a type of business (32 types, from plumbers and dentists to cafes and salons) and a city anywhere in the world. Businesses come from Google Maps, with their rating and review count. Every one that lists a website is audited, and the ones with no website at all come back as leads.
- `websiteStatus` for every business: `none`, `social_only` (only a Facebook or Instagram page), `broken`, `dead_builder`, `free_subdomain`, `blocked` or `ok`
- `opportunityScore` (0 to 100), the `opportunityReasons` behind it, and a ready `pitchAngle` sentence
- For sites that load: HTTPS, mobile layout, load time, the last copyright year, tech stack (WordPress, Wix, Shopify and more) and online booking, with the provider's name
- With `extractContacts` on: the public business email, phone and WhatsApp link from the site, plus every email address and phone number it found (`emails`, `phones`)
- Full Google Maps details for searched businesses: every category, rating and review count, opening hours and map coordinates

Every listed website is actually opened, so a business whose domain has expired, is parked or no longer loads counts as a lead, not as a business that "has a website".

## Two more ways to use it

**Google Maps leads with contacts.** Search a business type and a city, leave `onlyOpportunities` off and turn `extractContacts` on. Every business comes back with its phone numbers, email, website, social profiles, rating, reviews, opening hours and coordinates, plus the website audit. A real row from a local test on 2026-11-11 (plumbers in Denver, CO, with `auditDepth` `full`, shortened):

```json
{
  "name": "Absolute Plumbing, Electrical, Heating & Air",
  "category": "Plumber",
  "categories": ["Plumber", "Air conditioning contractor", "Air conditioning repair service"],
  "phone": "+17209542939",
  "phones": ["+17208075715"],
  "publicEmail": "booking@absolutefix.com",
  "emails": ["booking@absolutefix.com"],
  "rating": 4.8,
  "reviewCount": 3997,
  "hours": ["Tuesday: Open 24 hours", "Wednesday: Open 24 hours"],
  "latitude": 39.797844,
  "longitude": -104.8651943,
  "socialLinks": { "facebook": "https://www.facebook.com/absolutefix", "linkedin": "https://www.linkedin.com/company/absolute-electrical-heating-and-air" },
  "websiteUrl": "https://absolutefix.com/service-area/denver/",
  "websiteStatus": "ok",
  "opportunityScore": 10
}
```

`phone` is the number on Google Maps; `phones` are the numbers on the business's own site. Only business addresses are kept in `emails` (role mailboxes like info@ or booking@, or ones carrying the business name), never a staff member's own.

A business with a website and contact details costs $0.004 ($0.003 for the audit and $0.001 for the contacts).

**Emails and phone numbers from your own list of websites.** Put the sites in `businesses` (`{ "website": "https://..." }` is enough, no name needed), turn `extractContacts` on, and set `auditDepth` to `full` so each site's contact page is read too. You get every email and phone number found, the business email picked from them, social profiles, and the audit.

## Example output

Real output from a run on Apify on 2026-10-22 (before `categories`, `latitude`, `longitude`, `hours`, `emails` and `phones` were added), checking 5 local businesses in 5 countries: a nail salon in New York, a bakery in Toronto, a restaurant in Cape Town, an electrician in Berlin and a dental practice in Sydney. The salon's name, website and phone number are hidden here; every other field shown is exactly what the run returned.

```json
{
  "rowType": "business",
  "name": "(nail salon in Brooklyn, New York, name hidden)",
  "category": "Beauty salon",
  "city": "Brooklyn",
  "country": "US",
  "phone": "+1646XXXXXXX",
  "phoneSource": "input",
  "websiteUrl": "https://(hidden).com/",
  "websiteStatus": "ok",
  "https": true,
  "httpRedirectsToHttps": true,
  "mobileFriendly": true,
  "responseMs": 1167,
  "techStack": ["WordPress", "jQuery"],
  "lastCopyrightYear": 2016,
  "missingMetaDescription": true,
  "hasBooking": true,
  "opportunityScore": 45,
  "opportunityReasons": [
    "Copyright still says 2016",
    "No meta description"
  ],
  "pitchAngle": "(Salon)'s website still says © 2016 and is missing basic SEO tags; a refresh could bring in more customers.",
  "auditedAt": "2026-10-22T07:38:07.190Z"
}
```

`rowType` is `"business"` on every business row. A run that saves no businesses returns one uncharged `"note"` row with a `note` saying why.

The other 4 businesses in that run:

| Business | Status | Score | Main reason |
|---|---|---|---|
| Bakery, Toronto, Canada | `social_only` | 75 | Only a Facebook page, no website |
| Restaurant, Cape Town, South Africa | `dead_builder` | 70 | Built on Google Business Profile websites (shut down in 2024) |
| Electrician, Berlin, Germany | `broken` | 70 | Website not working: domain parked or for sale |
| Dental practice, Sydney, Australia | `ok` | 0 | Site in good shape, little to pitch |

## What it costs

Pay per event, only for the rows you receive. Compute and traffic are included.

| Event | Price | Charged |
|---|---|---|
| Audited website | $0.003 | Per business whose website was fetched and audited, including sites found broken |
| Lead without a website | $0.001 (from 2026-11-15: $0.005) | Per business with nothing to fetch: no website, only a social or listing page, or a shut-down site builder |
| Contacts extracted | $0.001 | Per business, only when `extractContacts` is on and a business email, phone or WhatsApp link was found |
| Actor start | $0.00005 | Apify's standard fee, once per run (one per GB of memory: the default 512 MB counts as one, and a city search's 2 GB as two) |

**Worked example: 1,000 businesses from a Google Maps scrape**, with `extractContacts` on. Say 600 of them list a website, 400 have none or only a Facebook or Instagram page, and 300 of the sites show a business email, phone or WhatsApp link:

| | Businesses | Price | Cost |
|---|---|---|---|
| Audited websites | 600 | $0.003 | $1.80 |
| Leads without a website | 400 | $0.001 | $0.40 |
| Contacts extracted | 300 | $0.001 | $0.30 |
| Run start | 1 | $0.00005 | $0.00005 |
| **Total** | | | **$2.50** |

Any 1,000-business run costs between $1 (no business has a website) and $4 (every one has a site and contact details).

From 2026-11-15, a lead without a website costs $0.005, so the same example comes to $4.10, and a 1,000-business run costs $4 to $5.

**Free:** the search itself, sites that block automated checks (saved with no score and a "Couldn't audit" note), and businesses left out by `onlyOpportunities`, `onlyNoWebsite` or the search, which are neither saved nor charged.

## Use cases

- **Web designers:** search "Hair salons and barbers" in your city, or run a Google Maps scraper for it, keep everything scoring 50 or more, and work down the list.
- **SEO and marketing consultants:** find businesses whose sites lack HTTPS, a mobile layout or online booking, and pitch the fix.
- **Lead sellers:** hand clients a scored list with a reason and a pitch line on every row, not a raw directory dump.
- **Sales teams:** Google Maps leads for any business type and city, with phones, emails, social profiles, ratings and hours.
- **Contact enrichment:** a list of company websites in, every public email and phone number out.

## Input

| Field | Type | Description |
|---|---|---|
| `searchCategory` | select | Type of business to search for: plumbers, electricians, HVAC, roofers, carpenters, painters, hair salons and barbers, beauty and nail salons, massage and spas, tattoo studios, dentists, doctors and clinics, physiotherapists, vets, opticians, gyms, restaurants, cafes, bakeries, hotels, car repair, car dealers, lawyers, accountants, real estate agents, florists, clothing and furniture stores, photographers, driving schools, childcare and laundries. |
| `searchTerm` | string | Or search Google Maps for any business instead, e.g. "yoga studio", "pet groomer" or "wedding photographer". Used in place of `searchCategory` when filled in. A typed search uses Google Maps only. |
| `searchLocation` | string | City or area to search, e.g. "Manchester, UK" or "Westlands, Nairobi". Used with `searchCategory` or `searchTerm`. |
| `searchLocations` | array | More places to search in the same run, up to 25 in all. A business found in two places is kept once, and a place that can't be found gets its own uncharged row while the rest still run. |
| `maxBusinesses` | integer | The most businesses the search audits in each place, which also caps its cost. Default `100`, up to `2000`. |
| `datasetId` | string | ID of a dataset from another actor, such as a Google Maps scraper run. Field names are mapped automatically: `title`/`name`, `website`/`url`, `phone`, `address`, `city`, `countryCode`, `categoryName`, `totalScore`/`rating`, `reviewsCount`, and the Google Maps `url`. Permanently closed places and duplicates are skipped. |
| `businesses` | array | Your own list: `name`, `website`, and optionally `phone`, `address`, `city`, `country` (name or 2-letter code) and `category`. A list of websites alone works too, e.g. to pull contacts. |
| `auditDepth` | `basic` / `full` | Basic checks the homepage. Full also opens the contact page when one is linked. Default `basic`. |
| `extractContacts` | boolean | Pull the public business email, phone and WhatsApp link from the site, plus every email and phone number found (`emails`, `phones`, up to 10 each). With `auditDepth` `full`, the contact page is read too. Default `false`. |
| `onlyNoWebsite` | boolean | Only businesses with no real website: none, only a social or listing page, or a dead site builder. A search reads up to 10 Google Maps listings per lead wanted, and businesses with a website are skipped, not charged. Default `false`. |
| `onlyNew` | boolean | For scheduled runs: skip businesses that earlier runs already returned, so each run brings only new ones. A search reads further down the results to find them, and skipped businesses aren't audited or charged. The list lives in the key-value store `website-gap-finder-seen` in your Apify account; delete it to start over. Default `false`. |
| `seenListName` | string | Keeps a separate "already returned" list per search or client, e.g. `denver-plumbers`, instead of one shared list. Lowercase letters, digits and hyphens. Used with `onlyNew`.
| `onlyOpportunities` | boolean | Only save businesses scoring at least `minScore`. Sites that couldn't be audited are left out too. Default `false`. |
| `minScore` | integer 0-100 | Default `50`. |
| `maxConcurrency` | integer | Businesses audited at once. Default `10`. |

Give a search, `datasetId`, `businesses`, or any combination.

Search a city:

```json
{
  "searchCategory": "hair",
  "searchLocation": "Manchester, UK",
  "maxBusinesses": 100,
  "onlyOpportunities": true,
  "minScore": 50
}
```

Search any business, in several towns at once:

```json
{
  "searchTerm": "yoga studio",
  "searchLocation": "Boulder, USA",
  "searchLocations": ["Fort Collins, USA", "Denver, USA"],
  "maxBusinesses": 50,
  "onlyNoWebsite": true
}
```

New leads every week: schedule this, and each run returns only businesses earlier runs haven't:

```json
{
  "searchCategory": "plumber",
  "searchLocation": "Denver, USA",
  "maxBusinesses": 50,
  "onlyNoWebsite": true,
  "onlyNew": true
}
```

Or audit a Google Maps scrape:

```json
{
  "datasetId": "YOUR_GOOGLE_MAPS_DATASET_ID",
  "auditDepth": "basic",
  "extractContacts": true,
  "onlyOpportunities": true,
  "minScore": 50
}
```

### Chain it after a Google Maps scraper

1. Run a Google Maps scraper on Apify (for example **Google Maps Scraper** by compass) with your search, for example "hair salon" in "Chicago". Include the place details that carry the website and phone.
2. When it finishes, open the run's **Storage** tab and copy the **dataset ID**.
3. Start Website Gap Finder with that ID in `datasetId`.

To make it automatic, add an integration to the Google Maps scraper task: **Run Actor** (Website Gap Finder) when the run succeeds, with the input `{ "datasetId": "{{resource.defaultDatasetId}}" }`.

## Related tools

- [Tech Stack Detector & Lead Finder](https://apify.com/m_ctim/tech-stack-lead-finder): what any site is built on (CMS, hosting, analytics), or sites found by the tools they use, for example Shopify stores without Klaviyo

## Notes

**Website statuses**

| Status | Meaning |
|---|---|
| `none` | No website listed |
| `social_only` | The "website" is a Facebook, Instagram, TikTok, WhatsApp, Linktree, Google or booking-app profile (Fresha, Booksy...) |
| `broken` | Doesn't load, doesn't resolve, errors, shows "page not found", or is parked, for sale or suspended |
| `dead_builder` | Built on a site builder that has shut down (Google Business Profile websites, Adobe Muse, Business Catalyst, FrontPage, iWeb...) |
| `free_subdomain` | Lives on a free address like `salon.wixsite.com` or `plumber.blogspot.com` |
| `blocked` | The site refuses automated checks (bot protection or robots.txt). Reported, never worked around, and free. These rows get no score (`opportunityScore: null`) and a "Couldn't audit" note, so they never pass for healthy sites |
| `ok` | The site loads |

**How the score works.** It adds up points for every gap found, capped at 100:

| Signal | Points |
|---|---|
| No website | 80 |
| Only a social or listing page | 75 |
| Broken site, or built on a dead builder | 70 |
| On a free subdomain (for example `salon.wixsite.com`) | 50 |
| Placeholder page ("coming soon") | 40 |
| Copyright 8+ years old (5-7 years: 20, 3-4 years: 10) | 40 |
| No HTTPS, or a broken or unverifiable SSL certificate | 20 |
| Not mobile friendly | 20 |
| Listed website link leads to a missing page (the homepage works and is audited instead) | 15 |
| Incomplete SSL certificate chain (browsers cope, some apps and browsers warn) | 10 |
| Appointment business (salon, clinic, dentist...) with no online booking | 12 |
| Homepage over 5 seconds (over 3 seconds: 7) | 12 |
| Outdated WordPress (below 6.0) | 10 |
| Established business: 20+ reviews rated 4.0+ (more likely to pay) | 10 |
| HTTP doesn't redirect to HTTPS | 5 |
| No page title, or no meta description | 5 each |

Roughly: **70+** means no working website or a badly outdated one, **40-70** a site with clear problems, and **under 20** a site in decent shape. Sites that couldn't be audited have no score.

**Search mode and Google Maps.** The search looks up the place with OpenStreetMap's place search (Nominatim, with Photon as a backup), then reads that type of business from Google Maps: the same results list the Maps page shows, read through Apify's residential proxy.
- **Coverage:** in a test search on 2026-11-01, 8 pages of Denver plumbers gave 160 businesses, and 19 of them listed no website on Google.
- **Businesses with no website listed come back as leads** (`websiteStatus: "none"`), with their phone, rating and Google Maps link. Every other business gets its website audited. Closed businesses are left out.
- **Order:** Google lists its most prominent businesses first, so a small `maxBusinesses` mostly gets established firms. Raise it to reach the long tail, where most businesses without websites are.
- **If Google Maps doesn't answer,** the search runs on [Overture Maps](https://overturemaps.org) open data instead and the status message says so. There, only businesses that list a website are audited, and chains, closed places and places with little evidence they still exist are skipped.
- **If neither can be read,** the run saves one uncharged note saying so instead of failing. Input it can't use (a type of business without a city, an unknown place) gets one uncharged `error` row saying what to change.
- **Data:** Google Maps rows carry the listing's `mapsUrl`, `placeId`, `rating` and `reviewCount`. Overture rows: Overture Maps Foundation, from sources under CDLA Permissive 2.0, Apache 2.0 (Foursquare) and CC0, with `placeId` like `overture:45ac34d4-...`.

**How it checks.** Two requests per site: `robots.txt` (which also tells whether HTTPS works) and the page itself. Full depth adds the contact page, and a dead listed link adds the homepage. There's no headless browser and no proxies. It uses an honest user agent, respects `robots.txt`, spaces requests to the same site at least a second apart, and audits businesses that share one website once. One bad site never stops the run, and when the run's time limit is close it stops starting new audits and finishes with the ones already done. A city search reads Overture Maps' data for the whole area, so it runs with 2 GB of memory (set automatically when you search; lists and datasets use 512 MB).

**Limitations.** Content drawn entirely by JavaScript can hide booking widgets and copyright years; those show as unknown and are never guessed. Load time is measured from Apify's servers, not from the business's country.

**Data and outreach compliance.** The output is business information the companies publish themselves: their website, business phone and generic business email. Personal-looking addresses of named staff are skipped on purpose. You are responsible for how you use it: follow GDPR, PECR in the UK, CAN-SPAM in the US, Kenya's Data Protection Act and the outreach rules wherever you contact businesses.

**Feedback.** If you use this for client work, tell me in the Issues tab what you'd want next: other countries' quirks, other checks, a different score. I read every issue.
