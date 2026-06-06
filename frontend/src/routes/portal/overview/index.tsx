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
import Box from '@mui/material/Box'
import Card from '@mui/material/Card'
import LinearProgress from '@mui/material/LinearProgress'
import Stack from '@mui/material/Stack'
import Typography from '@mui/material/Typography'
import { useTheme as useMuiTheme } from '@mui/material/styles'
import { UseQueryResult, useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'
import { ColumnDef } from '@tanstack/react-table'
import { type Locale, enUS, ja, ko, zhCN } from 'date-fns/locale'
import { useAtomValue } from 'jotai'
import {
  ActivityIcon,
  BellRingIcon,
  ClockIcon,
  FlaskConicalIcon,
  GpuIcon,
  type LucideIcon,
  RocketIcon,
  UsersRoundIcon,
} from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import {
  AnimatePresence,
  motion,
  useMotionValue,
  useMotionValueEvent,
  useReducedMotion,
  useSpring,
} from 'motion/react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import JobPhaseLabel, { getJobPhaseLabel, jobPhases } from '@/components/badge/job-phase-badge'
import JobTypeLabel, { jobTypes } from '@/components/badge/job-type-badge'
import NodeBadges from '@/components/badge/node-badges'
import ResourceBadges from '@/components/badge/resource-badges'
import ScheduleTypeLabel from '@/components/badge/schedule-type-badge'
import DocsButton from '@/components/button/docs-button'
import NivoPie from '@/components/chart/nivo-pie'
import PieCard from '@/components/chart/pie-card'
import { BillingPointsBadge } from '@/components/custom/billing-points-badge'
import { BillingSummaryCards } from '@/components/custom/billing-summary-cards'
import { TimeDistance } from '@/components/custom/time-distance'
import ListedNewJobButton from '@/components/job/new-job-button'
import { getHeader } from '@/components/job/overview/admin-jobs'
import { scheduleTypes } from '@/components/job/statuses'
import UserLabel from '@/components/label/user-label'
import { useAccountNameLookup } from '@/components/node/getaccountnickname'
import { getNodeColumns, nodesToolbarConfig } from '@/components/node/node-list'
import { DataTable } from '@/components/query-table'
import { DataTableColumnHeader } from '@/components/query-table/column-header'
import { DataTableToolbarConfig } from '@/components/query-table/toolbar'

import { apiJobAllBillingList } from '@/services/api/billing'
import { apiContextBillingSummary } from '@/services/api/context'
import { apiGetBillingStatus } from '@/services/api/system-config'
import {
  IJobInfo,
  JobPhase,
  JobType,
  ScheduleType,
  apiJobAllList,
  getUnifiedJobPhase,
} from '@/services/api/vcjob'
import { queryNodes } from '@/services/query/node'
import { queryResources } from '@/services/query/resource'

import { isBillingVisibleForUser } from '@/utils/billing-visibility'
import { getUserPseudonym } from '@/utils/pseudonym'
import { atomUserInfo, globalHideUsername } from '@/utils/store'

import { REFETCH_INTERVAL } from '@/lib/constants'

export const Route = createFileRoute('/portal/overview/')({
  component: Overview,
})

const toolbarConfig: DataTableToolbarConfig = {
  filterInput: {
    placeholder: '搜索用户名称',
    key: 'owner',
  },
  filterOptions: [
    {
      key: 'jobType',
      title: '类型',
      option: jobTypes,
    },
    {
      key: 'scheduleType',
      title: getHeader('scheduleType'),
      option: scheduleTypes,
    },
    {
      key: 'status',
      title: '状态',
      option: jobPhases,
      defaultValues: ['Running', 'Pending', 'Prequeue'],
    },
  ],
  getHeader: getHeader,
}

type JobTableRow = IJobInfo & { billedPointsTotal?: number }

type OverviewMetricTone = {
  main: string
  dark: string
  channel: string
}

type OverviewMetricItem = {
  title: string
  description: string
  value: ReactNode
  icon: LucideIcon
  tone: OverviewMetricTone
  progress: number
  progressLabel: string
  footer: string
}

type OverviewUpdateItem = {
  eyebrow: string
  title: string
  description: string
  meta: string
  icon: LucideIcon
  tone: OverviewMetricTone
}

type AnimatedMetricValueConfig = {
  value: number
  suffix: string
  decimals: number
}

const overviewMetricTones = {
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
} satisfies Record<string, OverviewMetricTone>

const overviewEnterTransition = {
  duration: 0.64,
  ease: [0.22, 1, 0.36, 1],
} as const

const overviewSpringTransition = {
  type: 'spring',
  stiffness: 150,
  damping: 22,
  mass: 0.9,
} as const

function clampPercent(value: number) {
  if (!Number.isFinite(value)) {
    return 0
  }
  return Math.max(0, Math.min(100, value))
}

function getAnimatedMetricValueConfig(value: ReactNode): AnimatedMetricValueConfig | null {
  if (typeof value === 'number') {
    return {
      value,
      suffix: '',
      decimals: Number.isInteger(value) ? 0 : 1,
    }
  }

  if (typeof value !== 'string') {
    return null
  }

  const match = value.match(/^(-?\d+(?:\.\d+)?)(.*)$/)
  if (!match) {
    return null
  }

  const parsedValue = Number(match[1])
  if (!Number.isFinite(parsedValue)) {
    return null
  }

  return {
    value: parsedValue,
    suffix: match[2] ?? '',
    decimals: match[2] === '%' ? 0 : 1,
  }
}

function formatAnimatedMetricValue(value: number, config: AnimatedMetricValueConfig) {
  const safeValue = Number.isFinite(value) ? value : 0
  const formatted =
    config.decimals > 0 ? safeValue.toFixed(config.decimals) : Math.round(safeValue).toString()

  return `${formatted}${config.suffix}`
}

function AnimatedMetricValue({ value }: { value: ReactNode }) {
  const reduceMotion = useReducedMotion()
  const config = useMemo(() => getAnimatedMetricValueConfig(value), [value])
  const targetValue = config?.value ?? 0
  const rawValue = useMotionValue(reduceMotion ? targetValue : 0)
  const smoothValue = useSpring(rawValue, {
    stiffness: 92,
    damping: 20,
    mass: 0.82,
  })
  const [displayValue, setDisplayValue] = useState<ReactNode>(() => {
    if (!config) {
      return value ?? 0
    }

    return formatAnimatedMetricValue(reduceMotion ? targetValue : 0, config)
  })

  useEffect(() => {
    if (!config) {
      setDisplayValue(value ?? 0)
      return
    }

    rawValue.set(targetValue)

    if (reduceMotion) {
      setDisplayValue(formatAnimatedMetricValue(targetValue, config))
    }
  }, [config, rawValue, reduceMotion, targetValue, value])

  useMotionValueEvent(smoothValue, 'change', (latestValue) => {
    if (!config || reduceMotion) {
      return
    }

    setDisplayValue(formatAnimatedMetricValue(latestValue, config))
  })

  if (!config) {
    return <>{value ?? 0}</>
  }

  return (
    <Box component="span" sx={{ fontVariantNumeric: 'tabular-nums' }}>
      {reduceMotion ? formatAnimatedMetricValue(targetValue, config) : displayValue}
    </Box>
  )
}

function AnimatedLinearProgress({
  ariaLabel,
  height = 7,
  sx,
  ring = true,
  tone,
  value,
}: {
  ariaLabel: string
  height?: number
  sx?: object
  ring?: boolean
  tone: OverviewMetricTone
  value: number
}) {
  const theme = useMuiTheme()
  const reduceMotion = useReducedMotion()
  const targetValue = clampPercent(value)
  const rawValue = useMotionValue(reduceMotion ? targetValue : 0)
  const smoothValue = useSpring(rawValue, {
    stiffness: 118,
    damping: 24,
    mass: 0.9,
  })
  const [displayValue, setDisplayValue] = useState(reduceMotion ? targetValue : 0)

  useEffect(() => {
    rawValue.set(targetValue)

    if (reduceMotion) {
      setDisplayValue(targetValue)
    }
  }, [rawValue, reduceMotion, targetValue])

  useMotionValueEvent(smoothValue, 'change', (latestValue) => {
    if (reduceMotion) {
      return
    }

    setDisplayValue(clampPercent(latestValue))
  })

  return (
    <LinearProgress
      aria-label={ariaLabel}
      variant="determinate"
      value={reduceMotion ? targetValue : displayValue}
      sx={{
        ...sx,
        height,
        borderRadius: 999,
        bgcolor: varAlpha(tone.channel, 0.16),
        boxShadow: ring ? `inset 0 0 0 1px ${varAlpha(tone.channel, 0.08)}` : 'none',
        '& .MuiLinearProgress-bar': {
          borderRadius: 999,
          bgcolor: tone.main,
          transition: theme.transitions.create('transform', {
            duration: theme.transitions.duration.complex,
          }),
        },
      }}
    />
  )
}

function OverviewMetricCards({ items }: { items: OverviewMetricItem[] }) {
  const reduceMotion = useReducedMotion()

  return (
    <Box
      className="lg:col-span-2"
      sx={{
        display: 'grid',
        gridTemplateColumns: {
          xs: '1fr',
          sm: 'repeat(2, minmax(0, 1fr))',
          xl: 'repeat(4, minmax(0, 1fr))',
        },
        gap: 2,
      }}
    >
      {items.map((item, index) => (
        <motion.div
          key={item.title}
          initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.985, filter: 'blur(8px)' }}
          animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
          transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : 0.08 + index * 0.07 }}
          style={{ minWidth: 0, height: '100%' }}
        >
          <OverviewMetricCard item={item} />
        </motion.div>
      ))}
    </Box>
  )
}

function AnimatedOverviewSection({
  children,
  delay = 0,
  className,
}: {
  children: ReactNode
  delay?: number
  className?: string
}) {
  const reduceMotion = useReducedMotion()

  return (
    <motion.div
      className={className}
      initial={reduceMotion ? false : { opacity: 0, y: 18, scale: 0.99, filter: 'blur(8px)' }}
      animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
      transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : delay }}
      style={{ minWidth: 0 }}
    >
      {children}
    </motion.div>
  )
}

function OverviewMetricCard({ item }: { item: OverviewMetricItem }) {
  const theme = useMuiTheme()
  const reduceMotion = useReducedMotion()
  const progress = clampPercent(item.progress)
  const Icon = item.icon

  return (
    <motion.div
      whileHover={
        reduceMotion
          ? undefined
          : {
              y: -7,
              scale: 1.012,
            }
      }
      whileTap={reduceMotion ? undefined : { scale: 0.992 }}
      transition={overviewSpringTransition}
      style={{ height: '100%' }}
    >
      <Card
        sx={{
          p: { xs: 2.25, md: 2.5 },
          height: 1,
          minHeight: 176,
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          borderRadius: 2.5,
          border: `1px solid ${varAlpha('145 158 171', 0.12)}`,
          bgcolor: 'background.paper',
          boxShadow: `0 0 2px 0 ${varAlpha('145 158 171', 0.16)}, 0 12px 24px -12px ${varAlpha(
            '20 26 33',
            0.18
          )}`,
          transition: theme.transitions.create(['border-color', 'box-shadow'], {
            duration: theme.transitions.duration.shorter,
          }),
          '&::before': {
            position: 'absolute',
            inset: 0,
            content: '""',
            background: `linear-gradient(135deg, ${varAlpha(
              item.tone.channel,
              0.18
            )} 0%, ${varAlpha(item.tone.channel, 0.05)} 42%, transparent 72%)`,
            pointerEvents: 'none',
          },
          '&::after': {
            position: 'absolute',
            top: 0,
            bottom: 0,
            left: '-46%',
            width: '38%',
            content: '""',
            opacity: 0,
            transform: 'skewX(-18deg)',
            pointerEvents: 'none',
            background: `linear-gradient(90deg, transparent, ${varAlpha(
              '255 255 255',
              0.28
            )}, transparent)`,
          },
          '&:hover': {
            borderColor: varAlpha(item.tone.channel, 0.28),
            boxShadow: `0 0 2px 0 ${varAlpha(item.tone.channel, 0.18)}, 0 24px 44px -24px ${varAlpha(
              '20 26 33',
              0.36
            )}`,
          },
          '&:hover::after': {
            left: '112%',
            opacity: 1,
            transition: theme.transitions.create(['left', 'opacity'], {
              duration: theme.transitions.duration.complex,
            }),
          },
        }}
      >
        <Stack spacing={2.25} sx={{ position: 'relative', zIndex: 1 }}>
          <Stack
            direction="row"
            spacing={2}
            sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}
          >
            <motion.div
              animate={reduceMotion ? undefined : { y: [0, -2, 0], scale: [1, 1.035, 1] }}
              transition={
                reduceMotion
                  ? undefined
                  : {
                      duration: 3.6,
                      ease: 'easeInOut',
                      repeat: Infinity,
                      delay: 0.4,
                    }
              }
              style={{ flexShrink: 0 }}
            >
              <Box
                sx={{
                  width: 48,
                  height: 48,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: 999,
                  color: item.tone.dark,
                  background: `linear-gradient(135deg, ${varAlpha(
                    item.tone.channel,
                    0.18
                  )}, ${varAlpha(item.tone.channel, 0.08)})`,
                  boxShadow: `inset 0 0 0 1px ${varAlpha(item.tone.channel, 0.16)}`,
                }}
              >
                <Icon size={22} strokeWidth={2.1} />
              </Box>
            </motion.div>
            <Box
              component="span"
              sx={{
                px: 1.15,
                py: 0.5,
                borderRadius: 999,
                typography: 'caption',
                fontWeight: 700,
                color: item.tone.dark,
                bgcolor: varAlpha(item.tone.channel, 0.1),
                boxShadow: `inset 0 0 0 1px ${varAlpha(item.tone.channel, 0.12)}`,
              }}
            >
              {item.progressLabel}
            </Box>
          </Stack>

          <Stack spacing={0.75}>
            <Typography variant="subtitle2" sx={{ color: 'text.secondary' }}>
              {item.title}
            </Typography>
            <Typography
              component="div"
              sx={{
                fontFamily:
                  '"Barlow", "Public Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                fontSize: { xs: 28, md: 30 },
                lineHeight: 1.08,
                fontWeight: 700,
                color: 'text.primary',
              }}
            >
              <AnimatedMetricValue value={item.value} />
            </Typography>
            <Typography variant="body2" sx={{ color: 'text.secondary' }}>
              {item.description}
            </Typography>
          </Stack>
        </Stack>

        <Stack spacing={1.1} sx={{ position: 'relative', zIndex: 1, mt: 2.5 }}>
          <AnimatedLinearProgress
            ariaLabel={`${item.title} progress`}
            value={progress}
            tone={item.tone}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {item.footer}
          </Typography>
        </Stack>
      </Card>
    </motion.div>
  )
}

function OverviewWelcomePanel({
  nickname,
  updates,
  children,
}: {
  nickname?: string
  updates: OverviewUpdateItem[]
  children?: ReactNode
}) {
  const theme = useMuiTheme()
  const reduceMotion = useReducedMotion()
  const [activeIndex, setActiveIndex] = useState(0)
  const activeUpdate = updates[activeIndex] ?? updates[0]

  useEffect(() => {
    if (updates.length <= 1) {
      return
    }

    const timer = window.setInterval(() => {
      setActiveIndex((index) => (index + 1) % updates.length)
    }, 4600)

    return () => window.clearInterval(timer)
  }, [updates.length])

  useEffect(() => {
    if (activeIndex > Math.max(updates.length - 1, 0)) {
      setActiveIndex(0)
    }
  }, [activeIndex, updates.length])

  if (!activeUpdate) {
    return null
  }

  const UpdateIcon = activeUpdate.icon

  return (
    <Box
      className="lg:col-span-2"
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', lg: 'minmax(0, 1.42fr) minmax(320px, 0.78fr)' },
        gap: 2,
      }}
    >
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985, filter: 'blur(10px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={overviewEnterTransition}
        whileHover={reduceMotion ? undefined : { y: -4, scale: 1.004 }}
        style={{ minWidth: 0, height: '100%' }}
      >
        <Card
          sx={{
            p: { xs: 2.5, md: 3 },
            height: 1,
            minHeight: 214,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            borderRadius: 3,
            color: 'common.white',
            bgcolor: '#071915',
            backgroundImage: `linear-gradient(135deg, #071915 0%, #0E2A22 58%, #06100E 100%)`,
            boxShadow: `0 0 2px 0 ${varAlpha('0 167 111', 0.18)}, 0 24px 48px -28px ${varAlpha(
              '20 26 33',
              0.58
            )}`,
            backdropFilter: 'blur(18px)',
            '@keyframes overviewWelcomeSheen': {
              '0%': { transform: 'translate3d(-55%, -20%, 0) rotate(16deg)', opacity: 0 },
              '24%': { opacity: 0.42 },
              '58%': { opacity: 0.16 },
              '100%': { transform: 'translate3d(132%, 18%, 0) rotate(16deg)', opacity: 0 },
            },
            '&::before': {
              position: 'absolute',
              inset: 0,
              content: '""',
              pointerEvents: 'none',
              background: `linear-gradient(135deg, ${varAlpha(
                '0 167 111',
                0.3
              )}, transparent 34%), linear-gradient(115deg, transparent 0%, ${varAlpha(
                '255 255 255',
                0.1
              )} 48%, transparent 68%)`,
            },
            '&::after': {
              position: 'absolute',
              top: '-40%',
              left: 0,
              width: '36%',
              height: '180%',
              content: '""',
              opacity: 0,
              pointerEvents: 'none',
              background: `linear-gradient(90deg, transparent, ${varAlpha(
                '255 255 255',
                0.24
              )}, transparent)`,
              animation: reduceMotion ? 'none' : 'overviewWelcomeSheen 7.8s ease-in-out infinite',
            },
          }}
        >
          <Stack spacing={2.5} sx={{ position: 'relative', zIndex: 1 }}>
            <motion.div
              initial={reduceMotion ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : 0.1 }}
            >
              <Box
                component="span"
                sx={{
                  width: 'fit-content',
                  px: 1.35,
                  py: 0.625,
                  borderRadius: 999,
                  typography: 'caption',
                  fontWeight: 800,
                  color: '#5BE49B',
                  bgcolor: varAlpha('0 167 111', 0.16),
                  boxShadow: `inset 0 0 0 1px ${varAlpha('255 255 255', 0.12)}`,
                }}
              >
                平台概况
              </Box>
            </motion.div>

            <Stack spacing={1}>
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : 0.16 }}
              >
                <Typography
                  component="h1"
                  sx={{
                    fontFamily:
                      '"Barlow", "Public Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                    fontSize: { xs: 28, md: 32 },
                    lineHeight: 1.1,
                    fontWeight: 800,
                    color: 'common.white',
                  }}
                >
                  欢迎回来，{nickname ?? '用户'}
                </Typography>
              </motion.div>
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : 0.22 }}
              >
                <Typography
                  variant="body2"
                  sx={{
                    maxWidth: 540,
                    color: varAlpha('255 255 255', 0.68),
                    fontSize: 13.5,
                    lineHeight: 1.72,
                  }}
                >
                  在 Orbit 统一掌握作业进度、异构资源与节点健康，让科研计算稳定高效推进。
                </Typography>
              </motion.div>
            </Stack>
          </Stack>

          {children && (
            <Box
              sx={{
                mt: 3,
                p: 1,
                gap: 1,
                position: 'relative',
                zIndex: 1,
                display: 'flex',
                minWidth: 0,
                flexWrap: 'wrap',
                alignItems: 'center',
                alignSelf: { xs: 'stretch', sm: 'flex-end' },
                justifyContent: { xs: 'flex-start', sm: 'flex-end' },
                width: { xs: 1, sm: 'fit-content' },
                maxWidth: 1,
                borderRadius: 999,
                bgcolor: varAlpha('255 255 255', 0.08),
                boxShadow: `inset 0 0 0 1px ${varAlpha('255 255 255', 0.1)}`,
                '& > *': {
                  flexShrink: 0,
                },
              }}
            >
              {children}
            </Box>
          )}
        </Card>
      </motion.div>

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 22, scale: 0.985, filter: 'blur(10px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ ...overviewEnterTransition, delay: reduceMotion ? 0 : 0.08 }}
        whileHover={reduceMotion ? undefined : { y: -4, scale: 1.004 }}
        style={{ minWidth: 0, height: '100%' }}
      >
        <Card
          sx={{
            p: { xs: 2.25, md: 2.5 },
            height: 1,
            minHeight: 202,
            position: 'relative',
            overflow: 'hidden',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            borderRadius: 3,
            border: `1px solid ${varAlpha('145 158 171', 0.12)}`,
            bgcolor: 'background.paper',
            boxShadow: `0 0 2px 0 ${varAlpha('145 158 171', 0.16)}, 0 18px 36px -24px ${varAlpha(
              '20 26 33',
              0.24
            )}`,
            backdropFilter: 'blur(18px)',
            transition: theme.transitions.create(['border-color', 'box-shadow'], {
              duration: theme.transitions.duration.shorter,
            }),
            '&:hover': {
              borderColor: varAlpha(activeUpdate.tone.channel, 0.24),
              boxShadow: `0 0 2px 0 ${varAlpha(activeUpdate.tone.channel, 0.14)}, 0 22px 42px -26px ${varAlpha(
                '20 26 33',
                0.32
              )}`,
            },
            '&::before': {
              position: 'absolute',
              inset: 0,
              content: '""',
              pointerEvents: 'none',
              background: `linear-gradient(135deg, ${varAlpha(
                activeUpdate.tone.channel,
                0.12
              )}, transparent 48%)`,
            },
          }}
        >
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={activeIndex}
              initial={
                reduceMotion ? false : { opacity: 0, x: 22, scale: 0.985, filter: 'blur(8px)' }
              }
              animate={{ opacity: 1, x: 0, scale: 1, filter: 'blur(0px)' }}
              exit={
                reduceMotion
                  ? { opacity: 0 }
                  : { opacity: 0, x: -18, scale: 0.99, filter: 'blur(8px)' }
              }
              transition={{ duration: 0.46, ease: [0.22, 1, 0.36, 1] }}
              style={{
                position: 'relative',
                zIndex: 1,
              }}
            >
              <Stack
                direction="row"
                spacing={1.5}
                sx={{ mb: 2.5, alignItems: 'center', justifyContent: 'space-between' }}
              >
                <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
                  <Box
                    sx={{
                      width: 40,
                      height: 40,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                      borderRadius: 999,
                      color: activeUpdate.tone.dark,
                      bgcolor: varAlpha(activeUpdate.tone.channel, 0.12),
                      boxShadow: `inset 0 0 0 1px ${varAlpha(activeUpdate.tone.channel, 0.14)}`,
                    }}
                  >
                    <UpdateIcon size={19} strokeWidth={2.1} />
                  </Box>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="caption" sx={{ color: 'text.secondary', fontWeight: 700 }}>
                      {activeUpdate.eyebrow}
                    </Typography>
                    <Typography variant="subtitle2" sx={{ color: 'text.primary', fontWeight: 800 }}>
                      {activeUpdate.meta}
                    </Typography>
                  </Box>
                </Stack>

                <Stack direction="row" spacing={0.75} sx={{ flexShrink: 0 }}>
                  {updates.map((item, index) => {
                    const selected = index === activeIndex

                    return (
                      <Box
                        component="button"
                        key={item.title}
                        type="button"
                        aria-label={`切换到 ${item.eyebrow}`}
                        onClick={() => setActiveIndex(index)}
                        sx={{
                          p: 0,
                          width: selected ? 22 : 7,
                          height: 7,
                          border: 0,
                          borderRadius: 999,
                          cursor: 'pointer',
                          bgcolor: selected
                            ? activeUpdate.tone.main
                            : varAlpha('145 158 171', 0.26),
                          transition: theme.transitions.create(['width', 'background-color'], {
                            duration: theme.transitions.duration.shorter,
                          }),
                        }}
                      />
                    )
                  })}
                </Stack>
              </Stack>

              <Stack spacing={1.25}>
                <Typography
                  variant="h6"
                  sx={{
                    fontSize: 17,
                    lineHeight: 1.35,
                    fontWeight: 800,
                    color: 'text.primary',
                  }}
                >
                  {activeUpdate.title}
                </Typography>
                <Typography variant="body2" sx={{ color: 'text.secondary', lineHeight: 1.75 }}>
                  {activeUpdate.description}
                </Typography>
              </Stack>
            </motion.div>
          </AnimatePresence>

          <AnimatedLinearProgress
            ariaLabel="更新内容轮播进度"
            value={((activeIndex + 1) / updates.length) * 100}
            tone={activeUpdate.tone}
            ring={false}
            sx={{
              position: 'relative',
              zIndex: 1,
              mt: 2.75,
            }}
          />
        </Card>
      </motion.div>
    </Box>
  )
}

function Overview() {
  const { i18n, t } = useTranslation()
  const userInfo = useAtomValue(atomUserInfo)
  const nodeQuery = useQuery(queryNodes(true))
  const { getNicknameByName } = useAccountNameLookup()
  const { data: billingStatus } = useQuery({
    queryKey: ['system-config', 'billing-status'],
    queryFn: () => apiGetBillingStatus().then((res) => res.data),
  })
  const billingVisible = isBillingVisibleForUser(billingStatus)

  // 获取当前语言对应的 date-fns locale
  const getDateLocale = useCallback((): Locale => {
    switch (i18n.language) {
      case 'en':
        return enUS
      case 'ja':
        return ja
      case 'ko':
        return ko
      default:
        return zhCN
    }
  }, [i18n.language])

  const jobColumns = useMemo<ColumnDef<JobTableRow>[]>(
    () => [
      {
        accessorKey: 'jobType',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('jobType')} />
        ),
        cell: ({ row }) => <JobTypeLabel jobType={row.getValue<JobType>('jobType')} />,
      },
      {
        accessorFn: (row) => String(row.scheduleType ?? ScheduleType.Normal),
        id: 'scheduleType',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('scheduleType')} />
        ),
        cell: ({ row }) => <ScheduleTypeLabel scheduleType={row.original.scheduleType} />,
        filterFn: (row, id, value) => {
          return (value as string[]).includes(row.getValue(id))
        },
      },
      {
        accessorKey: 'queue',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('queue')} />
        ),
        cell: ({ row }) => <div>{row.getValue('queue')}</div>,
      },
      {
        accessorKey: 'owner',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('owner')} />
        ),
        cell: ({ row }) => <UserLabel info={row.original.userInfo} />,
      },
      {
        accessorKey: 'nodes',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('nodes')} />
        ),
        cell: ({ row }) => {
          const nodes = row.getValue<string[]>('nodes')
          return <NodeBadges nodes={nodes} />
        },
      },
      {
        accessorKey: 'resources',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('resources')} />
        ),
        cell: ({ row }) => {
          const resources = row.getValue<Record<string, string> | undefined>('resources')
          return <ResourceBadges resources={resources} />
        },
        sortingFn: (rowA, rowB) => {
          const resourcesA = rowA.original.resources
          const resourcesB = rowB.original.resources
          if (resourcesA && resourcesB) {
            // compare the number of GPUs, key with nvidia.com/ prefix
            const gpuA = Object.keys(resourcesA).filter((key) =>
              key.startsWith('nvidia.com')
            ).length
            const gpuB = Object.keys(resourcesB).filter((key) =>
              key.startsWith('nvidia.com')
            ).length
            return gpuA - gpuB
          }
          return 0
        },
      },
      ...(billingVisible
        ? [
            {
              accessorKey: 'billedPointsTotal',
              header: ({ column }) => <DataTableColumnHeader column={column} title="累计点数" />,
              cell: ({ row }) => <BillingPointsBadge value={row.original.billedPointsTotal ?? 0} />,
            } as ColumnDef<JobTableRow>,
          ]
        : []),
      {
        accessorFn: (row) => getUnifiedJobPhase(row.status),
        id: 'status',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('status')} />
        ),
        cell: ({ row }) => {
          return <JobPhaseLabel jobPhase={row.getValue<JobPhase>('status')} />
        },
        filterFn: (row, id, value) => {
          return (value as string[]).includes(row.getValue(id))
        },
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('createdAt')} />
        ),
        cell: ({ row }) => {
          return <TimeDistance date={row.getValue('createdAt')}></TimeDistance>
        },
        sortingFn: 'datetime',
      },
      {
        accessorKey: 'startedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('startedAt')} />
        ),
        cell: ({ row }) => {
          return <TimeDistance date={row.getValue('startedAt')}></TimeDistance>
        },
        sortingFn: 'datetime',
      },
      {
        accessorKey: 'completedAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title={getHeader('completedAt')} />
        ),
        cell: ({ row }) => {
          return <TimeDistance date={row.getValue('completedAt')}></TimeDistance>
        },
        sortingFn: 'datetime',
      },
    ],
    [billingVisible]
  )

  const jobQuery = useQuery({
    queryKey: ['overview', 'joblist'],
    queryFn: apiJobAllList,
    select: (res) => res.data,
    refetchInterval: REFETCH_INTERVAL,
  })
  const jobBillingQuery = useQuery({
    queryKey: ['overview', 'joblist', 'billing'],
    queryFn: () => apiJobAllBillingList(),
    select: (res) =>
      res.data.reduce<Record<string, number>>((acc, item) => {
        acc[item.jobName] = item.billedPointsTotal
        return acc
      }, {}),
    refetchInterval: REFETCH_INTERVAL,
    enabled: billingVisible,
  })
  const mergedJobQuery = useMemo(
    () =>
      ({
        data: (jobQuery.data ?? []).map((job) => ({
          ...job,
          billedPointsTotal: jobBillingQuery.data?.[job.jobName] ?? 0,
        })),
        isLoading: jobQuery.isLoading || (billingVisible && jobBillingQuery.isLoading),
        dataUpdatedAt: Math.max(
          jobQuery.dataUpdatedAt,
          billingVisible ? jobBillingQuery.dataUpdatedAt : 0
        ),
        refetch: jobQuery.refetch,
      }) as unknown as UseQueryResult<JobTableRow[], Error>,
    [
      billingVisible,
      jobBillingQuery.data,
      jobBillingQuery.dataUpdatedAt,
      jobBillingQuery.isLoading,
      jobQuery.data,
      jobQuery.dataUpdatedAt,
      jobQuery.isLoading,
      jobQuery.refetch,
    ]
  )

  const resourcesQuery = useQuery(
    queryResources(true, (resource) => {
      return resource.type == 'gpu'
    })
  )
  const billingSummaryQuery = useQuery({
    queryKey: ['context', 'billing-summary', 'overview'],
    queryFn: () => apiContextBillingSummary().then((res) => res.data),
    enabled: billingVisible,
  })

  const jobStatus = useMemo(() => {
    if (!jobQuery.data) {
      return []
    }
    const data = jobQuery.data
    const counts = data
      .filter((d) => d.status !== JobPhase.Deleted && d.status !== JobPhase.Freed)
      .reduce(
        (acc, item) => {
          const phase = item.status
          if (!acc[phase]) {
            acc[phase] = 0
          }
          acc[phase] += 1
          return acc
        },
        {} as Record<JobPhase, number>
      )
    return Object.entries(counts).map(([phase, count]) => ({
      id: phase,
      label: getJobPhaseLabel(phase as JobPhase).label,
      value: count,
    }))
  }, [jobQuery.data])

  const hideUsername = useAtomValue(globalHideUsername)
  const userStatus = useMemo(() => {
    if (!jobQuery.data) {
      return []
    }
    const data = jobQuery.data
    const counts = data
      .filter((job) => job.status == 'Running')
      .reduce(
        (acc, item) => {
          const owner = hideUsername ? getUserPseudonym(item.owner) : item.owner
          if (!acc[owner]) {
            acc[owner] = {
              nickname: item.userInfo.nickname ?? item.owner,
              count: 0,
            }
          }
          acc[owner].count += 1
          return acc
        },
        {} as Record<string, { nickname: string; count: number }>
      )
    return Object.entries(counts).map(([owner, pair]) => ({
      id: owner,
      label: hideUsername ? getUserPseudonym(owner) : pair.nickname,
      value: pair.count,
    }))
  }, [hideUsername, jobQuery.data])

  const gpuStatus = useMemo(() => {
    if (!jobQuery.data) {
      return []
    }
    const data = jobQuery.data
    const counts = data
      .filter((job) => job.status == 'Running')
      .reduce(
        (acc, item) => {
          const resources = item.resources
          for (const [k, value] of Object.entries(resources ?? {})) {
            if (k.startsWith('nvidia.com')) {
              const key = k.replace('nvidia.com/', '')
              if (!acc[key]) {
                acc[key] = 0
              }
              acc[key] += parseInt(value)
            }
          }
          return acc
        },
        {} as Record<string, number>
      )
    return Object.entries(counts).map(([phase, count]) => ({
      id: phase,
      label: phase,
      value: count,
    }))
  }, [jobQuery.data])

  const gpuAllocation = useMemo(() => {
    if (resourcesQuery.data === undefined) {
      return 0
    }
    const total = resourcesQuery.data.reduce((acc, resource) => {
      if (resource.type === 'gpu') {
        return acc + resource.amount
      }
      return acc
    }, 0)
    const used = gpuStatus.reduce((acc, item) => {
      return acc + item.value
    }, 0)
    return total > 0 ? (used / total) * 100 : 0
  }, [resourcesQuery.data, gpuStatus])

  const overviewMetrics = useMemo<OverviewMetricItem[]>(() => {
    const jobs = jobQuery.data ?? []
    const activeJobs = jobs.filter(
      (job) => job.status !== JobPhase.Deleted && job.status !== JobPhase.Freed
    )
    const runningJobs = jobs.filter((job) => job.status === JobPhase.Running).length
    const pendingJobs = jobs.filter(
      (job) => getUnifiedJobPhase(job.status) === JobPhase.Pending
    ).length
    const submitters = new Set(activeJobs.map((job) => job.owner).filter(Boolean))
    const totalGpu =
      resourcesQuery.data?.reduce((acc, resource) => {
        return resource.type === 'gpu' ? acc + resource.amount : acc
      }, 0) ?? 0
    const usedGpu = gpuStatus.reduce((acc, item) => acc + item.value, 0)

    return [
      {
        title: '运行中作业',
        value: runningJobs,
        description: '正在执行的训练与交互任务',
        icon: FlaskConicalIcon,
        tone: overviewMetricTones.primary,
        progress: activeJobs.length > 0 ? (runningJobs / activeJobs.length) * 100 : 0,
        progressLabel: `占比 ${Math.round(
          activeJobs.length > 0 ? (runningJobs / activeJobs.length) * 100 : 0
        )}%`,
        footer: `${activeJobs.length} 个近 7 天有效作业`,
      },
      {
        title: t('statuses.waiting'),
        value: pendingJobs,
        description: t('jobs.statuses.pending.description'),
        icon: ClockIcon,
        tone: overviewMetricTones.info,
        progress: activeJobs.length > 0 ? (pendingJobs / activeJobs.length) * 100 : 0,
        progressLabel: `占比 ${Math.round(
          activeJobs.length > 0 ? (pendingJobs / activeJobs.length) * 100 : 0
        )}%`,
        footer: '等待调度或资源释放',
      },
      {
        title: '活跃用户',
        value: userStatus.length,
        description: '当前运行作业所属用户',
        icon: UsersRoundIcon,
        tone: overviewMetricTones.cyan,
        progress: submitters.size > 0 ? (userStatus.length / submitters.size) * 100 : 0,
        progressLabel: `${userStatus.length} 人`,
        footer: `${submitters.size} 个近 7 天提交用户`,
      },
      {
        title: '加速卡分配率',
        value: `${gpuAllocation.toFixed()}%`,
        description: '当前 GPU 资源的分配情况',
        icon: GpuIcon,
        tone: overviewMetricTones.warning,
        progress: gpuAllocation,
        progressLabel: `${Math.round(gpuAllocation)}%`,
        footer: `${usedGpu}/${totalGpu} 张加速卡已分配`,
      },
    ]
  }, [gpuAllocation, gpuStatus, jobQuery.data, resourcesQuery.data, t, userStatus.length])

  const overviewUpdates = useMemo<OverviewUpdateItem[]>(() => {
    const jobs = jobQuery.data ?? []
    const activeJobs = jobs.filter(
      (job) => job.status !== JobPhase.Deleted && job.status !== JobPhase.Freed
    )
    const runningJobs = jobs.filter((job) => job.status === JobPhase.Running).length
    const pendingJobs = jobs.filter(
      (job) => getUnifiedJobPhase(job.status) === JobPhase.Pending
    ).length
    const totalGpu =
      resourcesQuery.data?.reduce((acc, resource) => {
        return resource.type === 'gpu' ? acc + resource.amount : acc
      }, 0) ?? 0
    const usedGpu = gpuStatus.reduce((acc, item) => acc + item.value, 0)

    return [
      {
        eyebrow: '工作台更新',
        title: '平台概况视图已切换为 Minimal 风格',
        description: '顶部指标、筛选器和作业表格已统一为更圆润的卡片语言，方便快速浏览集群状态。',
        meta: '刚刚更新',
        icon: RocketIcon,
        tone: overviewMetricTones.primary,
      },
      {
        eyebrow: '资源提醒',
        title: `GPU 当前分配率 ${Math.round(gpuAllocation)}%`,
        description:
          totalGpu > 0
            ? `${usedGpu}/${totalGpu} 张加速卡正在被作业占用，可结合节点信息查看具体资源分布。`
            : '暂未读取到 GPU 资源总量，可在节点信息中确认资源同步状态。',
        meta: '实时同步',
        icon: ActivityIcon,
        tone: overviewMetricTones.warning,
      },
      {
        eyebrow: '作业动态',
        title: `${runningJobs} 个运行中，${pendingJobs} 个等待中`,
        description: `${activeJobs.length} 个近 7 天有效作业会在下方作业信息表中展示，默认聚焦运行和等待状态。`,
        meta: '近 7 天',
        icon: BellRingIcon,
        tone: overviewMetricTones.info,
      },
    ]
  }, [gpuAllocation, gpuStatus, jobQuery.data, resourcesQuery.data])

  return (
    <>
      <div className="grid gap-4 lg:grid-cols-2">
        <OverviewWelcomePanel nickname={userInfo?.nickname} updates={overviewUpdates}>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {billingVisible ? (
              <BillingSummaryCards
                summary={billingSummaryQuery.data}
                emphasis="inline"
                compact
                className="shrink-0"
              />
            ) : null}
            <DocsButton title="平台文档" url="" />
            <ListedNewJobButton mode="all" />
          </div>
        </OverviewWelcomePanel>
        <OverviewMetricCards items={overviewMetrics} />
        <AnimatedOverviewSection delay={0.34}>
          <PieCard
            icon={FlaskConicalIcon}
            cardTitle="作业状态"
            cardDescription="查看集群近 7 天作业的状态统计"
            isLoading={jobQuery.isLoading}
          >
            <NivoPie
              data={jobStatus}
              margin={{ top: 20, bottom: 30 }}
              colors={({ id }) => {
                return jobPhases.find((x) => x.value === id)?.color ?? '#000'
              }}
              arcLabelsTextColor="#ffffff"
            />
          </PieCard>
        </AnimatedOverviewSection>
        <AnimatedOverviewSection delay={0.42}>
          <PieCard
            icon={UsersRoundIcon}
            cardTitle="用户统计"
            cardDescription="当前正在运行作业所属的用户"
            isLoading={jobQuery.isLoading}
          >
            <NivoPie data={userStatus} margin={{ top: 20, bottom: 30 }} />
          </PieCard>
        </AnimatedOverviewSection>
      </div>
      <AnimatedOverviewSection delay={0.5}>
        <DataTable
          info={{
            title: '作业信息',
            description: '查看近 7 天集群作业的运行情况',
          }}
          surface="panel"
          storageKey="overview_joblist"
          query={mergedJobQuery}
          columns={jobColumns}
          toolbarConfig={toolbarConfig}
        />
      </AnimatedOverviewSection>
      <AnimatedOverviewSection delay={0.58}>
        <DataTable
          info={{
            title: '节点信息',
            description: '集群节点维度的资源分配情况',
          }}
          surface="panel"
          storageKey="overview_nodelist"
          query={nodeQuery}
          columns={getNodeColumns(
            getNicknameByName,
            resourcesQuery.data?.map((r) => r.name),
            false,
            getDateLocale()
          )}
          toolbarConfig={nodesToolbarConfig}
        />
      </AnimatedOverviewSection>
    </>
  )
}
