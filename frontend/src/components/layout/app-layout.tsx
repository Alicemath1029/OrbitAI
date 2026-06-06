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
import { useAtomValue } from 'jotai'
import { CogIcon } from 'lucide-react'
import { motion } from 'motion/react'
import { useMemo } from 'react'

import { Badge } from '@/components/ui/badge'

import { NavBreadcrumb } from '@/components/layout/app-breadcrumb'
import { MinimalDashboardShell } from '@/components/minimal-dashboard/minimal-shell'

import { atomFixedLayout, globalSettings } from '@/utils/store'

import { cn } from '@/lib/utils'

import { NavGroupProps } from '../sidebar/types'

interface AppLayoutProps {
  groups: NavGroupProps[]
  rawPath: string
  children?: React.ReactNode
}

const AppLayout = ({ groups, rawPath, children }: AppLayoutProps) => {
  const fixedLayout = useAtomValue(atomFixedLayout)
  const scheduler = useAtomValue(globalSettings).scheduler

  // 特殊规则，网盘路由切换时，不启用过渡动画
  const motionKey = useMemo(() => {
    // begins with /portal/files/
    if (rawPath.startsWith('/portal/files/')) {
      return '/portal/files/'
    }
    if (rawPath.startsWith('/admin/files/')) {
      return '/admin/files/'
    }
    return rawPath
  }, [rawPath])

  const headerEnd =
    scheduler !== 'volcano' ? (
      <Badge variant="secondary" className="tracking-[0.08em] uppercase">
        <CogIcon />
        {scheduler}
      </Badge>
    ) : null

  return (
    <MinimalDashboardShell
      groups={groups}
      fixedLayout={fixedLayout}
      headerStart={<NavBreadcrumb className="hidden md:flex" />}
      headerEnd={headerEnd}
    >
      <motion.div
        key={motionKey}
        initial={{ opacity: 0, y: '3vh' }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ type: 'spring', duration: 0.48, bounce: 0.08 }}
        className={cn(
          '@container/main mx-auto flex w-full max-w-[1440px] flex-col gap-4 px-3 py-4 sm:px-4 md:px-4 md:py-5',
          fixedLayout && 'h-full overflow-hidden'
        )}
      >
        {children}
      </motion.div>
    </MinimalDashboardShell>
  )
}

export default AppLayout
