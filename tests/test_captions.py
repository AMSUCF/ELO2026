import tempfile
import unittest
from pathlib import Path

from scripts.captions import looks_like_captions, srt_to_vtt
from scripts.fetch_schedule import vendored_captions

SRT = (
    "1\r\n"
    "00:00:00,080 --> 00:00:02,520\r\n"
    "Set up or anything like that.\r\n"
    "\r\n"
    "2\r\n"
    "00:00:02,560 --> 00:00:05,000\r\n"
    "Second cue, two lines\r\n"
    "of dialogue.\r\n"
)

# What bepress returns when it decides a request looks automated.
BOT_PAGE = "<!DOCTYPE HTML>\n<html lang=\"en\"><head><title>403</title></head></html>"


class SrtToVttTests(unittest.TestCase):
    def test_adds_webvtt_header(self):
        self.assertTrue(srt_to_vtt(SRT).startswith("WEBVTT\n\n"))

    def test_timestamps_use_periods(self):
        out = srt_to_vtt(SRT)
        self.assertIn("00:00:00.080 --> 00:00:02.520", out)
        self.assertNotIn(",520", out)

    def test_cue_text_and_ordering_preserved(self):
        out = srt_to_vtt(SRT)
        self.assertIn("Set up or anything like that.", out)
        self.assertIn("Second cue, two lines\nof dialogue.", out)
        self.assertLess(out.index("Set up"), out.index("Second cue"))

    def test_crlf_normalized_to_lf(self):
        self.assertNotIn("\r", srt_to_vtt(SRT))

    def test_bom_is_stripped(self):
        self.assertTrue(srt_to_vtt("﻿" + SRT).startswith("WEBVTT"))

    def test_conversion_is_idempotent(self):
        once = srt_to_vtt(SRT)
        self.assertEqual(srt_to_vtt(once), once)

    def test_short_and_single_digit_stamps_are_padded(self):
        out = srt_to_vtt("1\n0:00:04.96 --> 0:00:08.1\nhi\n")
        self.assertIn("00:00:04.960 --> 00:00:08.100", out)

    def test_cue_settings_after_timing_are_kept(self):
        out = srt_to_vtt("1\n00:00:01,000 --> 00:00:02,000 line:0%\nhi\n")
        self.assertIn("00:00:01.000 --> 00:00:02.000 line:0%", out)


class LooksLikeCaptionsTests(unittest.TestCase):
    def test_accepts_subrip(self):
        self.assertTrue(looks_like_captions(SRT))

    def test_accepts_already_converted_vtt(self):
        self.assertTrue(looks_like_captions(srt_to_vtt(SRT)))

    def test_rejects_bot_challenge_page(self):
        self.assertFalse(looks_like_captions(BOT_PAGE))

    def test_rejects_empty_202_body(self):
        self.assertFalse(looks_like_captions(""))
        self.assertFalse(looks_like_captions("   \n  "))

    def test_rejects_prose_without_cues(self):
        self.assertFalse(looks_like_captions("just some text, no timings"))


class VendoredCaptionsTests(unittest.TestCase):
    CAPTION_URL = (
        "https://stars.library.ucf.edu/cgi/viewcontent.cgi"
        "?filename=0&article=1055&context=elo2026&type=additional"
    )
    EVENT = "https://stars.library.ucf.edu/elo2026/a/schedule/4"

    def test_maps_event_to_local_path_when_file_exists(self):
        with tempfile.TemporaryDirectory() as tmp:
            (Path(tmp) / "1055.vtt").write_text("WEBVTT\n", encoding="utf-8")
            self.assertEqual(
                vendored_captions({self.EVENT: self.CAPTION_URL}, Path(tmp)),
                {self.EVENT: "captions/1055.vtt"},
            )

    def test_omits_events_whose_file_is_not_vendored_yet(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(vendored_captions({self.EVENT: self.CAPTION_URL}, Path(tmp)), {})

    def test_caption_url_without_article_id_is_ignored(self):
        with tempfile.TemporaryDirectory() as tmp:
            self.assertEqual(
                vendored_captions({self.EVENT: "https://example.com/x.srt"}, Path(tmp)), {}
            )


class BrowserSnippetTests(unittest.TestCase):
    """The snippet is what makes the next vendoring round repeatable, so it is
    checked for the pieces that made the first round work."""

    def _snippet(self, ids):
        from scripts.vendor_captions import BROWSER_SNIPPET
        import json as _json

        return BROWSER_SNIPPET % {"ids": _json.dumps(ids)}

    def test_embeds_the_ids_as_a_javascript_array(self):
        self.assertIn('["1016", "1017"]', self._snippet(["1016", "1017"]))

    def test_builds_the_caption_url_that_actually_works(self):
        snippet = self._snippet(["1055"])
        # The sc_redirect/nold params make viewcontent.cgi 500; they must not
        # reappear, and the four selectors that do work must all be present.
        self.assertNotIn("sc_redirect", snippet)
        self.assertNotIn("nold", snippet)
        for key in ("filename", "article", "context", "type"):
            self.assertIn(key, snippet)

    def test_retries_more_slowly_after_rate_limiting(self):
        snippet = self._snippet(["1055"])
        self.assertIn("[1, 150]", snippet)
        self.assertIn("[2, 1500]", snippet)
        self.assertIn("[3, 4000]", snippet)

    def test_downloads_the_bundle_the_unpacker_expects(self):
        self.assertIn("elo2026-captions.json", self._snippet(["1055"]))

    def test_each_request_has_its_own_deadline(self):
        # bepress holds connections open once it decides it is being scraped,
        # so a run without timeouts stalls forever on the first hung fetch.
        snippet = self._snippet(["1055"])
        self.assertIn("AbortController", snippet)
        self.assertIn("TIMEOUT_MS", snippet)
        self.assertIn("abort.signal", snippet)

    def test_gives_up_after_repeated_stalls(self):
        snippet = self._snippet(["1055"])
        self.assertIn("stalled >= 3", snippet)

    def test_snippet_is_valid_javascript(self):
        import shutil
        import subprocess

        node = shutil.which("node")
        if not node:
            self.skipTest("node not available")
        # --check parses without executing.
        with tempfile.NamedTemporaryFile("w", suffix=".js", delete=False, encoding="utf-8") as fh:
            fh.write(self._snippet(["1016", "1017"]))
            path = fh.name
        result = subprocess.run([node, "--check", path], capture_output=True, text=True)
        Path(path).unlink(missing_ok=True)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
