import json
import tempfile
import unittest
import urllib.error
from pathlib import Path

from scripts.fetch_schedule import (
    STREAMING_API,
    _to_utc_iso,
    build_payload,
    check_captions,
    check_papers,
    check_videos,
    extract_caption_url,
    extract_paper_url,
    load_previous_field,
    load_previous_videos,
    parse_rss_links,
    parse_schedule,
    validate,
)

# How bepress renders the JW Player caption track on a STARS article page,
# including the sc_redirect/nold parameters that break viewcontent.cgi.
ARTICLE_WITH_CAPTIONS = """
  <script>
  jwplayer("hosted-streaming").setup({
    playlist: [{
      sources: [{ file: "https://s3.amazonaws.com/x/y.m3u8" }],
      tracks: [
        {
          file: "https://stars.library.ucf.edu/cgi/viewcontent.cgi?filename=0&amp;article=1055&amp;context=elo2026&amp;type=additional&amp;sc_redirect=1&amp;nold=t",
          label: "1",
          kind: "captions"
        }
      ]
    }]
  });
  </script>
"""

CAPTION_URL = (
    "https://stars.library.ucf.edu/cgi/viewcontent.cgi"
    "?filename=0&article=1055&context=elo2026&type=additional"
)

# How bepress renders the download button on an event page whose attached
# full text is a paper PDF (proceedings papers). Recorded sessions without a
# paper render id="native" for the raw video file instead.
ARTICLE_WITH_PAPER = """
  <div class="aside download-button">
    <a id="pdf" class="btn" href="https://stars.library.ucf.edu/cgi/viewcontent.cgi?article=1089&amp;context=elo2026" title="PDF (1.1&nbsp;MB) opens in new window" target="_blank">
      Download
    </a>
  </div>
"""

ARTICLE_WITH_VIDEO_DOWNLOAD = """
  <div class="aside download-button">
    <a id="native" class="btn" href="https://stars.library.ucf.edu/context/elo2026/article/1082/type/native/viewcontent" title="Download 228.6&nbsp;MB file" target="_blank">
      Download
    </a>
  </div>
"""

PAPER_URL = "https://stars.library.ucf.edu/cgi/viewcontent.cgi?article=1089&context=elo2026"

FIXTURE = Path(__file__).parent / "fixtures" / "combined_schedule.html"
RSS_FIXTURE = Path(__file__).parent / "fixtures" / "recent-events.rss"


class ToUtcIsoTests(unittest.TestCase):
    def test_eastern_wall_clock_converts_to_utc(self):
        # 12:30 PM EDT on July 15 is 16:30 UTC
        self.assertEqual(_to_utc_iso("2026-07-15T123000"), "2026-07-15T16:30:00Z")

    def test_keynote_time(self):
        self.assertEqual(_to_utc_iso("2026-07-18T130000"), "2026-07-18T17:00:00Z")


class ParseScheduleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.events = parse_schedule(FIXTURE.read_text(encoding="utf-8"))

    def test_finds_a_full_schedule(self):
        self.assertGreater(len(self.events), 50)

    def test_first_event_is_welcome_remarks(self):
        ev = self.events[0]
        self.assertEqual(ev["title"], "ELO 2026 (Un)Supervised Conference Welcome Remarks")
        self.assertEqual(ev["url"], "https://stars.library.ucf.edu/elo2026/combined_schedule/all/1")
        self.assertEqual(ev["start"], "2026-07-15T16:30:00Z")
        self.assertEqual(ev["end"], "2026-07-15T16:45:00Z")
        self.assertEqual(ev["track"], "Algorithms & Imaginaries")
        self.assertEqual(ev["type"], "Plenary")
        self.assertIn("Anastasia Salter", ev["presenters"])

    def test_no_duplicate_urls(self):
        urls = [e["url"] for e in self.events]
        self.assertEqual(len(urls), len(set(urls)))

    def test_every_event_has_required_fields(self):
        for ev in self.events:
            self.assertTrue(ev["title"], msg=ev)
            self.assertTrue(ev["url"].startswith("https://stars.library.ucf.edu/"), msg=ev)
            self.assertRegex(ev["start"], r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", msg=ev)
            self.assertLessEqual(ev["start"], ev["end"], msg=ev)

    def test_html_entities_are_unescaped(self):
        titles = " ".join(e["title"] for e in self.events)
        self.assertNotIn("&quot;", titles)
        self.assertNotIn("&amp;", titles)


class RssTests(unittest.TestCase):
    def test_extracts_seven_links(self):
        links = parse_rss_links(RSS_FIXTURE.read_text(encoding="utf-8"))
        self.assertEqual(len(links), 7)
        self.assertIn("https://stars.library.ucf.edu/elo2026/combined_schedule/all/1", links)


class PayloadTests(unittest.TestCase):
    def setUp(self):
        self.events = parse_schedule(FIXTURE.read_text(encoding="utf-8"))
        self.links = parse_rss_links(RSS_FIXTURE.read_text(encoding="utf-8"))
        self.payload = build_payload(self.events, self.links, "2026-07-03T12:00:00Z")

    def test_featured_events_marked(self):
        featured = [e for e in self.payload["events"] if e["featured"]]
        self.assertEqual(len(featured), 7)

    def test_events_sorted_by_start(self):
        starts = [e["start"] for e in self.payload["events"]]
        self.assertEqual(starts, sorted(starts))

    def test_payload_shape(self):
        self.assertEqual(self.payload["generated"], "2026-07-03T12:00:00Z")
        self.assertEqual(self.payload["source"], "https://stars.library.ucf.edu/elo2026/combined_schedule/")

    def test_valid_payload_passes(self):
        self.assertEqual(validate(self.payload), [])

    def test_too_few_events_fails(self):
        small = build_payload(self.events[:3], self.links, "2026-07-03T12:00:00Z")
        self.assertTrue(any("50" in e for e in validate(small)))

    def test_missing_title_fails(self):
        bad = build_payload(self.events, self.links, "2026-07-03T12:00:00Z")
        bad["events"][0]["title"] = ""
        self.assertNotEqual(validate(bad), [])

    def test_bad_end_format_fails(self):
        bad = build_payload(self.events, self.links, "2026-07-03T12:00:00Z")
        bad["events"][5]["end"] = "2026-07-15T99:99"
        self.assertNotEqual(validate(bad), [])

    def test_videos_attached_to_matching_events(self):
        url = self.events[0]["url"]
        videos = {url: "https://s3.amazonaws.com/example/recording.m3u8"}
        payload = build_payload(self.events, self.links, "2026-07-15T12:00:00Z", videos)
        by_url = {e["url"]: e for e in payload["events"]}
        self.assertEqual(by_url[url]["video"], videos[url])
        others = [e for e in payload["events"] if e["url"] != url]
        self.assertTrue(all("video" not in e for e in others))
        self.assertEqual(validate(payload), [])

    def test_overrides_applied_to_scraped_events(self):
        url = "https://stars.library.ucf.edu/elo2026/narrativesandworlds/schedule/7"
        by_url = {e["url"]: e for e in self.payload["events"]}
        self.assertEqual(by_url[url]["track"], "Hypertexts & Fictions")

    def test_bad_video_url_fails_validation(self):
        videos = {self.events[0]["url"]: "not-a-url"}
        payload = build_payload(self.events, self.links, "2026-07-15T12:00:00Z", videos)
        self.assertTrue(any("video" in e for e in validate(payload)))


def _http_error(url, code):
    return urllib.error.HTTPError(url, code, "err", hdrs=None, fp=None)


class CheckVideosTests(unittest.TestCase):
    EVENTS = [
        {"url": "https://stars.library.ucf.edu/elo2026/combined_schedule/all/1"},
        {"url": "https://stars.library.ucf.edu/elo2026/combined_schedule/all/3"},
    ]
    M3U8 = "https://s3.amazonaws.com/example/keynote.m3u8"

    def test_published_recording_found(self):
        def fetcher(url):
            if "all%2F3" in url:
                return json.dumps([self.M3U8])
            raise _http_error(url, 404)

        videos = check_videos(self.EVENTS, {}, fetcher)
        self.assertEqual(videos, {self.EVENTS[1]["url"]: self.M3U8})

    def test_queries_streaming_api_with_encoded_event_url(self):
        seen = []

        def fetcher(url):
            seen.append(url)
            raise _http_error(url, 404)

        check_videos(self.EVENTS[:1], {}, fetcher)
        self.assertEqual(
            seen,
            [STREAMING_API + "https%3A%2F%2Fstars.library.ucf.edu%2Felo2026%2Fcombined_schedule%2Fall%2F1"],
        )

    def test_transient_error_keeps_previous_video(self):
        def fetcher(url):
            raise _http_error(url, 500)

        previous = {self.EVENTS[1]["url"]: self.M3U8}
        videos = check_videos(self.EVENTS, previous, fetcher)
        self.assertEqual(videos, previous)

    def test_404_means_no_recording_even_if_previously_seen(self):
        def fetcher(url):
            raise _http_error(url, 404)

        previous = {self.EVENTS[1]["url"]: self.M3U8}
        self.assertEqual(check_videos(self.EVENTS, previous, fetcher), {})

    def test_garbage_response_ignored(self):
        videos = check_videos(self.EVENTS[:1], {}, lambda url: "not json")
        self.assertEqual(videos, {})


class CaptionExtractionTests(unittest.TestCase):
    def test_pulls_caption_url_from_article_page(self):
        self.assertEqual(extract_caption_url(ARTICLE_WITH_CAPTIONS), CAPTION_URL)

    def test_strips_redirect_params_that_break_viewcontent(self):
        # sc_redirect/nold make STARS answer 500, so they must not survive.
        url = extract_caption_url(ARTICLE_WITH_CAPTIONS)
        self.assertNotIn("sc_redirect", url)
        self.assertNotIn("nold", url)

    def test_unescapes_html_entities(self):
        self.assertNotIn("&amp;", extract_caption_url(ARTICLE_WITH_CAPTIONS))

    def test_page_without_tracks_has_no_captions(self):
        self.assertIsNone(extract_caption_url("<html><body>no player</body></html>"))

    def test_non_caption_track_is_ignored(self):
        html = ARTICLE_WITH_CAPTIONS.replace('kind: "captions"', 'kind: "thumbnails"')
        self.assertIsNone(extract_caption_url(html))


class PaperExtractionTests(unittest.TestCase):
    def test_pulls_paper_url_from_event_page(self):
        self.assertEqual(extract_paper_url(ARTICLE_WITH_PAPER), PAPER_URL)

    def test_unescapes_html_entities(self):
        self.assertNotIn("&amp;", extract_paper_url(ARTICLE_WITH_PAPER))

    def test_video_download_button_is_not_a_paper(self):
        self.assertIsNone(extract_paper_url(ARTICLE_WITH_VIDEO_DOWNLOAD))

    def test_page_without_download_button_has_no_paper(self):
        self.assertIsNone(extract_paper_url("<html><body>no button</body></html>"))

    def test_relative_href_is_rejected(self):
        html = ARTICLE_WITH_PAPER.replace(
            "https://stars.library.ucf.edu/cgi/viewcontent.cgi?article=1089&amp;context=elo2026",
            "/cgi/viewcontent.cgi?article=1089",
        )
        self.assertIsNone(extract_paper_url(html))


class CheckPapersTests(unittest.TestCase):
    EVENTS = [
        {"url": "https://stars.library.ucf.edu/elo2026/a/schedule/1"},
        {"url": "https://stars.library.ucf.edu/elo2026/a/schedule/2"},
    ]

    def test_every_event_page_is_checked(self):
        seen = []

        def fetcher(url):
            seen.append(url)
            return ARTICLE_WITH_PAPER if url.endswith("/1/") else "<html></html>"

        papers = check_papers(self.EVENTS, {}, fetcher)
        self.assertEqual(papers, {self.EVENTS[0]["url"]: PAPER_URL})
        self.assertEqual(seen, [ev["url"] + "/" for ev in self.EVENTS])

    def test_fetch_failure_keeps_previous_paper(self):
        def fetcher(url):
            raise OSError("network down")

        previous = {self.EVENTS[0]["url"]: PAPER_URL}
        self.assertEqual(check_papers(self.EVENTS, previous, fetcher), previous)

    def test_published_paper_survives_a_page_without_the_button(self):
        previous = {self.EVENTS[0]["url"]: PAPER_URL}
        papers = check_papers(self.EVENTS, previous, lambda u: "<html></html>")
        self.assertEqual(papers, previous)


class PaperPayloadTests(unittest.TestCase):
    def setUp(self):
        self.events = parse_schedule(FIXTURE.read_text(encoding="utf-8"))
        self.links = parse_rss_links(RSS_FIXTURE.read_text(encoding="utf-8"))
        self.url = self.events[0]["url"]

    def _payload(self, papers):
        return build_payload(
            self.events, self.links, "2026-08-03T12:00:00Z", papers=papers
        )

    def test_paper_attached_to_matching_event(self):
        payload = self._payload({self.url: PAPER_URL})
        by_url = {e["url"]: e for e in payload["events"]}
        self.assertEqual(by_url[self.url]["paper"], PAPER_URL)
        others = [e for e in payload["events"] if e["url"] != self.url]
        self.assertTrue(all("paper" not in e for e in others))
        self.assertEqual(validate(payload), [])

    def test_bad_paper_url_fails_validation(self):
        payload = self._payload({self.url: "not-a-url"})
        self.assertTrue(any("paper" in e for e in validate(payload)))


class CheckCaptionsTests(unittest.TestCase):
    EVENTS = [
        {"url": "https://stars.library.ucf.edu/elo2026/a/schedule/1"},
        {"url": "https://stars.library.ucf.edu/elo2026/a/schedule/2"},
    ]

    def test_only_recorded_sessions_are_checked(self):
        seen = []

        def fetcher(url):
            seen.append(url)
            return ARTICLE_WITH_CAPTIONS

        videos = {self.EVENTS[0]["url"]: "https://s3.amazonaws.com/x/y.m3u8"}
        captions = check_captions(self.EVENTS, videos, {}, fetcher)
        self.assertEqual(captions, {self.EVENTS[0]["url"]: CAPTION_URL})
        self.assertEqual(seen, [self.EVENTS[0]["url"] + "/"])

    def test_session_without_caption_track_gets_no_entry(self):
        videos = {self.EVENTS[0]["url"]: "https://s3.amazonaws.com/x/y.m3u8"}
        self.assertEqual(check_captions(self.EVENTS, videos, {}, lambda u: "<html></html>"), {})

    def test_fetch_failure_keeps_previous_captions(self):
        def fetcher(url):
            raise OSError("network down")

        videos = {self.EVENTS[0]["url"]: "https://s3.amazonaws.com/x/y.m3u8"}
        previous = {self.EVENTS[0]["url"]: CAPTION_URL}
        self.assertEqual(check_captions(self.EVENTS, videos, previous, fetcher), previous)


class CaptionPayloadTests(unittest.TestCase):
    def setUp(self):
        self.events = parse_schedule(FIXTURE.read_text(encoding="utf-8"))
        self.links = parse_rss_links(RSS_FIXTURE.read_text(encoding="utf-8"))
        self.url = self.events[0]["url"]

    def _payload(self, captions):
        return build_payload(
            self.events,
            self.links,
            "2026-07-20T12:00:00Z",
            {self.url: "https://s3.amazonaws.com/x/y.m3u8"},
            captions,
        )

    def test_captions_attached_to_matching_event(self):
        payload = self._payload({self.url: CAPTION_URL})
        by_url = {e["url"]: e for e in payload["events"]}
        self.assertEqual(by_url[self.url]["captions"], CAPTION_URL)
        self.assertEqual(validate(payload), [])

    def test_events_without_captions_omit_the_field(self):
        payload = self._payload({})
        self.assertTrue(all("captions" not in e for e in payload["events"]))

    def test_bad_caption_url_fails_validation(self):
        payload = self._payload({self.url: "not-a-url"})
        self.assertTrue(any("captions" in e for e in validate(payload)))

    def test_captions_without_a_recording_fails_validation(self):
        payload = build_payload(
            self.events, self.links, "2026-07-20T12:00:00Z", {}, {self.url: CAPTION_URL}
        )
        self.assertTrue(any("without a recording" in e for e in validate(payload)))


class LoadPreviousFieldTests(unittest.TestCase):
    def test_reads_an_arbitrary_field(self):
        payload = {
            "events": [
                {"url": "https://example.com/a", "captions": "https://example.com/a.srt"},
                {"url": "https://example.com/b"},
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(
                load_previous_field(path, "captions"),
                {"https://example.com/a": "https://example.com/a.srt"},
            )


class LoadPreviousVideosTests(unittest.TestCase):
    def test_reads_videos_from_payload(self):
        payload = {
            "events": [
                {"url": "https://example.com/a", "video": "https://example.com/a.m3u8"},
                {"url": "https://example.com/b"},
            ]
        }
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "events.json"
            path.write_text(json.dumps(payload), encoding="utf-8")
            self.assertEqual(
                load_previous_videos(path),
                {"https://example.com/a": "https://example.com/a.m3u8"},
            )

    def test_missing_file_returns_empty(self):
        self.assertEqual(load_previous_videos(Path("does-not-exist.json")), {})


if __name__ == "__main__":
    unittest.main()
