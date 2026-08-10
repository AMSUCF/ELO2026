import test from "node:test";
import assert from "node:assert/strict";
import { captionState, recordingId, shareUrl } from "../js/recordings-core.js";

const STARS = "https://stars.library.ucf.edu/elo2026";

test("recording id comes from collection and item number", () => {
  assert.equal(recordingId(`${STARS}/narrativesandworlds/schedule/7`), "rec-narrativesandworlds-7");
  assert.equal(recordingId(`${STARS}/hypertextsandfictions/schedule/10`), "rec-hypertextsandfictions-10");
});

test("combined-schedule urls keep their item number", () => {
  assert.equal(recordingId(`${STARS}/combined_schedule/all/3`), "rec-combined-schedule-3");
});

test("trailing slashes, queries and fragments do not change the id", () => {
  const base = `${STARS}/narrativesandworlds/schedule/7`;
  const expected = "rec-narrativesandworlds-7";
  assert.equal(recordingId(`${base}/`), expected);
  assert.equal(recordingId(`${base}?utm_source=x`), expected);
  assert.equal(recordingId(`${base}#frag`), expected);
});

test("ids are unique across the tracks that share item numbers", () => {
  const urls = [
    `${STARS}/narrativesandworlds/schedule/7`,
    `${STARS}/hypertextsandfictions/schedule/7`,
    `${STARS}/algorithmsandimaginaries/schedule/7`,
  ];
  assert.equal(new Set(urls.map(recordingId)).size, 3);
});

test("ids are safe to use as html fragment identifiers", () => {
  for (const url of [`${STARS}/combined_schedule/all/1`, `${STARS}/narrativesandworlds/schedule/7`]) {
    assert.match(recordingId(url), /^rec-[a-z0-9-]+$/);
  }
});

test("share url is absolute and drops any query string", () => {
  const location = {
    origin: "https://anastasiasalter.net",
    pathname: "/ELO2026/recordings.html",
  };
  assert.equal(
    shareUrl("rec-narrativesandworlds-7", location),
    "https://anastasiasalter.net/ELO2026/recordings.html#rec-narrativesandworlds-7"
  );
});




test("vendored captions play locally", () => {
  assert.equal(
    captionState({ captions_file: "captions/1055.vtt", captions: "https://stars/x" }),
    "local"
  );
});

test("captions known to STARS but not vendored link out", () => {
  assert.equal(captionState({ captions: "https://stars.library.ucf.edu/cgi/x" }), "stars");
});

test("a recording with no captions is marked coming soon", () => {
  assert.equal(captionState({}), "soon");
  assert.equal(captionState({ video: "https://example.com/a.m3u8" }), "soon");
});

test("a local file wins even if it is the only caption signal", () => {
  assert.equal(captionState({ captions_file: "captions/1004.vtt" }), "local");
});
