<!-- procedureId: procedures/0000cccc-research-a-company-exhaustive-fixture -->
# Research a company exhaustively (fixture, slow)

Fixture flow for dry runs. Placeholders like <Company> stand for the current company.

1. Crawl the official site of <Company> page by page (home, about, pricing, docs, blog, careers,
   press) with curl, then search for news coverage and an encyclopedia entry and fetch those too.
2. Take notes on every page before writing anything.
3. Write `$HOME/workspace/scout/<slug>/company.json` with `company_name`, `website`,
   `product_summary` (2-3 sentences) and `source_urls` (every URL you fetched).
4. Reply with the absolute path of the file.
