import test from "node:test";
import assert from "node:assert/strict";
import { papersFrom, titleSortKey } from "../js/papers-core.js";

const PDF = "https://stars.library.ucf.edu/cgi/viewcontent.cgi?article=1089&context=elo2026";

test("only events with a paper are kept", () => {
  const events = [
    { title: "Talk without paper", url: "https://x/1" },
    { title: "Talk with paper", url: "https://x/2", paper: PDF },
    { title: "Recorded talk", url: "https://x/3", video: "https://x/v.m3u8" },
  ];
  assert.deepEqual(
    papersFrom(events).map((ev) => ev.title),
    ["Talk with paper"],
  );
});

test("papers are alphabetized by title, case-insensitively", () => {
  const events = [
    { title: "man.A.machine.txt", paper: PDF },
    { title: "Connected/Disconnected", paper: PDF },
    { title: "Electronic Literature in AI data work", paper: PDF },
  ];
  assert.deepEqual(
    papersFrom(events).map((ev) => ev.title),
    [
      "Connected/Disconnected",
      "Electronic Literature in AI data work",
      "man.A.machine.txt",
    ],
  );
});

test("leading punctuation does not distort the alphabet", () => {
  const events = [
    { title: "Vibe Coding", paper: PDF },
    { title: "(Un)easily Writing the Future", paper: PDF },
    { title: '"The First Web Novel at 30"', paper: PDF },
  ];
  assert.deepEqual(
    papersFrom(events).map((ev) => ev.title),
    ['"The First Web Novel at 30"', "(Un)easily Writing the Future", "Vibe Coding"],
  );
});

test("sort key strips leading punctuation and lowercases", () => {
  assert.equal(titleSortKey("(Un)easily Writing"), "un)easily writing");
  assert.equal(titleSortKey('"The First Web Novel'), "the first web novel");
  assert.equal(titleSortKey("man.A.machine.txt"), "man.a.machine.txt");
});

test("empty or missing input yields an empty list", () => {
  assert.deepEqual(papersFrom([]), []);
  assert.deepEqual(papersFrom(undefined), []);
});
