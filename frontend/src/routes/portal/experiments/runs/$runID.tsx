import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { ExternalLinkIcon } from 'lucide-react'
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
  RunMetric,
  apiExperimentRunArtifacts,
  apiExperimentRunGet,
  apiExperimentRunMetrics,
} from '@/services/api/experiment'

export const Route = createFileRoute('/portal/experiments/runs/$runID')({
  component: RouteComponent,
  loader: () => ({ crumb: 'Run 详情' }),
})

function RouteComponent() {
  const { runID } = Route.useParams()
  const id = Number(runID)
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

  return (
    <div className="flex flex-col gap-6">
      <PageTitle title={run?.runName ?? 'Run 详情'} description={run?.jobName || '训练运行记录'}>
        {run?.jobName && (
          <Button asChild variant="outline">
            <Link to="/portal/jobs/detail/$name" params={{ name: run.jobName }}>
              <ExternalLinkIcon className="size-4" />
              作业详情
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
        <SnapshotCard title="镜像快照" value={run?.imageSnapshot} />
        <SnapshotCard title="Checkpoint" value={run?.checkpointSnapshot} />
      </div>

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
                    <TableCell>{artifact.sizeBytes || '-'}</TableCell>
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

function buildRunChartData(metrics: RunMetric[]) {
  const byStep = new Map<number, Record<string, number>>()
  for (const metric of metrics) {
    const row = byStep.get(metric.step) ?? { step: metric.step }
    row[metric.name] = metric.value
    byStep.set(metric.step, row)
  }
  return Array.from(byStep.values()).sort((a, b) => Number(a.step) - Number(b.step))
}
