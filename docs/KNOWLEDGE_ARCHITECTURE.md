# Enterprise Knowledge, Document Intelligence & RAG Architecture (Phase 14)

Imported from `usmanclaude92-creator/Artify-Backend---Google-AI-Studio-`
(commit `4a1d7cd`), copied verbatim — this subsystem had no dependency on
the excluded parallel AI Control Center stack (see
`docs/AUTOMATION_ARCHITECTURE.md`'s "Relationship to Phase 12" section), so
no adaptation was needed at the service layer. Only
`server/routes/v1/knowledgeRoutes.ts` was rewritten, from the source's raw
try/catch + `res.json({success,data})` handlers to this repo's
`asyncHandler`/`sendSuccess` convention.

## Pipeline

`KnowledgeCollection` (an access-scoped grouping — `PUBLIC` or
`ROLE_BASED` with an `allowedRoles` list) contains `KnowledgeSource`s
(a named origin — manual upload, a future connector) which contain
`KnowledgeDocument`s. Each document is versioned
(`KnowledgeDocumentVersion`), and each version is chunked
(`KnowledgeChunk`) and embedded for retrieval.

1. **`ExtractionPipeline.extract(buffer, mimeType, filename)`** — format-
   aware text extraction (plain text, Markdown, HTML tag-stripping, CSV/
   tabular row-and-column formatting, JSON pretty-printing). Returns
   `{ text, metadata: { characterCount, wordCount, format, ... } }`.
2. **`ChunkingEngine.chunk(text, options)`** — splits extracted text into
   overlapping, heading-aware chunks (`maxChunkSize`/`overlapSize`
   configurable), each carrying a token estimate and, where detectable, a
   `sectionHeading`/`pageNumber`.
3. **`EmbeddingService.generateEmbedding(text)`** — produces a deterministic
   768-dimension normalized vector (identical input → identical output,
   `cosineSimilarity` for comparison). This is a local, dependency-free
   embedding, not a call to an external embedding API — adequate for
   relevance ranking within a tenant's own corpus without adding another
   network dependency or cost line.
4. **`HybridSearchEngine`** — combines vector similarity with lexical
   (keyword) matching to rank chunks for a query, respecting the caller's
   `organizationId` (hard tenant boundary — a query never crosses
   organizations) and the collection's `accessPolicy`/`allowedRoles` (a
   `ROLE_BASED` collection excludes a caller whose role isn't listed,
   regardless of how well their query matches).
5. **`KnowledgeService.search(...)`** — the entry point used by routes,
   `WorkflowEngine`'s `KNOWLEDGE_RETRIEVAL` step, and Copilot's grounding.
6. **`ContextBuilder.buildContext(chunks, options)`** — formats ranked
   chunks into a single bounded (`maxTokens`, default 2500) prompt-
   injection block with `[REF-n]` citation tags and a same-shaped
   `KnowledgeCitation[]` array, plus best-effort cross-document conflict
   detection (e.g. one source saying "deprecated", another "supported",
   on the same topic) surfaced as `conflictNotes`.

`KnowledgeService.ingestDocument(...)` runs steps 1–3 (and writes the
`KnowledgeDocumentVersion`/`KnowledgeChunk` rows) in one call; re-ingesting
under the same `title` within a collection creates a new version rather
than a duplicate document, and `reindexDocument` re-chunks/re-embeds the
current active version's already-extracted text without re-uploading.

## Multi-tenant and role isolation

Every query is scoped by `organizationId` first — Organization B's search
returns zero results for a document that exists only in Organization A,
regardless of query similarity (verified in
`tests/unit/knowledge/knowledgeService.test.ts` §4 and
`tests/integration/knowledgeRoutes.test.ts`). Within a tenant, a
`ROLE_BASED` collection is a second, independent gate — even a caller with
broad `userPermissions` is excluded if their `roleName` isn't in the
collection's `allowedRoles`.

## Integration points

- **`WorkflowEngine`'s `KNOWLEDGE_RETRIEVAL` step** — see
  `docs/AUTOMATION_ARCHITECTURE.md`'s "Known schema gap fixed during
  import" for the `AutomationStepType` enum fix this required.
- **`CopilotService.sendMessage`** — calls `KnowledgeService.search`/
  `getGroundedContext` to ground Copilot's answers with citations (see
  `docs/COPILOT_ARCHITECTURE.md`).
- **Not wired**: the source repo's own `AiOrchestrator` prompt-augmentation
  path and its `searchKnowledgeBase` AI tool both depended on the excluded
  parallel AI Control Center and were not ported (this repo's Phase 12
  `AI_TOOL_REGISTRY` does not currently register an equivalent tool). A
  future addition could register one against this repo's real governance
  dispatcher if a direct "AI-tool-initiated" knowledge search becomes a
  requirement.

## Permissions

`knowledge.read` / `.search` / `.create` / `.upload` / `.edit` / `.archive`
/ `.reindex` / `.manage`, seeded per role in
`prisma/rolePermissionSeed.ts`.
