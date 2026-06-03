import { apiV1Get, apiV1Post, apiV1Put } from '@/services/client'
import { IResponse, IWithPagination } from '@/services/types'

export type ExperimentVisibility = 'private' | 'account'
export type ExperimentRunStatus =
  | 'pending'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'terminated'
  | 'cancelled'

export interface Experiment {
  ID: number
  CreatedAt: string
  UpdatedAt: string
  name: string
  description: string
  userID: number
  accountID: number
  visibility: ExperimentVisibility
  tags?: Record<string, unknown>
}

export interface ExperimentRun {
  ID: number
  CreatedAt: string
  UpdatedAt: string
  experimentID: number
  parentRunID?: number
  sourceCheckpointID?: number
  jobID?: number
  jobName: string
  runName: string
  status: ExperimentRunStatus
  userID: number
  accountID: number
  hyperparams?: Record<string, unknown>
  codeSnapshot?: Record<string, unknown>
  dataSnapshot?: Record<string, unknown>
  imageSnapshot?: Record<string, unknown>
  resourceSnapshot?: Record<string, unknown>
  checkpointSnapshot?: Record<string, unknown>
  reproduceSnapshot?: Record<string, unknown>
  tags?: Record<string, unknown>
  startedAt?: string
  finishedAt?: string
}

export interface RunMetric {
  ID: number
  CreatedAt: string
  runID: number
  clientRecordID?: string
  name: string
  step: number
  value: number
  timestamp: string
  context?: Record<string, unknown>
}

export interface RunArtifact {
  ID: number
  CreatedAt: string
  runID: number
  clientRecordID?: string
  name: string
  type: string
  path: string
  sizeBytes: number
  sourceType?: string
  sourceID?: number
  metadata?: Record<string, unknown>
}

export interface ExperimentCreateReq {
  name: string
  description?: string
  visibility?: ExperimentVisibility
  tags?: Record<string, unknown>
}

export interface ExperimentRunConfig {
  experimentId: number
  runName?: string
  hyperparams?: Record<string, unknown>
  code?: Record<string, unknown>
  data?: Record<string, unknown>
  image?: Record<string, unknown>
  tags?: Record<string, unknown>
}

export const apiExperimentList = () =>
  apiV1Get<IResponse<IWithPagination<Experiment>>>('experiments')

export const apiExperimentCreate = (payload: ExperimentCreateReq) =>
  apiV1Post<IResponse<Experiment>>('experiments', payload)

export const apiExperimentGet = (id: number) => apiV1Get<IResponse<Experiment>>(`experiments/${id}`)

export const apiExperimentUpdate = (id: number, payload: Partial<ExperimentCreateReq>) =>
  apiV1Put<IResponse<Experiment>>(`experiments/${id}`, payload)

export const apiExperimentRuns = (id: number) =>
  apiV1Get<IResponse<ExperimentRun[]>>(`experiments/${id}/runs`)

export const apiExperimentRunGet = (runID: number) =>
  apiV1Get<IResponse<ExperimentRun>>(`experiments/runs/${runID}`)

export const apiExperimentRunMetrics = (runID: number) =>
  apiV1Get<IResponse<RunMetric[]>>(`experiments/runs/${runID}/metrics`)

export const apiExperimentRunArtifacts = (runID: number) =>
  apiV1Get<IResponse<RunArtifact[]>>(`experiments/runs/${runID}/artifacts`)
