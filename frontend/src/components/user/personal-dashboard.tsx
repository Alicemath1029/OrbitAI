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
import { useQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { useAtomValue } from 'jotai'
import {
  ActivityIcon,
  ArrowUpRightIcon,
  BarChart3Icon,
  CheckCircle2Icon,
  Clock3Icon,
  GpuIcon,
  ListChecksIcon,
  MonitorDotIcon,
  PlayCircleIcon,
} from 'lucide-react'
import { motion, useReducedMotion } from 'motion/react'
import { CSSProperties, ReactNode, useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

import JobPhaseLabel from '@/components/badge/job-phase-badge'
import JobTypeLabel from '@/components/badge/job-type-badge'
import TipBadge from '@/components/badge/tip-badge'
import UserRoleBadge from '@/components/badge/user-role-badge'
import { TimeDistance } from '@/components/custom/time-distance'
import { DetailPageCoreProps } from '@/components/layout/detail-page'
import GrafanaIframe from '@/components/layout/embed/grafana-iframe'
import { StatisticsDashboard } from '@/components/statistics/statistics-dashboard'

import { Role } from '@/services/api/auth'
import { apiGetUser } from '@/services/api/user'
import { IJobInfo, JobStatus, apiGetUserJobs, getJobStateType } from '@/services/api/vcjob'

import { getUserPseudonym } from '@/utils/pseudonym'
import { globalHideUsername } from '@/utils/store'
import { configGrafanaUserAtom } from '@/utils/store/config'

import { cn } from '@/lib/utils'

import { UserAvatar } from './user-avatar'
import { UserJobsOverview } from './user-jobs'

const tabKeys = ['overview', 'activity', 'jobs', 'gpu'] as const

type DashboardToneName = 'primary' | 'info' | 'cyan' | 'warning'

type DashboardTone = {
  main: string
  dark: string
  channel: string
}

const dashboardTones = {
  primary: {
    main: '#00A76F',
    dark: '#007867',
    channel: '0 167 111',
  },
  info: {
    main: '#0C68E9',
    dark: '#0055B8',
    channel: '12 104 233',
  },
  cyan: {
    main: '#00B8D9',
    dark: '#006C80',
    channel: '0 184 217',
  },
  warning: {
    main: '#FFAB00',
    dark: '#B76E00',
    channel: '255 171 0',
  },
} satisfies Record<DashboardToneName, DashboardTone>

const toneStyle = (tone: DashboardTone) =>
  ({
    '--dashboard-tone-main': tone.main,
    '--dashboard-tone-dark': tone.dark,
    '--dashboard-tone-channel': tone.channel,
  }) as CSSProperties

type PersonalDashboardTab = (typeof tabKeys)[number]

const isValidTab = (tab?: string): tab is PersonalDashboardTab =>
  tabKeys.includes(tab as PersonalDashboardTab)

export default function PersonalDashboard({
  name,
  currentTab,
  setCurrentTab,
}: DetailPageCoreProps & { name: string }) {
  const hideUsername = useAtomValue(globalHideUsername)
  const grafanaUser = useAtomValue(configGrafanaUserAtom)
  const reduceMotion = useReducedMotion() ?? false

  const { data: user, isLoading: isUserLoading } = useQuery({
    queryKey: ['user', name],
    queryFn: () => apiGetUser(name || ''),
    select: (data) => data.data,
    enabled: !!name,
  })

  const jobsQuery = useQuery({
    queryKey: ['personal-dashboard-jobs', name],
    queryFn: () => apiGetUserJobs(name, 30),
    select: (data) => data.data,
    enabled: !!name,
  })

  const jobs = useMemo(() => jobsQuery.data ?? [], [jobsQuery.data])
  const stats = useMemo(() => getJobStats(jobs), [jobs])
  const recentJobs = useMemo(() => getRecentJobs(jobs), [jobs])

  const displayName = hideUsername ? getUserPseudonym(user?.name) : user?.nickname || user?.name
  const username = hideUsername ? getUserPseudonym(user?.name) : user?.name || name
  const activeTab = isValidTab(currentTab) ? currentTab : 'overview'

  if (isUserLoading && !user) {
    return <PersonalDashboardSkeleton />
  }

  return (
    <div className="min-h-0 w-full space-y-4">
      <motion.section
        initial={reduceMotion ? false : { opacity: 0, y: 14, filter: 'blur(8px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.58, ease: [0.22, 1, 0.36, 1] }}
        whileHover={reduceMotion ? undefined : { y: -2 }}
        className="group relative min-h-[168px] overflow-hidden rounded-[24px] bg-[#071915] p-4 text-white shadow-[0_0_2px_0_rgba(0,167,111,0.18),0_24px_48px_-28px_rgba(20,26,33,0.58)] md:p-5"
        style={{
          backgroundImage: 'linear-gradient(135deg, #071915 0%, #0E2A22 58%, #06100E 100%)',
        }}
      >
        <WelcomeAmbient reduceMotion={reduceMotion} />

        <div className="relative z-10 grid min-h-[128px] items-center gap-4 md:grid-cols-[minmax(0,1fr)_360px]">
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.52, delay: 0.08, ease: [0.22, 1, 0.36, 1] }}
            className="flex min-w-0 items-center gap-4"
          >
            <UserAvatar
              user={user}
              className="size-18 shrink-0 border border-white/15 shadow-sm"
              size={72}
            />
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-white/10 bg-white/10 text-[#5BE49B] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
                >
                  个人面板
                </Badge>
                {user?.role && <UserRoleBadge role={user.role.toString()} />}
                {user?.role === Role.Admin && <TipBadge />}
              </div>
              <div className="min-w-0">
                <h1 className="truncate text-3xl font-bold tracking-normal text-white md:text-4xl">
                  {displayName || '我的工作台'}
                </h1>
                <p className="mt-1 truncate text-sm text-white/65">@{username}</p>
              </div>
            </div>
          </motion.div>

          <motion.div
            initial={reduceMotion ? false : { opacity: 0, x: 12, scale: 0.985 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={{ duration: 0.52, delay: 0.14, ease: [0.22, 1, 0.36, 1] }}
            className="grid grid-cols-3 gap-2 rounded-[18px] bg-white/[0.08] p-2 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.10)]"
          >
            <HeroInfoItem
              label="累计提交"
              value={stats.total}
              detail="近 30 天创建"
              tone="primary"
              reduceMotion={reduceMotion}
            />
            <HeroInfoItem
              label="完成占比"
              value={`${Math.round(getPercent(stats.finished, stats.total))}%`}
              detail="终态作业占比"
              tone="cyan"
              reduceMotion={reduceMotion}
              delay={0.45}
            />
            <HeroInfoItem
              label="最近提交"
              value={
                recentJobs[0]?.createdAt ? (
                  <TimeDistance date={recentJobs[0].createdAt} />
                ) : (
                  '暂无记录'
                )
              }
              detail="最近作业时间"
              tone="info"
              reduceMotion={reduceMotion}
              delay={0.9}
            />
          </motion.div>
        </div>
      </motion.section>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <MetricCard
          icon={<PlayCircleIcon className="size-4" />}
          label="运行中"
          value={stats.running}
          description="正在占用计算资源"
          footer="占近 30 天作业"
          progress={getPercent(stats.running, stats.total)}
          tone="info"
        />
        <MetricCard
          icon={<Clock3Icon className="size-4" />}
          label="排队中"
          value={stats.waiting}
          description="等待调度或资源"
          footer="调度等待占比"
          progress={getPercent(stats.waiting, stats.total)}
          tone="warning"
        />
        <MetricCard
          icon={<CheckCircle2Icon className="size-4" />}
          label="已完成"
          value={stats.finished}
          description="近 30 天终态作业"
          footer="完成与失败终态"
          progress={getPercent(stats.finished, stats.total)}
          tone="primary"
        />
        <MetricCard
          icon={<ListChecksIcon className="size-4" />}
          label="保留记录"
          value={stats.archived}
          description="已释放或删除元数据"
          footer="仅保留元数据"
          progress={getPercent(stats.archived, stats.total)}
          tone="cyan"
        />
      </div>

      <Tabs
        value={activeTab}
        onValueChange={(tab) => setCurrentTab?.(tab)}
        className="w-full gap-4"
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <TabsList className="w-full justify-start overflow-x-auto sm:w-fit">
            <TabsTrigger value="overview">
              <ActivityIcon className="size-4" />
              概览
            </TabsTrigger>
            <TabsTrigger value="activity">
              <BarChart3Icon className="size-4" />
              资源统计
            </TabsTrigger>
            <TabsTrigger value="jobs">
              <ListChecksIcon className="size-4" />
              作业记录
            </TabsTrigger>
            <TabsTrigger value="gpu">
              <GpuIcon className="size-4" />
              GPU 监控
            </TabsTrigger>
          </TabsList>
          <Button asChild variant="outline" className="h-10 w-full justify-between sm:w-auto">
            <Link to="/portal/jobs/new/jupyter-job" search={{ fromJob: '', fromTemplate: 0 }}>
              新建 Jupyter
              <ArrowUpRightIcon className="size-4" />
            </Link>
          </Button>
        </div>

        <TabsContent value="overview" className="mt-0">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
            <DashboardCard
              className="min-w-0"
              description="按创建时间展示近 30 天内最近的作业状态"
              title="最近作业"
              tone="info"
            >
              <div className="divide-border/70 divide-y">
                {jobsQuery.isLoading ? (
                  <RecentJobsSkeleton />
                ) : recentJobs.length > 0 ? (
                  recentJobs.map((job) => <RecentJobItem key={job.name} job={job} />)
                ) : (
                  <EmptyState
                    icon={<ListChecksIcon className="size-5" />}
                    title="暂无作业记录"
                    description="提交交互式或批处理作业后，这里会显示最近状态。"
                  />
                )}
              </div>
            </DashboardCard>

            <div className="grid content-start gap-4">
              <DashboardCard
                description="快速进入个人资源统计、作业记录和 GPU 监控"
                title="资源视图"
                tone="cyan"
              >
                <div className="grid gap-2">
                  <QuickAction
                    icon={<BarChart3Icon className="size-4" />}
                    title="资源统计"
                    description="查看 CPU、内存、GPU 使用趋势"
                    onClick={() => setCurrentTab?.('activity')}
                    tone="cyan"
                  />
                  <QuickAction
                    icon={<ListChecksIcon className="size-4" />}
                    title="作业记录"
                    description="查看个人作业提交与状态"
                    onClick={() => setCurrentTab?.('jobs')}
                    tone="primary"
                  />
                  <QuickAction
                    icon={<MonitorDotIcon className="size-4" />}
                    title="GPU 监控"
                    description="打开 Grafana 用户维度监控"
                    onClick={() => setCurrentTab?.('gpu')}
                    tone="info"
                  />
                </div>
              </DashboardCard>

              <DashboardCard description="当前账户归属与基础配置" title="账户信息" tone="primary">
                <div className="grid gap-3">
                  <InfoRow label="账号标识" value={`@${username}`} />
                  <InfoRow label="账号角色" value={getRoleLabel(user?.role)} />
                  <InfoRow label="所属组织" value={getOrganizationLabel(user?.group)} />
                  <InfoRow label="创建时间" value={<TimeDistance date={user?.createdAt} />} />
                </div>
              </DashboardCard>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="activity" className="mt-0">
          <StatisticsDashboard scope="user" targetID={user?.id} enabled={!!user?.id} />
        </TabsContent>

        <TabsContent value="jobs" className="mt-0">
          <UserJobsOverview username={name} />
        </TabsContent>

        <TabsContent value="gpu" className="mt-0">
          <div
            className="bg-card relative h-[720px] overflow-hidden rounded-[20px] border border-[rgba(145,158,171,0.12)] shadow-[0_0_2px_0_rgba(145,158,171,0.16),0_18px_36px_-24px_rgba(20,26,33,0.24)]"
            style={toneStyle(dashboardTones.info)}
          >
            <div className="pointer-events-none absolute inset-0 z-10 bg-[linear-gradient(135deg,rgba(var(--dashboard-tone-channel),0.08),transparent_48%)]" />
            <GrafanaIframe baseSrc={`${grafanaUser.nvidia}?var-user=${user?.name}`} />
          </div>
        </TabsContent>
      </Tabs>
    </div>
  )
}

function getJobStats(jobs: IJobInfo[]) {
  return jobs.reduce(
    (acc, job) => {
      const state = getJobStateType(job.status)

      acc.total += 1
      if (state === JobStatus.Running) {
        acc.running += 1
      } else if (state === JobStatus.NotStarted) {
        acc.waiting += 1
      } else if (state === JobStatus.Terminated) {
        acc.finished += 1
      } else if (state === JobStatus.MetadataOnly) {
        acc.archived += 1
      }

      return acc
    },
    { total: 0, running: 0, waiting: 0, finished: 0, archived: 0 }
  )
}

function getRecentJobs(jobs: IJobInfo[]) {
  return [...jobs]
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 5)
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }

  return Math.max(0, Math.min(100, value))
}

function getPercent(value: number, total: number) {
  if (total <= 0) {
    return 0
  }

  return clampPercent((value / total) * 100)
}

function getRoleLabel(role?: Role) {
  if (role === Role.Admin) {
    return '管理员'
  }

  if (role === Role.User) {
    return '成员'
  }

  if (role === Role.Guest) {
    return '访客'
  }

  return '未设置'
}

function getOrganizationLabel(group?: string) {
  const normalizedGroup = group?.trim()

  if (!normalizedGroup || ['管理员', '用户', '成员', '访客'].includes(normalizedGroup)) {
    return '未配置'
  }

  return normalizedGroup
}

function DashboardCard({
  title,
  description,
  tone,
  className,
  children,
}: {
  title: string
  description: string
  tone: DashboardToneName
  className?: string
  children: ReactNode
}) {
  return (
    <section
      className={cn(
        'group bg-card relative overflow-hidden rounded-[20px] border border-[rgba(145,158,171,0.12)] p-4 shadow-[0_0_2px_0_rgba(145,158,171,0.16),0_18px_36px_-24px_rgba(20,26,33,0.24)] transition-[border-color,box-shadow] hover:border-[rgb(var(--dashboard-tone-channel)/0.24)] hover:shadow-[0_0_2px_0_rgb(var(--dashboard-tone-channel)/0.14),0_22px_42px_-26px_rgba(20,26,33,0.32)] md:p-5',
        className
      )}
      style={toneStyle(dashboardTones[tone])}
    >
      <div className="pointer-events-none absolute inset-0 z-0 bg-[linear-gradient(135deg,rgb(var(--dashboard-tone-channel)/0.12),transparent_48%)]" />
      <div className="pointer-events-none absolute top-0 -left-[46%] z-0 h-full w-[38%] -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.24),transparent)] opacity-0 transition-[left,opacity] duration-700 group-hover:left-[112%] group-hover:opacity-100" />

      <div className="relative z-10 space-y-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-foreground truncate text-sm font-bold">{title}</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-6">{description}</p>
          </div>
          <span className="mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--dashboard-tone-channel)/0.12)] text-[var(--dashboard-tone-dark)] shadow-[inset_0_0_0_1px_rgb(var(--dashboard-tone-channel)/0.14)]">
            <ActivityIcon className="size-4" />
          </span>
        </div>
        {children}
      </div>
    </section>
  )
}

function WelcomeAmbient({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(0,167,111,0.30),transparent_34%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(115deg,transparent_0%,rgba(255,255,255,0.10)_48%,transparent_68%)]" />
      <div className="absolute inset-0 [background-image:linear-gradient(rgba(255,255,255,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.10)_1px,transparent_1px)] [mask-image:linear-gradient(90deg,transparent,black_20%,black_78%,transparent)] [background-size:28px_28px] opacity-[0.16]" />

      <motion.div
        className="absolute -top-24 -left-[34%] h-[230%] w-[32%] rotate-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.24),transparent)]"
        animate={reduceMotion ? undefined : { x: ['0%', '430%'], opacity: [0, 0.5, 0.18, 0] }}
        transition={{ duration: 8.2, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="absolute top-1/2 left-[32%] hidden size-40 -translate-y-1/2 md:block lg:left-[38%] lg:size-44 xl:left-[41%] xl:size-48">
        <motion.div
          className="absolute inset-1 rounded-full border border-white/12"
          style={{ scaleY: 0.46 }}
          animate={reduceMotion ? undefined : { rotate: 360 }}
          transition={{ duration: 28, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute inset-8 rounded-full border border-[#5BE49B]/24"
          style={{ scaleX: 0.56 }}
          animate={reduceMotion ? undefined : { rotate: -360 }}
          transition={{ duration: 22, repeat: Infinity, ease: 'linear' }}
        />
        <motion.div
          className="absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[#00A76F]/16 shadow-[0_0_36px_rgba(0,167,111,0.46),inset_0_0_0_1px_rgba(91,228,155,0.18)]"
          animate={reduceMotion ? undefined : { scale: [1, 1.16, 1], opacity: [0.58, 0.9, 0.58] }}
          transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="absolute top-9 right-9 size-2.5 rounded-full bg-[#5BE49B] shadow-[0_0_18px_rgba(91,228,155,0.9)]"
          animate={reduceMotion ? undefined : { scale: [1, 1.55, 1], opacity: [0.55, 1, 0.55] }}
          transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
        />
        <motion.span
          className="absolute bottom-11 left-10 size-2 rounded-full bg-[#00B8D9] shadow-[0_0_18px_rgba(0,184,217,0.8)]"
          animate={
            reduceMotion ? undefined : { scale: [1.35, 1, 1.35], opacity: [0.95, 0.45, 0.95] }
          }
          transition={{ duration: 2.9, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>

      <div className="absolute right-8 bottom-5 hidden h-12 w-56 md:block">
        {[0, 1, 2].map((index) => (
          <motion.span
            key={index}
            className="absolute left-0 h-px rounded-full bg-[linear-gradient(90deg,transparent,rgba(91,228,155,0.68),transparent)]"
            style={{
              top: index * 16,
              width: `${58 + index * 13}%`,
              transformOrigin: 'left',
            }}
            animate={
              reduceMotion ? undefined : { scaleX: [0.3, 1, 0.3], opacity: [0.12, 0.72, 0.12] }
            }
            transition={{
              duration: 3.2,
              repeat: Infinity,
              ease: 'easeInOut',
              delay: index * 0.48,
            }}
          />
        ))}
      </div>
    </div>
  )
}

function HeroInfoItem({
  label,
  value,
  detail,
  tone,
  reduceMotion,
  delay = 0,
}: {
  label: string
  value: ReactNode
  detail: string
  tone: DashboardToneName
  reduceMotion: boolean
  delay?: number
}) {
  return (
    <div
      className="flex min-h-28 flex-col justify-between rounded-[14px] bg-white/[0.10] p-3 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.08)]"
      style={toneStyle(dashboardTones[tone])}
    >
      <span className="text-xs font-semibold text-white/58">{label}</span>
      <div>
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay, ease: [0.22, 1, 0.36, 1] }}
          className="truncate text-xl leading-tight font-bold tracking-normal text-[var(--dashboard-tone-main)]"
        >
          {value}
        </motion.div>
        <p className="mt-1 truncate text-xs font-semibold text-white/45">{detail}</p>
        <div className="mt-3 h-1 overflow-hidden rounded-full bg-white/[0.10]">
          <motion.div
            className="h-full w-1/2 rounded-full bg-[var(--dashboard-tone-main)] shadow-[0_0_14px_var(--dashboard-tone-main)]"
            initial={reduceMotion ? false : { x: '-110%' }}
            animate={reduceMotion ? { x: 0 } : { x: ['-110%', '180%'] }}
            transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut', delay }}
          />
        </div>
      </div>
    </div>
  )
}

function MetricCard({
  icon,
  label,
  value,
  description,
  footer,
  progress,
  tone,
}: {
  icon: ReactNode
  label: string
  value: number
  description: string
  footer: string
  progress: number
  tone: DashboardToneName
}) {
  const progressValue = clampPercent(progress)

  return (
    <div
      className="group bg-card relative min-h-[188px] overflow-hidden rounded-[20px] border border-[rgba(145,158,171,0.12)] p-5 shadow-[0_0_2px_0_rgba(145,158,171,0.16),0_12px_24px_-12px_rgba(20,26,33,0.18)] transition-[transform,border-color,box-shadow] hover:-translate-y-1.5 hover:border-[rgb(var(--dashboard-tone-channel)/0.28)] hover:shadow-[0_0_2px_0_rgb(var(--dashboard-tone-channel)/0.18),0_24px_44px_-24px_rgba(20,26,33,0.36)]"
      style={toneStyle(dashboardTones[tone])}
    >
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(135deg,rgb(var(--dashboard-tone-channel)/0.18)_0%,rgb(var(--dashboard-tone-channel)/0.05)_42%,transparent_72%)]" />
      <div className="pointer-events-none absolute top-0 -left-[46%] h-full w-[38%] -skew-x-12 bg-[linear-gradient(90deg,transparent,rgba(255,255,255,0.28),transparent)] opacity-0 transition-[left,opacity] duration-700 group-hover:left-[112%] group-hover:opacity-100" />

      <div className="relative z-10 grid h-full min-h-[148px] grid-cols-[44px_minmax(0,1fr)] gap-4">
        <div className="flex flex-col items-center gap-3">
          <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,rgb(var(--dashboard-tone-channel)/0.18),rgb(var(--dashboard-tone-channel)/0.08))] text-[var(--dashboard-tone-dark)] shadow-[inset_0_0_0_1px_rgb(var(--dashboard-tone-channel)/0.16)]">
            {icon}
          </span>
          <span className="min-h-6 w-px flex-1 bg-[linear-gradient(180deg,rgb(var(--dashboard-tone-channel)/0.34),transparent)]" />
        </div>

        <div className="flex min-w-0 flex-col justify-between gap-4">
          <div className="min-w-0">
            <div className="min-w-0">
              <p className="text-foreground truncate text-sm font-bold">{label}</p>
              <p className="text-muted-foreground mt-1 truncate text-xs leading-5">{description}</p>
            </div>

            <div className="mt-5 flex min-w-0 items-end justify-between gap-3">
              <p className="text-foreground text-4xl leading-none font-bold tracking-normal">
                {value}
              </p>
              <span className="mb-1 shrink-0 rounded-full bg-[rgb(var(--dashboard-tone-channel)/0.10)] px-2.5 py-1 text-xs font-bold text-[var(--dashboard-tone-dark)] shadow-[inset_0_0_0_1px_rgb(var(--dashboard-tone-channel)/0.12)]">
                {Math.round(progressValue)}%
              </span>
            </div>
          </div>

          <div className="space-y-2">
            <div className="h-[7px] overflow-hidden rounded-full bg-[rgb(var(--dashboard-tone-channel)/0.16)] shadow-[inset_0_0_0_1px_rgb(var(--dashboard-tone-channel)/0.08)]">
              <div
                className="h-full rounded-full bg-[var(--dashboard-tone-main)]"
                style={{ width: `${progressValue}%` }}
              />
            </div>
            <p className="text-muted-foreground truncate text-xs">{footer}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

function RecentJobItem({ job }: { job: IJobInfo }) {
  return (
    <div className="hover:bg-muted/35 -mx-2 grid gap-3 rounded-md px-2 py-3 transition-colors md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0 space-y-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <JobTypeLabel jobType={job.jobType} />
          <JobPhaseLabel jobPhase={job.status} />
          <span className="truncate text-sm font-semibold">{job.name || job.jobName}</span>
        </div>
        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span>队列：{job.queue || '未分配'}</span>
          <span>节点：{job.nodes?.length || 0}</span>
          <span>
            创建：
            <TimeDistance date={job.createdAt} />
          </span>
        </div>
      </div>
      <Button asChild variant="ghost" size="sm" className="justify-start md:justify-center">
        <Link to="/portal/jobs/detail/$name" params={{ name: job.name }}>
          查看详情
          <ArrowUpRightIcon className="size-4" />
        </Link>
      </Button>
    </div>
  )
}

function QuickAction({
  icon,
  title,
  description,
  onClick,
  tone,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
  tone: DashboardToneName
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group/action bg-background/70 relative z-10 grid w-full grid-cols-[36px_minmax(0,1fr)_16px] items-center gap-3 rounded-[14px] border border-[rgba(145,158,171,0.12)] p-3 text-left shadow-[0_0_2px_0_rgba(145,158,171,0.12),0_10px_20px_-18px_rgba(20,26,33,0.20)] transition-[border-color,background-color] hover:border-[rgb(var(--dashboard-tone-channel)/0.26)] hover:bg-[rgb(var(--dashboard-tone-channel)/0.06)]"
      style={toneStyle(dashboardTones[tone])}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[rgb(var(--dashboard-tone-channel)/0.12)] text-[var(--dashboard-tone-dark)] shadow-[inset_0_0_0_1px_rgb(var(--dashboard-tone-channel)/0.14)]">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-semibold">{title}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">{description}</span>
      </span>
      <ArrowUpRightIcon className="text-muted-foreground size-4 shrink-0 transition-transform group-hover/action:translate-x-0.5 group-hover/action:-translate-y-0.5 group-hover/action:text-[var(--dashboard-tone-dark)]" />
    </button>
  )
}

function InfoRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="bg-muted/30 flex min-w-0 items-center justify-between gap-3 rounded-[12px] px-3 py-2">
      <span className="text-muted-foreground text-sm">{label}</span>
      <span className="min-w-0 truncate text-right text-sm font-semibold">{value}</span>
    </div>
  )
}

function EmptyState({
  icon,
  title,
  description,
}: {
  icon: ReactNode
  title: string
  description: string
}) {
  return (
    <div className="border-border/70 bg-muted/25 flex min-h-48 flex-col items-center justify-center rounded-lg border border-dashed px-4 text-center">
      <span className="bg-background text-muted-foreground mb-3 flex size-10 items-center justify-center rounded-md">
        {icon}
      </span>
      <p className="text-sm font-semibold">{title}</p>
      <p className="text-muted-foreground mt-1 max-w-sm text-sm leading-6">{description}</p>
    </div>
  )
}

function RecentJobsSkeleton() {
  return (
    <>
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="space-y-2 py-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ))}
    </>
  )
}

function PersonalDashboardSkeleton() {
  return (
    <div className="space-y-4">
      <Skeleton className="h-48 w-full" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <Skeleton key={index} className="h-32 w-full" />
        ))}
      </div>
      <Skeleton className="h-96 w-full" />
    </div>
  )
}
