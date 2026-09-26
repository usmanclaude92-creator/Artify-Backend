/**
 * Phase 14: Enterprise Knowledge, Document Intelligence & RAG — API Routes
 * (imported from usmanclaude92-creator/Artify-Backend---Google-AI-Studio-,
 * commit 4a1d7cd). Adapted from the source repo's raw try/catch +
 * `res.json({success,data})` handlers to this repo's `asyncHandler` +
 * `sendSuccess` convention, and `req.user!.role.permissions`/`.key`
 * instead of the source's own (unused-here) role shape.
 */
import { Router } from "express";
import express from "express";
import { authenticateToken, requirePermission } from "../../middleware/auth";
import { asyncHandler } from "../../utils/asyncHandler";
import { sendSuccess } from "../../core/apiResponse";
import { KnowledgeService } from "../../services/knowledge/KnowledgeService";
import { prisma } from "../../db/prisma";
import { NotFoundError, ValidationError } from "../../core/errors";
import {
  createCollectionSchema,
  registerSourceSchema,
  listDocumentsQuerySchema,
  uploadDocumentSchema,
  searchKnowledgeSchema,
} from "../../schemas/knowledgeSchemas";

const router = Router();

router.use(authenticateToken);

// ---------------------------------------------------------------------------
// Collections
// ---------------------------------------------------------------------------
router.get(
  "/collections",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const collections = await KnowledgeService.listCollections(req.user!.organizationId);
    sendSuccess(res, { collections });
  })
);

router.post(
  "/collections",
  requirePermission("knowledge.create"),
  asyncHandler(async (req, res) => {
    const input = createCollectionSchema.parse(req.body);
    const collection = await KnowledgeService.createCollection({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      ...input,
    });
    sendSuccess(res, { collection }, 201);
  })
);

router.get(
  "/collections/:id",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const collection = await KnowledgeService.getCollection(req.params.id!, req.user!.organizationId);
    sendSuccess(res, { collection });
  })
);

// ---------------------------------------------------------------------------
// Sources
// ---------------------------------------------------------------------------
router.post(
  "/sources",
  requirePermission("knowledge.create"),
  asyncHandler(async (req, res) => {
    const input = registerSourceSchema.parse(req.body);
    const source = await KnowledgeService.registerSource({
      organizationId: req.user!.organizationId,
      ...input,
    });
    sendSuccess(res, { source }, 201);
  })
);

router.get(
  "/sources",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const sources = await prisma.knowledgeSource.findMany({
      where: { organizationId: req.user!.organizationId, status: "ACTIVE" },
      include: {
        collection: true,
        _count: { select: { documents: true } },
      },
    });
    sendSuccess(res, { sources });
  })
);

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------
router.get(
  "/documents",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const { collectionId, sourceId, status } = listDocumentsQuerySchema.parse(req.query);

    const documents = await prisma.knowledgeDocument.findMany({
      where: {
        organizationId: req.user!.organizationId,
        ...(collectionId ? { collectionId } : {}),
        ...(sourceId ? { sourceId } : {}),
        ...(status ? { status } : {}),
      },
      include: {
        collection: true,
        source: true,
        _count: { select: { chunks: true, versions: true } },
      },
      orderBy: { createdAt: "desc" },
    });
    sendSuccess(res, { documents });
  })
);

router.get(
  "/documents/:id",
  requirePermission("knowledge.read"),
  asyncHandler(async (req, res) => {
    const document = await prisma.knowledgeDocument.findFirst({
      where: { id: req.params.id!, organizationId: req.user!.organizationId },
      include: {
        collection: true,
        source: true,
        versions: { orderBy: { version: "desc" } },
        ingestionJobs: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!document) {
      throw new NotFoundError(`Document "${req.params.id}" not found.`);
    }
    sendSuccess(res, { document });
  })
);

// Ingest / Upload Document (supports direct text/raw payload or base64 file upload)
router.post(
  "/documents/upload",
  requirePermission("knowledge.upload"),
  express.json({ limit: "25mb" }),
  asyncHandler(async (req, res) => {
    const { text, contentBase64, mimeType, filename, title, description, collectionId, sourceId, securityScope, requiredRole, metadata } =
      uploadDocumentSchema.parse(req.body);

    let buffer: Buffer;
    const finalMime = mimeType || "text/plain";

    if (contentBase64) {
      buffer = Buffer.from(contentBase64, "base64");
    } else if (text !== undefined && text !== null) {
      buffer = Buffer.from(String(text), "utf8");
    } else {
      throw new ValidationError("Either text or contentBase64 is required.");
    }

    const result = await KnowledgeService.ingestDocument({
      organizationId: req.user!.organizationId,
      userId: req.user!.id,
      collectionId,
      sourceId,
      title: title || filename || "Untitled Document",
      description,
      buffer,
      mimeType: finalMime,
      filename,
      securityScope,
      requiredRole,
      metadata: metadata || {},
    });

    sendSuccess(res, result, 201);
  })
);

router.post(
  "/documents/:id/reindex",
  requirePermission("knowledge.reindex"),
  asyncHandler(async (req, res) => {
    const result = await KnowledgeService.reindexDocument(req.params.id!, req.user!.organizationId);
    sendSuccess(res, result);
  })
);

// ---------------------------------------------------------------------------
// Search & Retrieval (RAG query endpoint)
// ---------------------------------------------------------------------------
router.post(
  "/search",
  requirePermission("knowledge.search"),
  asyncHandler(async (req, res) => {
    const { query, mode, limit, minScore, filter } = searchKnowledgeSchema.parse(req.body);

    const results = await KnowledgeService.search(
      {
        query,
        mode: mode || "HYBRID",
        limit: limit ?? 10,
        minScore: minScore ?? 0.15,
        filter,
      },
      {
        organizationId: req.user!.organizationId,
        userId: req.user!.id,
        userPermissions: req.user!.role.permissions || [],
        roleName: req.user!.role.key,
      }
    );

    sendSuccess(res, { results, count: results.length });
  })
);

export default router;
