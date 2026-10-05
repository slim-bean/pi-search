import { createHash } from "node:crypto";
import type { ScreenshotSegment } from "../src/fetch/screenshot";

export function screenshotFixture(segment = 1): ScreenshotSegment {
  const data = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  return {
    version: 1, capture_id: "abcdefghijklmnopqrstuvwx", url: "https://listing.example/item", title: "Fixture",
    expires_at: new Date(Date.now() + 600_000).toISOString(), segment, segments: 2, viewport_width: 1280,
    page_width: 1280, page_height: 2700, captured_height: 2700, truncated: false, horizontal_truncated: false,
    y_start: segment === 1 ? 0 : 1300, y_end: segment === 1 ? 1400 : 2700,
    image: { data: data.toString("base64"), mime_type: "image/jpeg", width: 1280, height: 1400, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex") },
  };
}
