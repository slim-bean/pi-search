import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { fetchScreenshotSegment } from "./proxies/browser";
import { screenshotNote, screenshotImage, screenshotDetails } from "./screenshot";

export function registerScreenshotTool(pi: ExtensionAPI) {
  pi.registerTool({
    name: "web_fetch_screenshot",
    label: "Web Fetch Screenshot Segment",
    description: "Retrieve one image segment from a frozen screenshot previously created by web_fetch with screenshot: true. Does not navigate, scroll or refetch the website. Segments are one-based and slightly overlap. Captures expire after 10 minutes or gateway restart; expired captures are never automatically recreated. Use browser_screenshot for the current interactive tab instead.",
    promptSnippet: "Retrieve another image segment from a web_fetch visual snapshot without refetching",
    parameters: Type.Object({
      captureId: Type.String({ description: "Screenshot capture ID returned by web_fetch." }),
      segment: Type.Integer({ minimum: 1, maximum: 10, description: "One-based segment number, up to the capture's reported segment count." }),
    }),
    async execute(_id, params, signal) {
      const shot = await fetchScreenshotSegment(params.captureId, params.segment, signal);
      return {
        content: [
          { type: "text" as const, text: `Screenshot of ${shot.url}\n${screenshotNote(shot)}` },
          screenshotImage(shot),
        ],
        details: screenshotDetails(shot),
      };
    },
  });
}
