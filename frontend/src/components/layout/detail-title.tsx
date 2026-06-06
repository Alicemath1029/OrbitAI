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
import { LucideIcon } from 'lucide-react'
import { ReactNode } from 'react'

import { cn } from '@/lib/utils'

interface DetailTitleProps extends React.HTMLAttributes<HTMLDivElement> {
  title?: string
  description?: string
  children?: ReactNode
  className?: string
  icon?: LucideIcon
}

const DetailTitle = ({
  title,
  description,
  children,
  className,
  icon: Icon,
  ...props
}: DetailTitleProps) => {
  return (
    <div
      className={cn(
        'border-border/70 bg-card/95 rounded-lg border px-4 py-3 shadow-[0_0_2px_0_hsl(211_31%_9%/0.06),0_12px_24px_-18px_hsl(211_31%_9%/0.18)]',
        'flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between',
        className
      )}
      {...props}
    >
      <div className="flex min-w-0 items-center gap-3">
        {Icon && (
          <div className="border-primary/10 bg-primary/10 text-primary flex size-10 shrink-0 items-center justify-center rounded-lg border shadow-[inset_0_1px_0_hsl(0_0%_100%/0.5)]">
            <Icon className="size-5" />
          </div>
        )}
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold tracking-tight md:text-2xl">{title}</h1>
          {description && (
            <p className="text-muted-foreground mt-0.5 text-sm leading-6">{description}</p>
          )}
        </div>
      </div>
      {children && <div className="flex shrink-0 items-center gap-2">{children}</div>}
    </div>
  )
}

export default DetailTitle
