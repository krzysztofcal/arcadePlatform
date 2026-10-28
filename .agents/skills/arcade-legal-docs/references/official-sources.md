# Official legal and provider sources (recheck freshness at use)

These sources establish **general policy**, not automatically the exact user's plan, contract execution, personal-data location, region or custom retention setting.

## EU / GDPR
- Regulation (EU) 2016/679, EUR-Lex: https://eur-lex.europa.eu/eli/reg/2016/679/oj — especially Arts. 5, 6, 12–13, 21, 25(2), 28, 44–46; Art. 13 permits retention *criteria* when periods cannot be given.
- EDPB Guidelines 4/2019, data protection by design/default, particularly indiscriminate public access and meaningful intervention: https://www.edpb.europa.eu/our-work-tools/our-documents/guidelines/guidelines-42019-article-25-data-protection-design-and_en
- Polish UODO: https://uodo.gov.pl/ ; verify topic-specific guidance and local law in force when drafting.

- Polish Act on electronic services (UŚUDE), especially Art. 2(6), 5 and 8: https://eli.gov.pl/api/acts/DU/2024/1513/text.html . Applicability to a genuinely non-commercial hobby must be evaluated from professional/earning activity, not assumed; do not invent a postal address. Check later amendments and entry-into-force dates.

## Netlify (official only)
- GDPR and DPA (DPA incorporated by reference in Netlify's Terms, according to Netlify): https://www.netlify.com/gdpr-ccpa/
- Trust Center; DPA marked publicly downloadable; detailed retention summary may require access: https://www.netlify.com/trust-center/
- Netlify Privacy Policy: https://www.netlify.com/privacy/ . It covers Netlify acting in its own capacity; don't equate it with all processing under customer's DPA.
- Functions region defaults, alternatives and UI: https://docs.netlify.com/build/functions/configuration/ . Region of *execution* is not proof of exclusive storage country.
- Functions logs, minimum retention and plan-dependent limits: https://docs.netlify.com/build/functions/logs/ . Published 2026 docs say at least 24h, 7 days for certain pricing plans; never attribute plan-specific retention without verified plan.
- Netlify Blobs (only relevant if source actually uses it): https://docs.netlify.com/build/data-and-storage/netlify-blobs/ . Site-wide default and Functions regions differ.

## Supabase
- DPA: https://supabase.com/legal/customer-resources/data-processing-addendum
- Current regional hosting, transfers and transfer impact: https://supabase.com/legal/privacy-resources/data-residency-and-transfers-faq . Core database/Auth/Storage and DB backups in selected region, with specified exceptions for support, telemetry, CDN, account operations.
- Backups: https://supabase.com/docs/guides/platform/backups . Plan-dependent; do not invent a duration.

## Upstash
- Security and DPA links: https://upstash.com/docs/common/help/compliance . Upstash says snapshots go to S3; link does not prove any one database's region, backups retention or service plan.

### Source-evidence discipline
For each publication claim retain `source URL | source type | checked date | observed config or general policy | verified exact statement | status`. Never use a third-party PDF mirror for current Netlify DPA when the official Trust Center is available. A live provider's marketing use of 'GDPR compliant' is not proof of controller compliance. No support email is necessary merely to cite published provider documentation.
