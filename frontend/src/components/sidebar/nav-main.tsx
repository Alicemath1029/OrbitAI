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
import { Link, useLocation } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { ReactNode, useMemo } from 'react'

import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from '@/components/ui/sidebar'

import { NavCollapsible, type NavGroupProps, NavItem, NavLink } from './types.ts'

type NavGroupComponentProps = NavGroupProps & {
  activeItemKey?: string
  onActiveItemChange?: (itemKey: string) => void
}

export function NavGroup({
  title,
  items,
  activeItemKey,
  onActiveItemChange,
}: NavGroupComponentProps) {
  const { state } = useSidebar()
  const location = useLocation()
  const href = useMemo(() => location.pathname, [location.pathname])

  return (
    <SidebarGroup className="group-data-[collapsible=icon]:py-0">
      <SidebarGroupLabel className="group-data-[collapsible=icon]:hidden">
        {title}
      </SidebarGroupLabel>
      <SidebarMenu>
        {items.map((item) => {
          const key = getNavItemKey(item)
          const isPrimaryActive = activeItemKey === key

          if (!item.items)
            return (
              <SidebarMenuLink
                key={key}
                item={item}
                itemKey={key}
                isActive={isPrimaryActive}
                onActiveItemChange={onActiveItemChange}
              />
            )

          if (state === 'collapsed')
            return (
              <SidebarMenuCollapsedDropdown
                key={key}
                item={item}
                itemKey={key}
                href={href}
                isActive={isPrimaryActive}
                onActiveItemChange={onActiveItemChange}
              />
            )

          return (
            <SidebarMenuCollapsible
              key={key}
              item={item}
              itemKey={key}
              href={href}
              isActive={isPrimaryActive}
              onActiveItemChange={onActiveItemChange}
            />
          )
        })}
      </SidebarMenu>
    </SidebarGroup>
  )
}

const NavBadge = ({ children }: { children: ReactNode }) => (
  <Badge className="rounded-full px-1 py-0 text-xs">{children}</Badge>
)

const SidebarMenuLink = ({
  item,
  itemKey,
  isActive,
  onActiveItemChange,
}: {
  item: NavLink
  itemKey: string
  isActive: boolean
  onActiveItemChange?: (itemKey: string) => void
}) => {
  const { setOpenMobile } = useSidebar()

  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActive} tooltip={item.title}>
        <Link
          to={item.url}
          onClick={() => {
            onActiveItemChange?.(itemKey)
            setOpenMobile(false)
          }}
        >
          {item.icon && <item.icon />}
          <span>{item.title}</span>
          {item.badge && <NavBadge>{item.badge}</NavBadge>}
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  )
}

const SidebarMenuCollapsible = ({
  item,
  itemKey,
  href,
  isActive,
  onActiveItemChange,
}: {
  item: NavCollapsible
  itemKey: string
  href: string
  isActive: boolean
  onActiveItemChange?: (itemKey: string) => void
}) => {
  const { setOpenMobile } = useSidebar()
  const isRouteActive = checkIsActive(href, item)

  return (
    <Collapsible asChild defaultOpen={isRouteActive} className="group/collapsible">
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isActive}
            onClick={() => onActiveItemChange?.(itemKey)}
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent className="CollapsibleContent">
          <SidebarMenuSub>
            {item.items.map((subItem) => (
              <SidebarMenuSubItem key={subItem.title}>
                <SidebarMenuSubButton asChild isActive={checkIsLinkActive(href, subItem.url)}>
                  <Link
                    to={subItem.url}
                    onClick={() => {
                      onActiveItemChange?.(itemKey)
                      setOpenMobile(false)
                    }}
                  >
                    {subItem.icon && <subItem.icon />}
                    <span>{subItem.title}</span>
                    {subItem.badge && <NavBadge>{subItem.badge}</NavBadge>}
                  </Link>
                </SidebarMenuSubButton>
              </SidebarMenuSubItem>
            ))}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  )
}

const SidebarMenuCollapsedDropdown = ({
  item,
  itemKey,
  href,
  isActive,
  onActiveItemChange,
}: {
  item: NavCollapsible
  itemKey: string
  href: string
  isActive: boolean
  onActiveItemChange?: (itemKey: string) => void
}) => {
  return (
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            tooltip={item.title}
            isActive={isActive}
            onClick={() => onActiveItemChange?.(itemKey)}
          >
            {item.icon && <item.icon />}
            <span>{item.title}</span>
            {item.badge && <NavBadge>{item.badge}</NavBadge>}
            <ChevronRight className="ml-auto transition-transform duration-200 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="right" align="start" sideOffset={4}>
          <DropdownMenuLabel>
            {item.title} {item.badge ? `(${item.badge})` : ''}
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {item.items.map((sub) => (
            <DropdownMenuItem key={`${sub.title}-${sub.url}`} asChild>
              <Link
                to={sub.url}
                className={`${checkIsLinkActive(href, sub.url) ? 'bg-secondary' : ''}`}
                onClick={() => onActiveItemChange?.(itemKey)}
              >
                {sub.icon && <sub.icon />}
                <span className="max-w-52 text-wrap">{sub.title}</span>
                {sub.badge && <span className="ml-auto text-xs">{sub.badge}</span>}
              </Link>
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  )
}

function normalizePath(path?: string) {
  return (path ?? '')
    .split('?')[0]
    .split('#')[0]
    .replace(/^\/(portal|admin)(?=\/|$)/, '')
    .replace(/^\/+|\/+$/g, '')
}

function checkIsLinkActive(href: string, url?: string) {
  const currentPath = normalizePath(href)
  const targetPath = normalizePath(url)

  if (!targetPath) return false

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

function checkIsActive(href: string, item: NavItem) {
  if (item.items) {
    return item.items.some((subItem) => checkIsLinkActive(href, subItem.url))
  }

  return checkIsLinkActive(href, item.url)
}

export function getNavItemKey(item: NavItem) {
  if (item.items) {
    return `${item.title}-${item.items.map((subItem) => subItem.url).join('|')}`
  }

  return `${item.title}-${item.url}`
}

export function findActiveNavItemKey(groups: NavGroupProps[], href: string) {
  for (const group of groups) {
    const activeItem = group.items.find((item) => checkIsActive(href, item))

    if (activeItem) {
      return getNavItemKey(activeItem)
    }
  }

  return undefined
}
