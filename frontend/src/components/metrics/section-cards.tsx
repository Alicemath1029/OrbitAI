import { LucideIcon } from 'lucide-react'
import { ReactNode } from 'react'

import { Card, CardAction, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'

import { cn } from '@/lib/utils'

interface SectionCardsProps {
  items: {
    title: string
    description?: string
    value: ReactNode
    className?: string
    icon?: LucideIcon
  }[]
  className?: string
}

export function SectionCards({ items, className }: SectionCardsProps) {
  return (
    <div
      className={cn('grid grid-cols-1 gap-3 @xl/main:grid-cols-2 @5xl/main:grid-cols-4', className)}
    >
      {items.map((item) => (
        <Card key={item.title} className="border-border/70 @container/card overflow-hidden">
          <CardHeader className="gap-2">
            <div className="flex items-center justify-between gap-3">
              <CardDescription className="flex flex-row items-center gap-2 font-semibold">
                {item.icon && (
                  <span className="bg-primary/10 text-primary flex size-7 items-center justify-center rounded-md">
                    <item.icon className="size-4" />
                  </span>
                )}
                {item.title}
              </CardDescription>
              <CardAction>
                <CardTitle
                  className={cn(
                    'text-xl font-semibold tracking-tight tabular-nums @[250px]/card:text-2xl',
                    item.className
                  )}
                >
                  {item.value}
                </CardTitle>
              </CardAction>
            </div>
          </CardHeader>
        </Card>
      ))}
    </div>
  )
}
