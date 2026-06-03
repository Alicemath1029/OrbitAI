import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArchiveRestoreIcon, CopyIcon, ExternalLinkIcon } from 'lucide-react'
import { useMemo } from 'react'
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

import PageTitle from '@/components/layout/page-title'

import {
  ExperimentRun,
  RunArtifact,
  RunMetric,
  apiExperimentRunArtifacts,
  apiExperimentRunGet,
  apiExperimentRunMetrics,
} from '@/services/api/experiment'
import { apiJobCheckpointRestore } from '@/services/api/vcjob'

import { useCopyToClipboard } from '@/hooks/use-copy-to-clipboard'

export const Route = createFileRoute('/portal/experiments/runs/$runID')({
  component: RouteComponent,
  loader: () => ({ crumb: 'Run 详情' }),
})

function RouteComponent() {
  const { runID } = Route.useParams()
  const id = Number(runID)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { data: run } = useQuery({
    queryKey: ['experiments', 'runs', id],
    queryFn: () => apiExperimentRunGet(id).then((res) => res.data),
  })
  const { data: metrics = [] } = useQuery({
    queryKey: ['experiments', 'runs', id, 'metrics'],
    queryFn: () => apiExperimentRunMetrics(id).then((res) => res.data),
  })
  const { data: artifacts = [] } = useQuery({
    queryKey: ['experiments', 'runs', id, 'artifacts'],
    queryFn: () => apiExperimentRunArtifacts(id).then((res) => res.data),
  })

  const chartData = useMemo(() => buildRunChartData(metrics), [metrics])
  const metricNames = Object.keys(chartData[0] ?? {}).filter((key) => key !== 'step')
  const checkpointArtifacts = artifacts.filter((artifact) => artifact.type === 'checkpoint')
  const reproductionInfo = useMemo(() => buildReproductionInfo(run), [run])
  const { handleCopy: copyReproductionInfo } = useCopyToClipboard({
    text: reproductionInfo,
    copyMessage: '已复制复现信息',
  })
  const restoreMutation = useMutation({
    mutationFn: (artifact: RunArtifact) => {
      const jobName = checkpointJobName(artifact)
      if (!jobName || !artifact.sourceID) {
        throw new Error('缺少 checkpoint 恢复所需的作业或 checkpoint ID')
      }
      return apiJobCheckpointRestore(jobName, artifact.sourceID, {
        name: `${artifact.name}-resume`,
      }).then((res) => res.data)
    },
    onSuccess: async (data) => {
      toast.success(`已提交恢复作业 ${data.jobName}`)
      await queryClient.invalidateQueries({ queryKey: ['job'] })
      navigate({
        to: '/portal/jobs/detail/$name',
        params: { name: data.jobName },
      })
    },
    onError: (error) => {
      toast.error(error instanceof Error ? error.message : '提交恢复作业失败')
    },
  })

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={run?.runName ?? 'Run 详情'} description={run?.jobName || '训练运行记录'}>
        {run && (
          <Button variant="outline" onClick={copyReproductionInfo}>
            <CopyIcon className="size-4" />
            复制复现信息
          </Button>
        )}
        {run?.jobName && (
          <Button asChild variant="outline">
            <Link to="/portal/jobs/detail/$name" params={{ name: run.jobName }}>
              <ExternalLinkIcon className="size-4" />
              作业详情 / 日志
            </Link>
          </Button>
        )}
      </PageTitle>

      <div className="grid gap-4 md:grid-cols-4">
        <InfoCard title="状态" value={run?.status ?? '-'} />
        <InfoCard title="Job" value={run?.jobName || '-'} mono />
        <InfoCard title="开始" value={formatDate(run?.startedAt || run?.CreatedAt)} />
        <InfoCard title="结束" value={formatDate(run?.finishedAt)} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>指标曲线</CardTitle>
        </CardHeader>
        <CardContent>
          {chartData.length === 0 ? (
            <div className="text-muted-foreground py-8 text-sm">暂无指标上报</div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="step" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {metricNames.map((name, index) => (
                    <Line
                      key={name}
                      dataKey={name}
                      type="monotone"
                      stroke={['#2563eb', '#16a34a', '#dc2626', '#9333ea'][index % 4]}
                      dot={false}
                    />
                  ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <SnapshotCard title="超参数" value={run?.hyperparams} />
        <SnapshotCard title="代码快照" value={run?.codeSnapshot} />
        <SnapshotCard title="数据快照" value={run?.dataSnapshot} />
        <SnapshotCard title="镜像快照" value={run?.imageSnapshot} />
        <SnapshotCard title="资源快照" value={run?.resourceSnapshot} />
        <SnapshotCard title="Checkpoint" value={run?.checkpointSnapshot} />
        <SnapshotCard title="标签" value={run?.tags} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Checkpoints</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>Step</TableHead>
                <TableHead>Latest</TableHead>
                <TableHead>大小</TableHead>
                <TableHead>路径</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {checkpointArtifacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-20 text-center">
                    暂无 checkpoint 记录
                  </TableCell>
                </TableRow>
              ) : (
                checkpointArtifacts.map((artifact) => (
                  <TableRow key={artifact.ID}>
                    <TableCell className="font-medium">{artifact.name}</TableCell>
                    <TableCell>{formatMetadataValue(artifact.metadata?.step)}</TableCell>
                    <TableCell>
                      {artifact.metadata?.latest ? <Badge variant="secondary">latest</Badge> : '-'}
                    </TableCell>
                    <TableCell>{formatBytes(artifact.sizeBytes)}</TableCell>
                    <TableCell className="font-mono text-xs">{artifact.path}</TableCell>
                    <TableCell>
                      <div className="flex justify-end">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={
                            restoreMutation.isPending || !canRestoreCheckpointArtifact(artifact)
                          }
                          onClick={() => restoreMutation.mutate(artifact)}
                        >
                          <ArchiveRestoreIcon className="size-4" />
                          从此恢复
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>产物</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>名称</TableHead>
                <TableHead>类型</TableHead>
                <TableHead>路径</TableHead>
                <TableHead>大小</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {artifacts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-muted-foreground h-20 text-center">
                    暂无产物记录
                  </TableCell>
                </TableRow>
              ) : (
                artifacts.map((artifact) => (
                  <TableRow key={artifact.ID}>
                    <TableCell>{artifact.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{artifact.type}</Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{artifact.path}</TableCell>
                    <TableCell>{formatBytes(artifact.sizeBytes)}</TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

function InfoCard({ title, value, mono }: { title: string; value: string; mono?: boolean }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-muted-foreground text-sm font-medium">{title}</CardTitle>
      </CardHeader>
      <CardContent className={mono ? 'font-mono text-sm' : 'text-sm'}>{value}</CardContent>
    </Card>
  )
}

function SnapshotCard({ title, value }: { title: string; value?: Record<string, unknown> }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="bg-muted max-h-72 overflow-auto rounded-md p-3 text-xs">
          {JSON.stringify(value ?? {}, null, 2)}
        </pre>
      </CardContent>
    </Card>
  )
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function formatBytes(value?: number) {
  if (!value) return '-'
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  if (value < 1024 * 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MiB`
  return `${(value / 1024 / 1024 / 1024).toFixed(1)} GiB`
}

function formatMetadataValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value)
  }
  return JSON.stringify(value)
}

function checkpointJobName(artifact: RunArtifact) {
  const value = artifact.metadata?.jobName
  return typeof value === 'string' ? value : ''
}

function canRestoreCheckpointArtifact(artifact: RunArtifact) {
  return Boolean(checkpointJobName(artifact) && artifact.sourceID)
}

function buildRunChartData(metrics: RunMetric[]) {
  const byStep = new Map<number, Record<string, number>>()
  for (const metric of metrics) {
    const row = byStep.get(metric.step) ?? { step: metric.step }
    row[metric.name] = metric.value
    byStep.set(metric.step, row)
  }
  return Array.from(byStep.values()).sort((a, b) => Number(a.step) - Number(b.step))
}

function buildReproductionInfo(run?: ExperimentRun) {
  if (!run) return ''
  return JSON.stringify(
    {
      experiment: {
        experimentId: run.experimentID,
        runName: run.runName,
        tags: run.tags ?? {},
      },
      job: {
        jobId: run.jobID,
        jobName: run.jobName,
        status: run.status,
      },
      lineage: {
        parentRunId: run.parentRunID,
        sourceCheckpointId: run.sourceCheckpointID,
      },
      snapshots: {
        hyperparams: run.hyperparams ?? {},
        code: run.codeSnapshot ?? {},
        data: run.dataSnapshot ?? {},
        image: run.imageSnapshot ?? {},
        resource: run.resourceSnapshot ?? {},
        checkpoint: run.checkpointSnapshot ?? {},
        reproduce: run.reproduceSnapshot ?? {},
      },
      createJobExperimentPayload: {
        experimentId: run.experimentID,
        runName: `${run.runName}-rerun`,
        hyperparams: run.hyperparams ?? {},
        code: run.codeSnapshot ?? {},
        data: run.dataSnapshot ?? {},
        image: run.imageSnapshot ?? {},
        tags: run.tags ?? {},
      },
    },
    null,
    2
  )
}
