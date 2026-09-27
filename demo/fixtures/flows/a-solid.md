<!-- procedureId: procedures/0000aaaa-research-a-company-fixture -->
# Research a company (fixture, solid)

Fixture flow for dry runs. Placeholders like <Company> stand for the current company.

1. Find the official site: `curl -sL https://<company-domain>` and confirm the page names <Company>.
2. Fetch at least two more public pages about <Company> (for example `/about` and an encyclopedia
   entry) with curl, and keep every URL you actually fetched.
3. Write `$HOME/workspace/scout/<slug>/company.json` with exactly these keys:
   `company_name`, `website` (the http(s) URL from step 1), `product_summary` (2-3 sentences taken
   from the fetched pages) and `source_urls` (at least two distinct http(s) URLs from steps 1-2).
4. Validate before replying: `python3 -c` that the file parses as a JSON object, every key is
   present and non-empty, and `source_urls` has at least two distinct http(s) URLs. Fix and
   re-validate on any failure.
5. Reply with the absolute path of the file.
