"""Convert the SubRip caption files STARS serves into WebVTT.

STARS hands out `application/x-subrip`, but a <track> element only accepts
WebVTT, so vendored captions are converted on the way to disk. The two
formats share a cue structure; the differences that matter here are the
required WEBVTT header and the decimal separator in timestamps (SubRip uses
a comma, WebVTT a period).
"""

import re

# 00:00:04,960 --> 00:00:08,000  (also tolerates 0:00:04.96 style input)
CUE_TIMING = re.compile(
    r"^(?P<start>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})\s*-->\s*"
    r"(?P<end>\d{1,2}:\d{2}:\d{2}[,.]\d{1,3})(?P<rest>.*)$"
)


def _normalize_stamp(stamp):
    """WebVTT wants HH:MM:SS.mmm with a period and three-digit milliseconds."""
    clock, _, fraction = stamp.replace(",", ".").partition(".")
    hours, minutes, seconds = clock.split(":")
    return f"{int(hours):02d}:{minutes}:{seconds}.{fraction.ljust(3, '0')[:3]}"


def srt_to_vtt(text):
    """Return `text` as WebVTT. Input that is already WebVTT is passed through
    unchanged apart from line-ending normalization."""
    text = text.lstrip("﻿").replace("\r\n", "\n").replace("\r", "\n")

    lines = []
    for line in text.split("\n"):
        match = CUE_TIMING.match(line.strip())
        if match:
            line = (
                f"{_normalize_stamp(match.group('start'))} --> "
                f"{_normalize_stamp(match.group('end'))}{match.group('rest')}"
            )
        lines.append(line)

    body = "\n".join(lines).strip("\n")
    if body.startswith("WEBVTT"):
        return body + "\n"
    return "WEBVTT\n\n" + body + "\n"


def looks_like_captions(text):
    """Guard against saving a bepress error page as a caption file."""
    stripped = text.lstrip("﻿").lstrip()
    if not stripped or stripped[:200].lower().startswith(("<html", "<!doctype")):
        return False
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    return any(CUE_TIMING.match(line.strip()) for line in normalized.split("\n"))
