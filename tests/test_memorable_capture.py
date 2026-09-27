"""Leakage test for the Memorable capture adapter (scripts/memorable_capture.py).

The procedure sent to Memorable must carry the method, never the teacher's answer. These tests
use the fictional fixture artifact, so they run offline with no QM, Memorable or Docker.
"""
import json
import os
import sys
import unittest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
import memorable_capture as mc  # noqa: E402

with open(os.path.join(ROOT, "demo", "fixtures", "company.json")) as f:
    ARTIFACT = json.load(f)
TERMS = mc.leak_terms(ARTIFACT)

WRITE_CMD = (
    'mkdir -p "$HOME/workspace/scout/northwind-labs" && cat > "$HOME/workspace/scout/northwind-labs/company.json" '
    "<<'EOF'\n" + json.dumps(ARTIFACT, indent=2) + "\nEOF"
)
FETCH_CMD = ("curl -sL https://www.northwind.example.com -o a.html; "
             "curl -sL -A 'Mozilla/5.0' https://en.wikipedia.example.org/wiki/Northwind_Labs -o b.html")


class LeakDetection(unittest.TestCase):
    def test_generic_method_is_clean(self):
        method = ("Fetch the company homepage and one independent public source with curl, summarize what the "
                  "product is and who it is for in 2-3 sentences, keep the fetched URLs, write "
                  "$HOME/workspace/scout/<slug>/company.json and validate it with python.")
        self.assertEqual(mc.leaks(method, TERMS), [])
        self.assertEqual(mc.leaks(mc.JSON_TEMPLATE, TERMS), [])
        self.assertEqual(mc.leaks(mc.PROMPT + mc.TASK, TERMS), [])

    def test_each_kind_of_answer_content_is_caught(self):
        cases = {
            "company name": "Research Northwind Labs first.",
            "domain": "see northwind.example.com for details",
            "source url": "https://en.wikipedia.example.org/wiki/Northwind_Labs",
            "lowercase summary phrase": "it lets small operations teams automate things",
            "summary phrase across a line break": "hosted workflow\n  tool that lets",
        }
        for kind, text in cases.items():
            self.assertTrue(mc.leaks(text, TERMS), f"{kind} not detected: {text!r}")

    def test_the_verbatim_answer_is_caught(self):
        self.assertTrue(mc.leaks(json.dumps(ARTIFACT), TERMS))
        self.assertTrue(mc.leaks(ARTIFACT["product_summary"].lower(), TERMS))

    def test_generalizer_removes_the_answer_from_a_trace(self):
        generalize = mc.generalizer(ARTIFACT, "northwind-labs")
        run = {"activity": [
            {"type": "tool_call", "payload": {"tool": "execute", "callId": "1", "command": FETCH_CMD}},
            {"type": "tool_result", "payload": {"callId": "1", "code": 0, "isError": False}},
            {"type": "tool_call", "payload": {"tool": "execute", "callId": "2", "command": WRITE_CMD}},
            {"type": "tool_result", "payload": {"callId": "2", "code": 0, "isError": False}},
            {"type": "text", "payload": {"text": "Northwind Labs sells a hosted workflow tool."}},
        ]}
        # The raw commands leak; the generalized trace must not.
        self.assertTrue(mc.leaks(FETCH_CMD + WRITE_CMD, TERMS))
        trace = mc.build_trace("r1", run, generalize, TERMS)
        blob = json.dumps(trace)
        self.assertEqual(mc.leaks(blob, TERMS), [])
        self.assertIn("<company-domain>", blob)
        self.assertIn("scout/<slug>/company.json", blob)
        self.assertNotIn("hosted workflow", blob)  # the leaking assistant text was dropped
        self.assertEqual(len(trace["tool_calls"]), 2)

    def test_generalizer_handles_a_non_heredoc_write_and_the_rest_summary_api(self):
        # A python-dict write, a Wikipedia REST summary URL and a grep for proper nouns of the answer.
        generalize = mc.generalizer(ARTIFACT, "northwind-labs")
        cmd = ('curl -sL "https://en.wikipedia.example.org/api/rest_v1/page/summary/Northwind_Labs"; '
               "grep -oiE '(Free|Labs)' p.html; python3 - <<'PY'\nimport json\nd = " + json.dumps(ARTIFACT)
               + "\njson.dump(d, open('$HOME/workspace/scout/northwind-labs/company.json', 'w'))\nPY")
        self.assertTrue(mc.leaks(cmd, TERMS))
        out = generalize(cmd)
        self.assertEqual(mc.leaks(out, TERMS), [])
        self.assertIn("page/summary/<Wikipedia_Title>", out)
        self.assertIn(mc.SUMMARY_PLACEHOLDER, out)
        self.assertIn("(Free|<summary-term>)", out)

    def test_a_wikipedia_title_equal_to_the_name_stays_a_company_placeholder_outside_urls(self):
        artifact = dict(ARTIFACT, source_urls=[ARTIFACT["website"], "https://en.wikipedia.example.org/wiki/Northwind"],
                        company_name="Northwind")
        out = mc.generalizer(artifact, "northwind")('{"company_name":"Northwind"} /wiki/Northwind')
        self.assertEqual(out, '{"company_name":"<Company>"} /wiki/<Wikipedia_Title>')


if __name__ == "__main__":
    unittest.main()
