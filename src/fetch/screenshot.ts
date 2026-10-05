import { createHash } from "node:crypto";

/** browser-fetch screenshot protocol v1. Segment numbers are one-based. */
export interface ScreenshotSegment {
  version: 1;
  capture_id: string;
  url: string;
  title: string;
  expires_at: string;
  segment: number;
  segments: number;
  viewport_width: number;
  page_width: number;
  page_height: number;
  captured_height: number;
  truncated: boolean;
  horizontal_truncated: boolean;
  y_start: number;
  y_end: number;
  image: { data: string; mime_type: "image/jpeg"; width: number; height: number; bytes: number; sha256: string };
}

/** Fail closed against old gateways, malformed responses and unbounded attachments. */
export function validateScreenshot(value: unknown): ScreenshotSegment {
  const s = value as ScreenshotSegment | undefined;
  const int = (n: unknown, min: number, max: number): n is number => Number.isSafeInteger(n) && (n as number) >= min && (n as number) <= max;
  if (!s || s.version !== 1 || typeof s.capture_id !== "string" || !/^[A-Za-z0-9_-]{16,128}$/.test(s.capture_id) ||
      typeof s.url !== "string" || !/^https?:\/\//.test(s.url) || typeof s.title !== "string" ||
      typeof s.expires_at !== "string" || !Number.isFinite(Date.parse(s.expires_at)) ||
      !int(s.segments, 1, 10) || !int(s.segment, 1, s.segments) || s.viewport_width !== 1280 ||
      !int(s.page_width, 1, 1e9) || !int(s.page_height, 1, 1e9) || !int(s.captured_height, 1, 12000) || s.page_height < s.captured_height ||
      s.truncated !== (s.page_height > s.captured_height) || s.horizontal_truncated !== (s.page_width > 1280) ||
      s.segments !== Math.max(1, 1 + Math.ceil((s.captured_height - 1400) / 1300)) ||
      !int(s.y_start, 0, s.captured_height - 1) || s.y_start !== (s.segment - 1) * 1300 ||
      !int(s.y_end, s.y_start + 1, s.captured_height) || s.y_end !== Math.min(s.y_start + 1400, s.captured_height) ||
      !s.image || s.image.mime_type !== "image/jpeg" || !int(s.image.width, 1, 1280) || !int(s.image.height, 1, 1400) ||
      s.image.height > s.y_end - s.y_start ||
      !int(s.image.bytes, 1, 384 * 1024) || typeof s.image.data !== "string" || s.image.data.length > 524288 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(s.image.data) ||
      typeof s.image.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(s.image.sha256)) {
    throw new Error("Browser gateway did not return a valid paginated screenshot (protocol v1). Upgrade browser-fetch; no text-only fallback was used.");
  }
  const bytes = Buffer.from(s.image.data, "base64");
  if (bytes.length !== s.image.bytes || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      createHash("sha256").update(bytes).digest("hex") !== s.image.sha256) {
    throw new Error("Browser gateway returned an invalid screenshot image or checksum");
  }
  return s;
}

export function screenshotNote(s: ScreenshotSegment): string {
  return [
    `Screenshot capture: ${s.capture_id}`,
    `Segment: ${s.segment} of ${s.segments}; image: ${s.image.width} × ${s.image.height} pixels`,
    `Page region: y=${s.y_start}–${s.y_end} CSS pixels; captured height: ${s.captured_height} of ${s.page_height}`,
    `Expires: ${s.expires_at}`,
    s.truncated ? "Height limit reached: content below the captured region is NOT included." : null,
    s.horizontal_truncated ? "Horizontal overflow beyond the 1280 CSS-pixel capture width is NOT included." : null,
    "Frozen visual snapshot, not website pagination. Off-screen lazy images and hidden gallery slides may not be loaded.",
    s.segment < s.segments ? `For more, call web_fetch_screenshot with captureId="${s.capture_id}" and segment=${s.segment + 1}. This does not navigate or refetch.` : "Last screenshot segment.",
  ].filter(Boolean).join("\n");
}

/** Don't duplicate base64 in tool details/session metadata. */
export function screenshotDetails(s: ScreenshotSegment) {
  const { image, ...manifest } = s;
  const { data: _data, ...imageInfo } = image;
  return { ...manifest, image: imageInfo };
}

export function screenshotImage(s: ScreenshotSegment) {
  return { type: "image" as const, data: s.image.data, mimeType: s.image.mime_type };
}
