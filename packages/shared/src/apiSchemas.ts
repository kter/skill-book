import { z } from "zod";
import { ARTIFACT_TYPES } from "./types.js";

export const artifactNameSchema = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]$/, "name must be a kebab-case slug");

export const artifactTypeSchema = z.enum(ARTIFACT_TYPES);

export const createArtifactSchema = z.object({
  name: artifactNameSchema,
  type: artifactTypeSchema,
  description: z.string().max(2000).default(""),
  tags: z.array(z.string().min(1).max(64)).max(10).default([]),
  forkedFromArtifactId: z.string().uuid().optional(),
});

export const updateArtifactSchema = z.object({
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().min(1).max(64)).max(10).optional(),
});

export const publishVersionSchema = z.object({
  stagingKey: z.string().min(1).max(512),
  message: z.string().max(500).optional(),
});

export const ratingSchema = z.object({
  stars: z.number().int().min(1).max(5),
});

export const scanOverrideSchema = z.object({
  fingerprint: z.string().min(8).max(128),
  reason: z.string().min(1).max(500),
});

export const listArtifactsQuerySchema = z.object({
  q: z.string().max(200).optional(),
  tag: z.string().max(64).optional(),
  type: artifactTypeSchema.optional(),
  sort: z.enum(["updated", "downloads", "stars"]).default("updated"),
});

export type CreateArtifactInput = z.infer<typeof createArtifactSchema>;
export type UpdateArtifactInput = z.infer<typeof updateArtifactSchema>;
export type PublishVersionInput = z.infer<typeof publishVersionSchema>;
export type RatingInput = z.infer<typeof ratingSchema>;
export type ScanOverrideInput = z.infer<typeof scanOverrideSchema>;
export type ListArtifactsQuery = z.infer<typeof listArtifactsQuerySchema>;
