// Figwright-Plus topology-layer contract extensions.
//
// These fields belong to the remote-partner workflow (LAN / streamable-MCP asset delivery) and are
// intentionally kept OUT of @figwright/shared/queries.ts so that upstream changes to the base
// save-result schemas can never collide with them during a cherry-pick / rebase / merge.
//
// The base schemas live upstream; we only ADD the remote-delivery fields here:
//   - assetToken: one-time token the partner redeems via fetch_asset (credentials stay server-side)
//   - assetUrl:   direct-download URL (direct-delivery mode — zero base64 crosses the MCP channel)
//   - note:       in-result hint telling the partner how to retrieve the bytes
// assetToken and assetUrl are mutually exclusive within a single result entry.

import { z } from 'zod';

import {
  SavedImageFillSchema,
  SavedNodeImageFillsSchema,
  SavedScreenshotSchema,
} from '@figwright/shared';

export const RemoteSavedScreenshotSchema = SavedScreenshotSchema.extend({
  assetToken: z.string().nullable().optional(),
  assetUrl: z.string().nullable().optional(),
});
export type RemoteSavedScreenshot = z.infer<typeof RemoteSavedScreenshotSchema>;

export const RemoteSavedImageFillSchema = SavedImageFillSchema.extend({
  assetToken: z.string().nullable().optional(),
  assetUrl: z.string().nullable().optional(),
});
export type RemoteSavedImageFill = z.infer<typeof RemoteSavedImageFillSchema>;

export const RemoteSavedNodeImageFillsSchema = SavedNodeImageFillsSchema.extend({
  // Override the nested `images` array with the Remote (assetToken/assetUrl-aware) variant.
  // `.extend` replaces this top-level key, so the override takes.
  images: z.array(RemoteSavedImageFillSchema),
});
export type RemoteSavedNodeImageFills = z.infer<typeof RemoteSavedNodeImageFillsSchema>;

// Recomposed (not `.extend`-ed) from the base result schema: `.extend` only touches top-level keys
// and would leave the nested `saved`/`nodes` arrays pointing at the BASE per-entry schema (which
// lacks assetToken/assetUrl). We must rebuild the object so the nested arrays use the Remote
// per-entry schemas.
export const RemoteSaveScreenshotsResultSchema = z.object({
  saved: z.array(RemoteSavedScreenshotSchema),
  note: z.string().optional(),
});
export type RemoteSaveScreenshotsResult = z.infer<typeof RemoteSaveScreenshotsResultSchema>;

export const RemoteSaveImageFillsResultSchema = z.object({
  nodes: z.array(RemoteSavedNodeImageFillsSchema),
  note: z.string().optional(),
});
export type RemoteSaveImageFillsResult = z.infer<typeof RemoteSaveImageFillsResultSchema>;
