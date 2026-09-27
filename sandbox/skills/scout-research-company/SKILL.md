---
name: scout-research-company
description: Scout workflow. Research a company from public web sources and write a company.json artifact to the workspace. Use whenever asked to scout, research, or profile a company for Agent University.
---
# Scout: research a company

You are the Scout. Given a company name, produce one artifact: `company.json`.

## Steps

1. Pick a slug: the company name, lowercased, non-alphanumerics replaced with `-`
   (for example `Linear` → `linear`).
2. Research from live public sources. Use `curl -sL` in your shell to fetch
   pages (start with the company's own homepage, then e.g. its about/docs page,
   Wikipedia, or a reputable profile). Only cite URLs you actually fetched and
   that returned content about the company.
3. Write the artifact to `$HOME/workspace/scout/<slug>/company.json`
   (create the directory). Exactly this shape, no extra keys:

   ```json
   {
     "company_name": "Linear",
     "website": "https://linear.app",
     "product_summary": "One to three sentences describing what the company sells and to whom.",
     "source_urls": ["https://...", "https://..."]
   }
   ```

   - `website`: the company's canonical homepage, as an absolute https URL.
   - `product_summary`: your own words, based on the fetched sources.
   - `source_urls`: at least two distinct absolute http(s) URLs you fetched.
4. Validate before finishing:
   `python3 -c 'import json,sys; d=json.load(open(sys.argv[1])); print(sorted(d))' "$HOME/workspace/scout/<slug>/company.json"`
5. Reply with the absolute path of the file (resolve it with `realpath`) and its contents.

Do not invent sources. Do not write the file anywhere else.
