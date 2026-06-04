import { useQuery } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'
import { useMemo, useState } from 'react'
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
import { Checkbox } from '@/components/ui/checkbox'
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
  RunMetric,
  apiExperimentGet,
  apiExperimentRunMetrics,
  apiExperimentRuns,
} from '@/services/api/experiment'

export const Route = createFileRoute('/portal/experiments/$id')({
  component: RouteComponent,
  loader: () => ({ crumb: '实验详情' }),
})

const palette = ['#2563eb', '#16a34a', '#dc2626', '#9333ea', '#ea580c', '#0891b2']
const compareMetricQuery = {
  limit: 5000,
  downsample: 800,
}

function RouteComponent() {
  const { id } = Route.useParams()
  const experimentID = Number(id)
  const [selectedRunIDs, setSelectedRunIDs] = useState<number[]>([])

  const { data: experiment } = useQuery({
    queryKey: ['experiments', experimentID],
    queryFn: () => apiExperimentGet(experimentID).then((res) => res.data),
  })
  const { data: runs = [] } = useQuery({
    queryKey: ['experiments', experimentID, 'runs'],
    queryFn: () => apiExperimentRuns(experimentID).then((res) => res.data),
  })

  const selectedRuns = runs.filter((run) => selectedRunIDs.includes(run.ID)).slice(0, 6)
  const { data: selectedMetrics = [] } = useQuery({
    queryKey: ['experiments', 'compare-metrics', selectedRunIDs],
    queryFn: async () => {
      const groups = await Promise.all(
        selectedRuns.map(async (run) => ({
          run,
          metrics: await apiExperimentRunMetrics(run.ID, compareMetricQuery).then(
            (res) => res.data
          ),
        }))
      )
      return groups
    },
    enabled: selectedRuns.length > 0,
  })

  const chartData = useMemo(() => buildCompareChartData(selectedMetrics), [selectedMetrics])
  const hyperparamRows = useMemo(() => buildHyperparamDiffRows(selectedRuns), [selectedRuns])

  const toggleRun = (runID: number) => {
    setSelectedRunIDs((current) =>
      current.includes(runID)
        ? current.filter((id) => id !== runID)
        : current.length >= 6
          ? current
          : [...current, runID]
    )
  }

  return (
    <div className="flex flex-col gap-6">
      <PageTitle
        title={experiment?.name ?? '实验详情'}
        description={experiment?.description || '查看 Run、指标曲线、超参数和复现入口'}
      />

      <Card>
        <CardHeader>
          <CardTitle>Run 对比</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {selectedRuns.length === 0 ? (
            <div className="text-muted-foreground text-sm">勾选下方 Run 后展示指标曲线。</div>
          ) : chartData.length === 0 ? (
            <div className="text-muted-foreground text-sm">所选 Run 暂无指标。</div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="step" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  {Object.keys(chartData[0] ?? {})
                    .filter((key) => key !== 'step')
                    .map((key, index) => (
                      <Line
                        key={key}
                        type="monotone"
                        dataKey={key}
                        stroke={palette[index % palette.length]}
                        dot={false}
                      />
                    ))}
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>超参数差异</CardTitle>
        </CardHeader>
        <CardContent>
          {selectedRuns.length === 0 ? (
            <div className="text-muted-foreground text-sm">勾选下方 Run 后展示超参数差异。</div>
          ) : hyperparamRows.length === 0 ? (
            <div className="text-muted-foreground text-sm">所选 Run 暂无超参数记录。</div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="min-w-40">参数</TableHead>
                    {selectedRuns.map((run) => (
                      <TableHead key={run.ID} className="min-w-44">
                        <Link
                          to="/portal/experiments/runs/$runID"
                          params={{ runID: String(run.ID) }}
                          className="hover:text-primary block max-w-48 truncate"
                        >
                          {run.runName}
                        </Link>
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {hyperparamRows.map((row) => (
                    <TableRow key={row.key}>
                      <TableCell className="font-mono text-xs">
                        <div className="flex items-center gap-2">
                          {row.key}
                          {row.isDifferent && <Badge variant="secondary">不同</Badge>}
                        </div>
                      </TableCell>
                      {row.values.map((value, index) => (
                        <TableCell
                          key={`${row.key}-${selectedRuns[index]?.ID}`}
                          className={
                            row.isDifferent ? 'bg-primary/5 font-mono text-xs' : 'font-mono text-xs'
                          }
                        >
                          {value}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Runs</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10" />
                <TableHead>名称</TableHead>
                <TableHead>状态</TableHead>
                <TableHead>作业</TableHead>
                <TableHead>开始时间</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {runs.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-muted-foreground h-20 text-center">
                    暂无 Run
                  </TableCell>
                </TableRow>
              ) : (
                runs.map((run) => (
                  <TableRow key={run.ID}>
                    <TableCell>
                      <Checkbox
                        checked={selectedRunIDs.includes(run.ID)}
                        onCheckedChange={() => toggleRun(run.ID)}
                      />
                    </TableCell>
                    <TableCell className="font-medium">{run.runName}</TableCell>
                    <TableCell>
                      <RunStatusBadge status={run.status} />
                    </TableCell>
                    <TableCell className="font-mono text-xs">{run.jobName || '-'}</TableCell>
                    <TableCell>{formatDate(run.startedAt || run.CreatedAt)}</TableCell>
                    <TableCell className="text-right">
                      <Button variant="outline" size="sm" asChild>
                        <Link
                          to="/portal/experiments/runs/$runID"
                          params={{ runID: String(run.ID) }}
                        >
                          查看
                        </Link>
                      </Button>
                    </TableCell>
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

function RunStatusBadge({ status }: { status: ExperimentRun['status'] }) {
  const variant =
    status === 'succeeded' ? 'default' : status === 'failed' ? 'destructive' : 'secondary'
  return <Badge variant={variant}>{status}</Badge>
}

function formatDate(value?: string) {
  if (!value) return '-'
  return new Date(value).toLocaleString()
}

function buildCompareChartData(groups: { run: ExperimentRun; metrics: RunMetric[] }[]) {
  const byStep = new Map<number, Record<string, number>>()
  for (const group of groups) {
    for (const metric of group.metrics) {
      const row = byStep.get(metric.step) ?? { step: metric.step }
      row[`${group.run.runName}:${metric.name}`] = metric.value
      byStep.set(metric.step, row)
    }
  }
  return Array.from(byStep.values()).sort((a, b) => Number(a.step) - Number(b.step))
}

function buildHyperparamDiffRows(runs: ExperimentRun[]) {
  const keys = Array.from(new Set(runs.flatMap((run) => Object.keys(run.hyperparams ?? {})))).sort()
  return keys.map((key) => {
    const values = runs.map((run) => formatParamValue(run.hyperparams?.[key]))
    return {
      key,
      values,
      isDifferent: new Set(values).size > 1,
    }
  })
}

function formatParamValue(value: unknown) {
  if (value === undefined || value === null || value === '') return '-'
  if (typeof value === 'string') return value
  return JSON.stringify(value)
}
