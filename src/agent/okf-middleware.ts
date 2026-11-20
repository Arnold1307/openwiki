import type { OpenWikiBackend } from "./backend-types.js";
import type { ClaimEvidenceResources } from "../okf/claim-sources.js";
import {
  ENGLISH_CONCEPT_TYPE,
  ENGLISH_INDEX_LABELS,
  type IndexLabels,
} from "../okf/index-labels.js";
import { inStage } from "../telemetry/index.js";
import type { OpenWikiOutputMode } from "./types.js";
import {
  finalizeWikiArtifacts,
  prepareWikiForAuthoring,
  type PreparedWikiState,
} from "./wiki-finalizer.js";

/**
 * Prepares the wiki's OKF state before a run. It
 * migrates existing pages to valid front matter before the agent starts,
 * snapshots their exact bodies, synchronizes indexes after the run, and
 * stamps final code-owned `generated` provenance on every new or changed page.
 *
 * `now` is the run's single stamp time (an ISO 8601 datetime), computed once by
 * the caller and threaded in so every page written in one run shares one
 * `generated.at` and the stamping stays deterministic under test. It defaults to
 * the current time so callers that do not stamp (or tests exercising only the
 * index passes) need not supply one.
 *
 * `claimSources`, when supplied by a repository Claims runtime, is read only
 * during finalization so it reflects every mutation accepted during the run.
 *
 * @param backend - Filesystem abstraction rooted to the active wiki target.
 * @param outputMode - Repository or local-wiki output layout.
 * @param labels - Localized labels used by generated indexes.
 * @param conceptType - Fallback OKF concept type used during migration.
 * @param now - Shared ISO 8601 timestamp for generated provenance events.
 * @param claimSources - Optional deferred Claims evidence projection.
 * @returns Prepared snapshot used by finalization.
 */
export async function prepareOpenWikiIndex(
  backend: OpenWikiBackend,
  outputMode: OpenWikiOutputMode,
  labels: IndexLabels = ENGLISH_INDEX_LABELS,
  conceptType: string = ENGLISH_CONCEPT_TYPE,
  now: string = new Date().toISOString(),
  claimSources?: () => ClaimEvidenceResources,
): Promise<PreparedWikiState> {
  return prepareWikiForAuthoring({
    backend,
    outputMode,
    conceptType,
    runOperation: (operation, task) =>
      inStage("build", task, {
        errorClass: "okf_error",
        errorDetail: operation,
      }),
  });
}

export async function finalizeOpenWikiIndex(
  backend: OpenWikiBackend,
  outputMode: OpenWikiOutputMode,
  prepared: PreparedWikiState,
  labels: IndexLabels = ENGLISH_INDEX_LABELS,
  conceptType: string = ENGLISH_CONCEPT_TYPE,
  now: string = new Date().toISOString(),
  claimSources?: () => ClaimEvidenceResources,
): Promise<void> {
  await finalizeWikiArtifacts({
    backend, outputMode, labels, conceptType, prepared, at: now,
    claimSources: claimSources?.(),
    runOperation: (operation, task) => inStage("finalize", task, {
      errorClass: "okf_error", errorDetail: operation,
    }),
  });
}

/**
 * Deterministically repairs invalid OKF metadata after a wiki write. A warning
 * is appended only when the repaired bytes cannot be persisted or re-read.
 */
