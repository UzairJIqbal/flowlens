import { Constants, type Enums } from "../supabase/database.types.ts";

export type AnalysisStatus = Enums<"analysis_status">;
export type AnalysisStage = Enums<"analysis_stage">;

export const STAGES = Constants.public.Enums.analysis_stage;

/**
 * Exactly what the database publishes when a run moves: the status as the
 * event name, the stage and one message. On a failure the message is the
 * reason. Server reads build the same shape, so a page never has to tell a
 * live update from a loaded one.
 */
export type Progress = {
  status: AnalysisStatus;
  stage: AnalysisStage | null;
  message: string | null;
};

/** Returns the private realtime channel name for an analysis. */
export function analysisTopic(analysisId: string): string {
  return `analysis:${analysisId}`;
}

/** Builds progress from a stored row, preferring the error over the stage message. */
export function rowProgress(row: {
  status: AnalysisStatus;
  stage: AnalysisStage | null;
  stage_message: string | null;
  error: string | null;
}): Progress {
  return { status: row.status, stage: row.stage, message: row.error ?? row.stage_message };
}

/** Rejects unknown statuses and normalizes invalid stage or message fields to null. */
export function broadcastProgress(event: string, payload: Record<string, unknown>): Progress | null {
  const status = Constants.public.Enums.analysis_status.find((s) => s === event);
  if (!status) return null;
  return {
    status,
    stage: STAGES.find((s) => s === payload.stage) ?? null,
    message: typeof payload.message === "string" ? payload.message : null,
  };
}
