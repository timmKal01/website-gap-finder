# Website Gap Finder: Businesses Without Websites + Audit

For web design agencies, freelancers and lead sellers: give it the businesses from a Google Maps scrape (or your own list) and get back which ones have no website, a broken one or an outdated one, each scored 0 to 100 with a one-line pitch to open your outreach with.

## What you get

- `websiteStatus` for every business: `none`, `social_only` (only a Facebook or Instagram page), `broken`, `dead_builder`, `free_subdomain`, `blocked` or `ok`
- `opportunityScore` (0 to 100), the `opportunityReasons` behind it, and a ready `pitchAngle` sentence
- For sites that load: HTTPS, mobile layout, load time, the last copyright year, tech stack (WordPress, Wix, Shopify and more) and online booking, with the provider's name
- With `extractContacts` on: the public business email, phone and WhatsApp link from the site

Every listed website is actually opened, so a business whose domain has expired, is parked or no longer loads counts as a lead, not as a business that "has a website".

## Example output

Real output from a run on Apify on 2026-10-19, checking 5 beauty salons in Nairobi. The business's name, website and phone number are hidden here; every other field is exactly what the run returned.

```json
{
  "name": "(beauty salon in Nairobi, name hidden)",
  "category": "Beauty salon",
  "city": "Nairobi",
  "country": "KE",
  "phone": "+2547XXXXXXXX",
  "phoneSource": "website",
  "websiteUrl": "https://(hidden).com/beauty-salon",
  "websiteStatus": "ok",
  "websiteError": "listed page not found (HTTP 404), homepage audited instead",
  "https": true,
  "httpRedirectsToHttps": true,
  "mobileFriendly": true,
  "responseMs": 24,
  "lastCopyrightYear": 2018,
  "hasBooking": false,
  "opportunityScore": 67,
  "opportunityReasons": [
    "Copyright still says 2018",
    "Listed website link leads to a missing page",
    "No online booking"
  ],
  "pitchAngle": "(Salon)'s website still says © 2018 and is listed with a link to a missing page; a refresh could bring in more customers.",
  "auditedAt": "2026-10-19T04:01:31.890Z"
}
```

The other 4 salons in that run:

| Status | Score | Main reason |
|---|---|---|
| `none` | 80 | No website |
| `social_only` | 75 | Only a Facebook page, no website |
| `broken` | 70 | Website not working: domain doesn't resolve |
| `ok` | 0 | Site in good shape, little to pitch |

## What it costs

Pay per event, only for the rows you receive. Compute and traffic are included.

| Event | Price | Charged |
|---|---|---|
| Audited website | $0.003 | Per business whose website was fetched and audited, including sites found broken |
| Lead without a website | $0.001 | Per business with nothing to fetch: no website, only a social or listing page, or a shut-down site builder |
| Contacts extracted | $0.001 | Per business, only when `extractContacts` is on and a business email, phone or WhatsApp link was found |
| Actor start | $0.00005 | Apify's standard fee, once per run (one per GB of memory; the default 512 MB counts as one) |

**Worked example: 1,000 businesses from a Google Maps scrape**, with `extractContacts` on. Say 600 of them list a website, 400 have none or only a Facebook or Instagram page, and 300 of the sites show a business email, phone or WhatsApp link:

| | Businesses | Price | Cost |
|---|---|---|---|
| Audited websites | 600 | $0.003 | $1.80 |
| Leads without a website | 400 | $0.001 | $0.40 |
| Contacts extracted | 300 | $0.001 | $0.30 |
| Run start | 1 | $0.00005 | $0.00005 |
| **Total** | | | **$2.50** |

Any 1,000-business run costs between $1 (no business has a website) and $4 (every one has a site and contact details).

**Free:** sites that block automated checks (saved with no score and a "Couldn't audit" note), and businesses left out by `onlyOpportunities`, which are neither saved nor charged.

## Use cases

- **Web designers:** scrape "hair salon" in your city, keep everything scoring 50 or more, and work down the list starting with businesses that have no site at all.
- **SEO and marketing consultants:** find businesses whose sites lack HTTPS, a mobile layout or online booking, and pitch the fix.
- **Lead sellers:** hand clients a scored list with a reason and a pitch line on every row, not a raw directory dump.

## Input

| Field | Type | Description |
|---|---|---|
| `datasetId` | string | ID of a dataset from another actor, such as a Google Maps scraper run. Field names are mapped automatically: `title`/`name`, `website`/`url`, `phone`, `address`, `city`, `countryCode`, `categoryName`, `totalScore`/`rating`, `reviewsCount`, and the Google Maps `url`. Permanently closed places and duplicates are skipped. |
| `businesses` | array | Your own list: `name`, `website`, and optionally `phone`, `address`, `city`, `country` (name or 2-letter code) and `category`. |
| `auditDepth` | `basic` / `full` | Basic checks the homepage. Full also opens the contact page when one is linked. Default `basic`. |
| `extractContacts` | boolean | Pull the public business email, phone and WhatsApp link from the site. Default `false`. |
| `onlyOpportunities` | boolean | Only save businesses scoring at least `minScore`. Sites that couldn't be audited are left out too. Default `false`. |
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

### Chain it after a Google Maps scraper

1. Run a Google Maps scraper on Apify (for example **Google Maps Scraper** by compass) with your search, for example "hair salon" in "Nairobi". Include the place details that carry the website and phone.
2. When it finishes, open the run's **Storage** tab and copy the **dataset ID**.
3. Start Website Gap Finder with that ID in `datasetId`.

To make it automatic, add an integration to the Google Maps scraper task: **Run Actor** (Website Gap Finder) when the run succeeds, with the input `{ "datasetId": "{{resource.defaultDatasetId}}" }`.

## Related tools

- [Website Email & Phone Extractor](https://apify.com/m_ctim/website-lead-extractor): contact details from any list of websites
- [Website Tech Stack Detector](https://apify.com/m_ctim/website-tech-stack-detector): what a site is built on (CMS, hosting, analytics), one row per URL
- [Tech Stack Lead Finder](https://apify.com/m_ctim/tech-stack-lead-finder): find sites by the technology they use, for example Shopify stores without Klaviyo

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

**How it checks.** Two requests per site: `robots.txt` (which also tells whether HTTPS works) and the page itself. Full depth adds the contact page, and a dead listed link adds the homepage. There's no headless browser and no proxies. It uses an honest user agent, respects `robots.txt`, spaces requests to the same site at least a second apart, and audits businesses that share one website once. One bad site never stops the run.

**Limitations.** Content drawn entirely by JavaScript can hide booking widgets and copyright years; those show as unknown and are never guessed. Load time is measured from Apify's servers, not from the business's country.

**Data and outreach compliance.** The output is business information the companies publish themselves: their website, business phone and generic business email. Personal-looking addresses of named staff are skipped on purpose. You are responsible for how you use it: follow GDPR, PECR in the UK, CAN-SPAM in the US, Kenya's Data Protection Act and the outreach rules wherever you contact businesses.

**Feedback.** If you use this for client work, tell me in the Issues tab what you'd want next: other countries' quirks, other checks, a different score. I read every issue.
