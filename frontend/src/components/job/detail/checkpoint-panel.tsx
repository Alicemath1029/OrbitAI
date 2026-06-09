/**
 * Copyright 2025 RAIDS Lab
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import {
  ArchiveRestoreIcon,
  CopyIcon,
  PackageOpenIcon,
  RefreshCwIcon,
  RotateCcwIcon,
  ShieldCheckIcon,
  TerminalSquareIcon,
  Trash2Icon,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui-custom/alert-dialog'

import {
  type CheckpointConfig,
  type JobCheckpoint,
  type ModelExport,
  apiJobCheckpointCleanup,
  apiJobCheckpointDelete,
  apiJobCheckpointExport,
  apiJobCheckpointRestore,
  apiJobCheckpointScan,
  apiJobCheckpoints,
} from '@/services/api/vcjob'

import { formatBytes } from '@/utils/formatter'

import { cn } from '@/lib/utils'

interface CheckpointPanelProps {
  jobName: string
}

export default function CheckpointPanel({ jobName }: CheckpointPanelProps) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [exportingCheckpointID, setExportingCheckpointID] = useState<number | null>(null)
  const queryKey = ['job', 'detail', jobName, 'checkpoints']

  const { data, isFetching } = useQuery({
    queryKey,
    queryFn: () => apiJobCheckpoints(jobName, true).then((res) => res.data),
  })

  const refreshQueries = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey }),
      queryClient.invalidateQueries({ queryKey: ['job', 'detail', jobName] }),
    ])
  }

  const scanMutation = useMutation({
    mutationFn: () => apiJobCheckpointScan(jobName),
    onSuccess: async () => {
      toast.success('Checkpoint 扫描完成')
      await refreshQueries()
    },
  })

  const cleanupMutation = useMutation({
    mutationFn: () =>
      apiJobCheckpointCleanup(jobName, {
        keepLast: data?.quota.maxToKeep || data?.checkpoint?.maxToKeep || 3,
      }),
    onSuccess: async (res) => {
      toast.success(`清理完成，释放 ${formatBytes(res.data.reclaimedBytes)}`)
      await refreshQueries()
    },
  })

  const restoreMutation = useMutation({
    mutationFn: (checkpoint: JobCheckpoint) =>
      apiJobCheckpointRestore(jobName, checkpoint.ID, {
        name: `${checkpoint.name}-resume`,
      }),
    onSuccess: async (res) => {
      toast.success(`已提交恢复作业 ${res.data.jobName}`)
      await queryClient.invalidateQueries({ queryKey: ['job'] })
      navigate({
        to: '/portal/jobs/detail/$name',
        params: { name: res.data.jobName },
      })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (checkpoint: JobCheckpoint) => apiJobCheckpointDelete(jobName, checkpoint.ID),
    onSuccess: async () => {
      toast.success('Checkpoint 已删除')
      await refreshQueries()
    },
  })

  const exportMutation = useMutation({
    mutationFn: (checkpoint: JobCheckpoint) => {
      setExportingCheckpointID(checkpoint.ID)
      return apiJobCheckpointExport(jobName, checkpoint.ID, {
        format: 'huggingface',
      })
    },
    onSuccess: async (res) => {
      toast.success(`已提交模型导出 ${res.data.export.name}`)
      await refreshQueries()
    },
    onSettled: () => {
      setExportingCheckpointID(null)
    },
  })

  const checkpoints = data?.items ?? []
  const latestExports = useMemo(
    () => latestExportsByCheckpoint(data?.exports ?? []),
    [data?.exports]
  )
  const maxToKeep = data?.quota.maxToKeep || data?.checkpoint?.maxToKeep || 0
  const lastScannedAt = data?.lastScannedAt ? new Date(data.lastScannedAt).toLocaleString() : '-'
  const latestCheckpoint = data?.latest
  const checkpointRoot = data?.checkpoint?.checkpointDir || '-'
  const latestPath = latestCheckpoint?.path || data?.checkpoint?.latestCheckpoint || ''
  const resumeCommand = buildResumeCommand(data?.checkpoint, latestPath)

  const copyResumeCommand = async () => {
    if (!resumeCommand) {
      return
    }
    await navigator.clipboard.writeText(resumeCommand)
    toast.success('恢复命令已复制')
  }

  return (
    <div className="flex flex-col gap-4 p-4 md:p-6">
      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <Metric label="Checkpoint Root" value={checkpointRoot} mono />
        <Metric label="Latest" value={latestCheckpoint?.name ?? '-'} mono />
        <Metric label="数量" value={`${data?.quota.currentCount ?? 0}/${maxToKeep || '-'}`} />
        <Metric
          label="容量"
          value={`${formatBytes(data?.quota.currentBytes ?? 0)}${
            data?.quota.maxBytes ? ` / ${formatBytes(data.quota.maxBytes)}` : ''
          }`}
        />
        <Metric label="上次扫描" value={lastScannedAt} />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)]">
        <div className="border-border rounded-md border px-3 py-2">
          <div className="text-muted-foreground text-xs">Latest Path</div>
          <div className="mt-1 font-mono text-sm font-medium break-all">{latestPath || '-'}</div>
        </div>
        <div className="border-border rounded-md border px-3 py-2">
          <div className="text-muted-foreground text-xs">恢复模式</div>
          <div className="mt-1 text-sm font-medium">
            {data?.checkpoint?.resumeMode ?? '-'} / {data?.checkpoint?.framework ?? '-'}
          </div>
        </div>
      </div>

      {resumeCommand && (
        <div className="border-border bg-muted/30 rounded-md border">
          <div className="border-border flex items-center justify-between gap-3 border-b px-3 py-2">
            <div className="text-muted-foreground flex items-center gap-2 text-sm">
              <TerminalSquareIcon className="size-4" />
              <span>恢复命令</span>
            </div>
            <Button type="button" size="sm" variant="ghost" onClick={copyResumeCommand}>
              <CopyIcon className="size-4" />
              复制
            </Button>
          </div>
          <pre className="max-h-48 overflow-auto p-3 text-xs leading-5">
            <code>{resumeCommand}</code>
          </pre>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <ShieldCheckIcon className="size-4" />
          <span>
            保留策略按最新 checkpoint 优先，超额数量 {data?.quota.excessCount ?? 0}
            {data?.quota.excessBytes ? `，超额容量 ${formatBytes(data.quota.excessBytes)}` : ''}
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            onClick={() => scanMutation.mutate()}
            disabled={scanMutation.isPending || isFetching}
          >
            <RefreshCwIcon className={cn('size-4', scanMutation.isPending && 'animate-spin')} />
            扫描
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="secondary" disabled={!latestCheckpoint || restoreMutation.isPending}>
                <ArchiveRestoreIcon className="size-4" />从 latest 恢复
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>从 latest checkpoint 恢复</AlertDialogTitle>
                <AlertDialogDescription>
                  将基于当前作业配置提交一个新作业，并设置恢复路径为 {latestCheckpoint?.path ?? '-'}
                  。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction
                  disabled={!latestCheckpoint}
                  onClick={() => latestCheckpoint && restoreMutation.mutate(latestCheckpoint)}
                >
                  提交恢复作业
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                disabled={cleanupMutation.isPending || checkpoints.length === 0}
              >
                <Trash2Icon className="size-4" />
                清理
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>清理 checkpoint</AlertDialogTitle>
                <AlertDialogDescription>
                  将保留最新 {maxToKeep || 3} 个 checkpoint，删除超出配额的历史项。
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>取消</AlertDialogCancel>
                <AlertDialogAction onClick={() => cleanupMutation.mutate()}>清理</AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>名称</TableHead>
            <TableHead>Step</TableHead>
            <TableHead>大小</TableHead>
            <TableHead>更新时间</TableHead>
            <TableHead>模型导出</TableHead>
            <TableHead>路径</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {checkpoints.length === 0 && (
            <TableRow>
              <TableCell colSpan={7} className="text-muted-foreground h-24 text-center">
                暂无 checkpoint
              </TableCell>
            </TableRow>
          )}
          {checkpoints.map((checkpoint) => {
            const latestExport = latestExports.get(checkpoint.ID)
            const isExporting = exportMutation.isPending && exportingCheckpointID === checkpoint.ID
            return (
              <TableRow key={checkpoint.ID}>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{checkpoint.name}</span>
                    {checkpoint.latest && <Badge variant="secondary">latest</Badge>}
                  </div>
                </TableCell>
                <TableCell>{checkpoint.step >= 0 ? checkpoint.step : '-'}</TableCell>
                <TableCell>{formatBytes(checkpoint.sizeBytes)}</TableCell>
                <TableCell>{new Date(checkpoint.modTime).toLocaleString()}</TableCell>
                <TableCell>
                  <ModelExportSummary exportRecord={latestExport} />
                </TableCell>
                <TableCell className="max-w-[360px] truncate font-mono text-xs">
                  {checkpoint.path}
                </TableCell>
                <TableCell>
                  <div className="flex justify-end gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={exportMutation.isPending}
                      onClick={() => exportMutation.mutate(checkpoint)}
                    >
                      <PackageOpenIcon className={cn('size-4', isExporting && 'animate-spin')} />
                      导出模型
                    </Button>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="secondary" size="sm" disabled={restoreMutation.isPending}>
                          <ArchiveRestoreIcon className="size-4" />
                          从此恢复
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>从 checkpoint 恢复</AlertDialogTitle>
                          <AlertDialogDescription>
                            将基于当前作业配置提交一个新作业，并设置恢复路径为 {checkpoint.path}。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction onClick={() => restoreMutation.mutate(checkpoint)}>
                            提交恢复作业
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm" disabled={deleteMutation.isPending}>
                          <Trash2Icon className="size-4" />
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>删除 checkpoint</AlertDialogTitle>
                          <AlertDialogDescription>
                            将删除 {checkpoint.name} 对应的存储目录，并记录审计日志。
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>取消</AlertDialogCancel>
                          <AlertDialogAction
                            variant="destructive"
                            onClick={() => deleteMutation.mutate(checkpoint)}
                          >
                            删除
                          </AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>

      {isFetching && (
        <div className="text-muted-foreground flex items-center gap-2 text-sm">
          <RotateCcwIcon className="size-4 animate-spin" />
          正在同步 checkpoint 列表
        </div>
      )}
    </div>
  )
}

function Metric({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="border-border rounded-md border px-3 py-2">
      <div className="text-muted-foreground text-xs">{label}</div>
      <div className={cn('mt-1 truncate text-sm font-medium', mono && 'font-mono')}>{value}</div>
    </div>
  )
}

function ModelExportSummary({ exportRecord }: { exportRecord?: ModelExport }) {
  if (!exportRecord) {
    return <span className="text-muted-foreground text-sm">-</span>
  }

  return (
    <div className="flex min-w-[150px] flex-col gap-1">
      <ModelExportStatusBadge status={exportRecord.status} />
      <div className="text-muted-foreground max-w-[220px] truncate font-mono text-xs">
        {exportRecord.outputPath || exportRecord.name}
      </div>
    </div>
  )
}

function ModelExportStatusBadge({ status }: { status: ModelExport['status'] }) {
  const statusConfig = {
    pending: {
      label: '等待中',
      className: 'border-highlight-slate/20 bg-highlight-slate/10 text-highlight-slate',
    },
    running: {
      label: '导出中',
      className: 'border-highlight-sky/20 bg-highlight-sky/10 text-highlight-sky',
    },
    succeeded: {
      label: '已导出',
      className: 'border-highlight-emerald/20 bg-highlight-emerald/10 text-highlight-emerald',
    },
    failed: {
      label: '失败',
      className: 'border-highlight-red/20 bg-highlight-red/10 text-highlight-red',
    },
  }[status]

  return (
    <Badge
      variant="outline"
      className={cn('w-fit rounded-full px-2 font-normal', statusConfig.className)}
    >
      {statusConfig.label}
    </Badge>
  )
}

function latestExportsByCheckpoint(exports: ModelExport[]) {
  const byCheckpoint = new Map<number, ModelExport>()
  for (const exportRecord of exports) {
    const existing = byCheckpoint.get(exportRecord.checkpointID)
    if (
      !existing ||
      new Date(exportRecord.CreatedAt).getTime() > new Date(existing.CreatedAt).getTime()
    ) {
      byCheckpoint.set(exportRecord.checkpointID, exportRecord)
    }
  }
  return byCheckpoint
}

function buildResumeCommand(checkpoint?: CheckpointConfig, latestPath?: string) {
  if (!checkpoint?.enabled) {
    return ''
  }

  const resumeFrom = latestPath || checkpoint.resumeFrom || '$ORBIT_RESUME_FROM'
  const outputDir = checkpoint.outputDir || '$ORBIT_OUTPUT_DIR'
  const checkpointDir = checkpoint.checkpointDir || '$ORBIT_CHECKPOINT_DIR'
  const saveSteps = checkpoint.saveSteps ? `${checkpoint.saveSteps}` : '$ORBIT_SAVE_STEPS'
  const maxToKeep = checkpoint.maxToKeep ? `${checkpoint.maxToKeep}` : '$ORBIT_SAVE_TOTAL_LIMIT'

  switch (checkpoint.framework) {
    case 'hf-trainer':
      return `python train.py \\
  --model_name_or_path "$MODEL_PATH" \\
  --train_file "$TRAIN_FILE" \\
  --output_dir "${outputDir}" \\
  --save_strategy steps \\
  --save_steps "${saveSteps}" \\
  --save_total_limit "${maxToKeep}" \\
  --resume_from_checkpoint "${resumeFrom}"`
    case 'pytorch':
      return `torchrun \\
  --nnodes="\${NNODES:-1}" \\
  --nproc_per_node="\${NPROC_PER_NODE:-1}" \\
  train.py \\
  --output_dir "${outputDir}" \\
  --checkpoint_dir "${checkpointDir}" \\
  --resume_from "${resumeFrom}"`
    case 'deepspeed':
      return `deepspeed train.py \\
  --deepspeed "$DEEPSPEED_CONFIG" \\
  --output_dir "${outputDir}" \\
  --resume_from_checkpoint "${resumeFrom}"`
    case 'verl':
      return `python -m verl.trainer.main_ppo \\
  trainer.default_local_dir="${checkpointDir}" \\
  trainer.resume_mode="${checkpoint.resumeMode}" \\
  trainer.resume_from_path="${resumeFrom}" \\
  trainer.save_freq="${saveSteps}"`
    case 'lightning':
      return `python train.py \\
  --default_root_dir "${outputDir}" \\
  --ckpt_path "${resumeFrom}"`
    case 'fsdp':
      return `torchrun train.py \\
  --output_dir "${outputDir}" \\
  --checkpoint_dir "${checkpointDir}" \\
  --resume_from "${resumeFrom}"`
    case 'tensorflow':
      return `ORBIT_OUTPUT_DIR="${outputDir}" \\
ORBIT_CHECKPOINT_DIR="${checkpointDir}" \\
ORBIT_RESUME_FROM="${resumeFrom}" \\
python train_tensorflow.py`
    case 'jax':
      return `ORBIT_OUTPUT_DIR="${outputDir}" \\
ORBIT_CHECKPOINT_DIR="${checkpointDir}" \\
ORBIT_RESUME_FROM="${resumeFrom}" \\
python train_jax.py`
    default:
      return `ORBIT_OUTPUT_DIR="${outputDir}" \\
ORBIT_CHECKPOINT_DIR="${checkpointDir}" \\
ORBIT_RESUME_FROM="${resumeFrom}" \\
python train.py`
  }
}
