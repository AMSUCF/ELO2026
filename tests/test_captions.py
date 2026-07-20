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


if __name__ == "__main__":
    unittest.main()
