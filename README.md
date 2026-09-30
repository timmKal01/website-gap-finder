# Website Gap Finder: Google Maps Leads + Website Audit

Find local business leads that need a new or better website. Feed it the results of a **Google Maps**
scraper (or your own list), and it runs a quick **website audit** on every business: no website at
all, only a Facebook or Instagram page, a broken or parked domain, no HTTPS, not mobile friendly,
an outdated site, no online booking. Each business gets an **opportunity score** from 0 to 100,
the reasons behind it, and a one-line pitch you can open your outreach with.

It works for businesses in any country: phone numbers come back in international format, and the
checks read pages in any language.

## Who it's for

- **Web design agencies and freelancers** looking for local clients who clearly need a site.
- **SEO and marketing consultants** who sell website fixes, speed and booking setups.
- **Lead generation sellers** who want to hand clients a scored list, not a raw directory dump.

## What it checks

Every business gets one **website status**:

| Status | Meaning |
|---|---|
| `none` | No website listed |
| `social_only` | The "website" is a Facebook, Instagram, TikTok, WhatsApp, Linktree, Google or booking-app profile (Fresha, Booksy...) |
| `broken` | Doesn't load, doesn't resolve, errors, or is parked / for sale / suspended |
| `dead_builder` | Built on a site builder that has shut down (Google Business Profile websites, Adobe Muse, Business Catalyst, FrontPage, iWeb...) |
| `free_subdomain` | Lives on a free address like `salon.wixsite.com` or `plumber.blogspot.com` |
| `blocked` | The site refuses automated checks (bot protection or robots.txt). Reported, never worked around, and free |
| `ok` | The site loads |

For sites that load, it also checks:

- **HTTPS**, and whether `http://` redirects to `https://` (plus broken SSL certificates)
- **Mobile friendly**: a responsive viewport tag
- **Speed**: how long the homepage takes to load
- **Last copyright year** in the footer (works across languages: ©, (c), "Copyright")
- **Missing title or meta description**
- **Tech stack**: WordPress (and outdated WordPress versions), Wix, Squarespace, Webflow, Shopify and more
- **Online booking**, and which provider: Fresha, Booksy, Calendly, Square, Vagaro, SimplyBook.me, Setmore, Acuity, Mindbody, Treatwell, Zocdoc, OpenTable and 30+ others, plus "Book now" style links in many languages
- **Social links**: Facebook, Instagram, TikTok, X, LinkedIn, YouTube, Pinterest
- **Public business contacts** (optional): business email, phone and WhatsApp link

## How the score works

The score adds up points for every gap found, capped at 100:

| Signal | Points |
|---|---|
| No website | 80 |
| Only a social or listing page | 75 |
| Broken site, or built on a dead builder | 70 |
| Placeholder page ("coming soon") | 40 |
| On a free subdomain | 25 |
| No HTTPS / broken SSL certificate | 20 |
| Not mobile friendly | 20 |
| Copyright 5+ years old (3-4 years: 10) | 15 |
| Appointment business (salon, clinic, dentist...) with no online booking | 12 |
| Homepage over 5 seconds (over 3 seconds: 7) | 12 |
| Outdated WordPress (below 6.0) | 10 |
| Established business: 20+ reviews rated 4.0+ (more likely to pay) | 10 |
| HTTP doesn't redirect to HTTPS | 5 |
| No page title / no meta description | 5 each |

Roughly: **80+** means no real website, **40-70** a site with serious problems, **under 20** a site
in decent shape.

## Input

| Field | Type | Description |
|---|---|---|
| `datasetId` | string | ID of a dataset from another actor, such as a Google Maps scraper run. Field names are mapped automatically: `title`/`name`, `website`/`url`, `phone`, `address`, `city`, `countryCode`, `categoryName`, `totalScore`/`rating`, `reviewsCount`, and the Google Maps `url`. Permanently closed places and duplicates are skipped. |
| `businesses` | array | Your own list: `name`, `website`, and optionally `phone`, `address`, `city`, `country` (name or 2-letter code) and `category`. |
| `auditDepth` | `basic` / `full` | Basic checks the homepage. Full also opens the contact page when one is linked. Default `basic`. |
| `extractContacts` | boolean | Pull the public business email, phone and WhatsApp link from the site. Default `false`. |
| `onlyOpportunities` | boolean | Only save businesses scoring at least `minScore`. Default `false`. |
| `minScore` | integer 0-100 | Default `50`. |
| `maxConcurrency` | integer | Businesses audited at once. Default `10`. |

Give `datasetId`, `businesses`, or both.

```json
{
  "datasetId": "YOUR_GOOGLE_MAPS_DATASET_ID",
  "auditDepth": "basic",
  "extractContacts": true,
  "onlyOpportunities": true,
  "minScore": 50
}
```

## Chain it after a Google Maps scraper

1. Run a Google Maps scraper on Apify (for example **Google Maps Scraper** by compass) with your search, e.g. "hair salon" in "Nairobi". Include the place details that carry the website and phone.
2. When it finishes, open the run's **Storage** tab and copy the **dataset ID**.
3. Start Website Gap Finder with that ID in `datasetId`.

To make it automatic, add an integration to the Google Maps scraper task: **Run Actor** (Website Gap Finder) when the run succeeds, with the input `{ "datasetId": "{{resource.defaultDatasetId}}" }`.

## Output

One row per business:

```json
{
  "name": "Example Plumbing Ltd",
  "category": "Plumber",
  "address": "12 Example Street, Manchester",
  "city": "Manchester",
  "country": "GB",
  "phone": "+441614960000",
  "mapsUrl": "https://www.google.com/maps/place/...",
  "rating": 4.6,
  "reviewCount": 48,
  "websiteUrl": "http://www.example.com/",
  "websiteStatus": "ok",
  "https": false,
  "mobileFriendly": false,
  "responseMs": 3400,
  "techStack": ["WordPress", "jQuery"],
  "lastCopyrightYear": 2017,
  "hasBooking": false,
  "bookingProvider": null,
  "publicEmail": "info@example.com",
  "socialLinks": { "facebook": "https://www.facebook.com/exampleplumbing" },
  "opportunityScore": 72,
  "opportunityReasons": ["No HTTPS", "Not mobile friendly", "Copyright still says 2017", "Established business (48 reviews, rated 4.6)", "Slow homepage (3.4s)"],
  "pitchAngle": "Example Plumbing Ltd's website isn't secure (no HTTPS) and isn't mobile friendly; a refresh could bring in more customers.",
  "auditedAt": "2026-10-01T09:00:00.000Z"
}
```

Also included: `websiteError` (why a site counts as broken), `httpRedirectsToHttps`, `missingTitle`,
`missingMetaDescription`, `whatsapp`, and `phoneSource` (`input` or `website`). The **Outreach**
view in the Output tab shows name, score, pitch, phone, email, WhatsApp and links side by side.

## Example use cases

**Salons in Nairobi.** Scrape "beauty salon" and "barber shop" in Nairobi, then run with
`extractContacts` on. Salons that run on an Instagram or Facebook page alone show up as
`social_only`, and WhatsApp numbers come back in `+254` format, ready to message.

**Plumbers in Manchester, UK.** Scrape "plumber" in Manchester and filter with `onlyOpportunities`
and `minScore: 40`. Look for old copyright years, missing HTTPS and slow homepages, and for
domains that have lapsed or been parked: those businesses are losing calls right now.

**Dentists in Austin, TX.** Scrape "dentist" in Austin and use `auditDepth: "full"`. For practices
that already have a site, the gaps are finer: no online booking (the actor recognizes Zocdoc,
NexHealth, LocalMed and others), slow pages and missing meta tags. A good fit for upsell pitches
rather than new builds.

## Pricing

Pay per event, and only for rows you receive:

- **Start**: Apify's small standard fee per run.
- **Website audited**: per business whose website was fetched and audited, including sites found broken.
- **Lead without a website**: per business with no site to fetch (none, only a social page, or a dead builder's domain). Cheaper, since nothing is fetched.
- **Contacts extracted**: only when `extractContacts` is on and an email, phone or WhatsApp link was found.

Sites that block automated checks are free, and businesses skipped by `onlyOpportunities` are
neither saved nor charged. See the Pricing tab for current prices.

## How it works

- **One or two requests per site**: `robots.txt` (which also tells whether HTTPS works) and the homepage. Full depth adds the contact page. No headless browser, no proxies.
- **Polite**: an honest user agent, `robots.txt` respected, requests to the same site spaced at least a second apart, and businesses sharing one website audited once.
- **Reliable**: timeouts, retries with backoff for temporary errors, and one bad site never stops the run. A summary is logged at the end.

**Limitations**: content drawn entirely by JavaScript can hide booking widgets and copyright
years (shown as unknown, never guessed). Load time is measured from Apify's servers, not from the
business's country.

## Data and outreach compliance

The output is business information the companies publish themselves: their website, business phone
and generic business email. Personal-looking addresses of named staff are skipped on purpose. You
are responsible for how you use it: follow GDPR, PECR in the UK, CAN-SPAM in the US, Kenya's Data
Protection Act and the outreach rules wherever you contact businesses.

## Related actors

- [Website Tech Stack Checker](https://apify.com/m_ctim/website-tech-stack-detector): the full tech-stack detection this actor builds on
- [Tech Stack Lead Finder](https://apify.com/m_ctim/tech-stack-lead-finder): find sites by the technology they use (e.g. Shopify stores without Klaviyo)
- [Website Email & Phone Extractor](https://apify.com/m_ctim/website-lead-extractor): contact details from any list of websites
