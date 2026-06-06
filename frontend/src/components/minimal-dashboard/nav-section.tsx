import Box from '@mui/material/Box'
import ButtonBase from '@mui/material/ButtonBase'
import Collapse from '@mui/material/Collapse'
import ListSubheader from '@mui/material/ListSubheader'
import Tooltip from '@mui/material/Tooltip'
import type { CSSObject, Theme } from '@mui/material/styles'
import { styled, useTheme } from '@mui/material/styles'
import { useNavigate, useRouterState } from '@tanstack/react-router'
import { ChevronRight } from 'lucide-react'
import { varAlpha } from 'minimal-shared/utils'
import type { ReactNode } from 'react'
import { useEffect, useMemo, useState } from 'react'

import type {
  NavGroupProps as OrbitNavGroupProps,
  NavItem as OrbitNavItem,
} from '@/components/sidebar/types'

type MinimalNavSectionProps = {
  groups: OrbitNavGroupProps[]
  mini?: boolean
  onNavigate?: () => void
}

type NavItemProps = {
  item: OrbitNavItem
  depth: number
  mini?: boolean
  pathname: string
  onNavigate?: () => void
}

type StyledState = {
  active?: boolean
  open?: boolean
  mini?: boolean
  itemVariant: 'rootItem' | 'subItem'
}

const navSectionClasses = {
  ul: 'minimal-nav-ul',
  li: 'minimal-nav-li',
}

export function MinimalNavSection({ groups, mini, onNavigate }: MinimalNavSectionProps) {
  const theme = useTheme()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const cssVars = useMemo(() => createNavCssVars(theme), [theme])

  return (
    <Box component="nav" sx={{ ...cssVars, px: mini ? 1 : 2, py: 1.5, overflowY: 'auto' }}>
      <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
        {groups.map((group) => (
          <NavGroup
            key={group.title}
            group={group}
            mini={mini}
            pathname={pathname}
            onNavigate={onNavigate}
          />
        ))}
      </NavUl>
    </Box>
  )
}

function NavGroup({
  group,
  mini,
  pathname,
  onNavigate,
}: {
  group: OrbitNavGroupProps
  mini?: boolean
  pathname: string
  onNavigate?: () => void
}) {
  const [open, setOpen] = useState(true)

  return (
    <NavLi>
      {!mini && (
        <NavSubheader open={open} onClick={() => setOpen((value) => !value)}>
          <ChevronRight size={14} />
          {group.title}
        </NavSubheader>
      )}

      <Collapse in={mini || open} timeout={180}>
        <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
          {group.items.map((item) => (
            <NavList
              key={getItemKey(item)}
              item={item}
              depth={1}
              mini={mini}
              pathname={pathname}
              onNavigate={onNavigate}
            />
          ))}
        </NavUl>
      </Collapse>
    </NavLi>
  )
}

function NavList({ item, depth, mini, pathname, onNavigate }: NavItemProps) {
  const navigate = useNavigate()
  const hasChild = Boolean(item.items?.length)
  const active = isItemActive(item, pathname)
  const [open, setOpen] = useState(active)
  const title = item.title
  const Icon = item.icon
  const path = getItemPath(item)
  const isRootItem = depth === 1

  useEffect(() => {
    setOpen(active)
  }, [active, pathname])

  const handleClick = (event: React.MouseEvent<HTMLElement>) => {
    if (hasChild) {
      event.preventDefault()

      if (mini) {
        if (path) {
          navigate({ to: path })
          onNavigate?.()
        }
        return
      }

      setOpen((value) => !value)
      return
    }

    if (path) {
      event.preventDefault()
      navigate({ to: path })
      onNavigate?.()
    }
  }

  const renderItem = (
    <ItemRoot
      aria-label={title}
      active={active}
      open={open}
      mini={mini && isRootItem}
      itemVariant={isRootItem ? 'rootItem' : 'subItem'}
      onClick={handleClick}
    >
      {Icon && (
        <ItemIcon>
          <Icon size={isRootItem ? 22 : 18} strokeWidth={2.2} />
        </ItemIcon>
      )}

      {!mini && (
        <>
          <ItemTexts>
            <ItemTitle>{title}</ItemTitle>
          </ItemTexts>

          {item.badge && <ItemInfo>{item.badge}</ItemInfo>}

          {hasChild && (
            <ItemArrow open={open}>
              <ChevronRight size={16} />
            </ItemArrow>
          )}
        </>
      )}
    </ItemRoot>
  )

  return (
    <NavLi>
      {mini && isRootItem ? (
        <Tooltip title={title} placement="right">
          {renderItem}
        </Tooltip>
      ) : (
        renderItem
      )}

      {hasChild && !mini && (
        <NavCollapse in={open} timeout={180} depth={depth} mountOnEnter unmountOnExit>
          <NavUl sx={{ gap: 'var(--nav-item-gap)' }}>
            {item.items?.map((child) => (
              <NavList
                key={getItemKey(child)}
                item={child}
                depth={depth + 1}
                pathname={pathname}
                onNavigate={onNavigate}
              />
            ))}
          </NavUl>
        </NavCollapse>
      )}
    </NavLi>
  )
}

function createNavCssVars(theme: Theme): CSSObject {
  const palette = theme.vars?.palette
  const primaryMainChannel = palette?.primary.mainChannel ?? '0 167 111'

  return {
    '--nav-item-color': palette?.text.secondary ?? theme.palette.text.secondary,
    '--nav-item-hover-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-caption-color': palette?.text.disabled ?? theme.palette.text.disabled,
    '--nav-item-root-active-color': palette?.primary.main ?? theme.palette.primary.main,
    '--nav-item-root-active-color-on-dark': palette?.primary.light ?? theme.palette.primary.light,
    '--nav-item-root-active-bg': varAlpha(primaryMainChannel, 0.08),
    '--nav-item-root-active-hover-bg': varAlpha(primaryMainChannel, 0.16),
    '--nav-item-root-open-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-root-open-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-sub-active-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-sub-active-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-sub-open-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-sub-open-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-subheader-color': palette?.text.disabled ?? theme.palette.text.disabled,
    '--nav-subheader-hover-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-gap': '4px',
    '--nav-item-radius': `${theme.shape.borderRadius}px`,
    '--nav-item-pt': '4px',
    '--nav-item-pr': '8px',
    '--nav-item-pb': '4px',
    '--nav-item-pl': '12px',
    '--nav-item-root-height': '44px',
    '--nav-item-sub-height': '36px',
    '--nav-icon-size': '24px',
    '--nav-icon-margin': '0 12px 0 0',
    '--nav-bullet-size': '12px',
    '--nav-bullet-light-color': '#EDEFF2',
    '--nav-bullet-dark-color': '#282F37',
  } as CSSObject
}

function normalizePath(path?: string) {
  return (path ?? '').split('?')[0].split('#')[0].replace(/\/+$/g, '') || '/'
}

function isPathActive(pathname: string, path?: string) {
  const currentPath = normalizePath(pathname)
  const targetPath = normalizePath(path)

  if (!path || targetPath === '/') {
    return currentPath === targetPath
  }

  return currentPath === targetPath || currentPath.startsWith(`${targetPath}/`)
}

function isItemActive(item: OrbitNavItem, pathname: string): boolean {
  if (item.items?.length) {
    return item.items.some((child) => isItemActive(child, pathname))
  }

  return isPathActive(pathname, item.url)
}

function getItemPath(item: OrbitNavItem): string | undefined {
  if (item.items?.length) {
    return getItemPath(item.items[0])
  }

  return item.url
}

function getItemKey(item: OrbitNavItem): string {
  if (item.items?.length) {
    return `${item.title}-${item.items.map((child) => getItemKey(child)).join('|')}`
  }

  return `${item.title}-${item.url}`
}

const NavUl = styled((props: { children: ReactNode; className?: string; sx?: object }) => (
  <Box component="ul" {...props} className={`${navSectionClasses.ul} ${props.className ?? ''}`} />
))({
  display: 'flex',
  flexDirection: 'column',
  padding: 0,
  margin: 0,
  listStyle: 'none',
})

const NavLi = styled((props: { children: ReactNode; className?: string; sx?: object }) => (
  <Box component="li" {...props} className={`${navSectionClasses.li} ${props.className ?? ''}`} />
))({
  display: 'block',
  minWidth: 0,
})

const NavSubheader = styled(ListSubheader)<{ open?: boolean }>(({ theme, open }) => ({
  ...theme.typography.overline,
  cursor: 'pointer',
  alignItems: 'center',
  position: 'relative',
  gap: theme.spacing(0.75),
  display: 'inline-flex',
  alignSelf: 'flex-start',
  minHeight: 34,
  padding: theme.spacing(1.5, 1, 0.75, 1.5),
  color: 'var(--nav-subheader-color)',
  fontSize: theme.typography.pxToRem(11),
  lineHeight: 1,
  letterSpacing: 0.4,
  backgroundColor: 'transparent',
  transition: theme.transitions.create(['color', 'padding-left'], {
    duration: theme.transitions.duration.shorter,
  }),
  '& svg': {
    opacity: 0,
    transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: theme.transitions.create(['opacity', 'transform'], {
      duration: theme.transitions.duration.shorter,
    }),
  },
  '&:hover': {
    paddingLeft: theme.spacing(2),
    color: 'var(--nav-subheader-hover-color)',
    '& svg': { opacity: 1 },
  },
}))

const shouldForwardProp = (prop: string) =>
  !['active', 'open', 'mini', 'itemVariant', 'sx'].includes(prop)

const ItemRoot = styled(ButtonBase, { shouldForwardProp })<StyledState>(
  ({ active, itemVariant, mini, open, theme }) => ({
    width: '100%',
    minWidth: 0,
    border: 0,
    display: 'flex',
    position: 'relative',
    alignItems: 'center',
    textAlign: 'left',
    borderRadius: 'var(--nav-item-radius)',
    color: 'var(--nav-item-color)',
    paddingTop: 'var(--nav-item-pt)',
    paddingLeft: 'var(--nav-item-pl)',
    paddingRight: 'var(--nav-item-pr)',
    paddingBottom: 'var(--nav-item-pb)',
    textDecoration: 'none',
    transition: theme.transitions.create(['background-color', 'color'], {
      duration: theme.transitions.duration.shorter,
    }),
    '&:hover': { backgroundColor: 'var(--nav-item-hover-bg)' },
    ...(itemVariant === 'rootItem' && {
      minHeight: mini ? 48 : 'var(--nav-item-root-height)',
      ...(mini && {
        justifyContent: 'center',
        padding: 0,
      }),
      ...(open &&
        !active &&
        !mini && {
          color: 'var(--nav-item-root-open-color)',
          backgroundColor: 'var(--nav-item-root-open-bg)',
        }),
      ...(active && {
        color: 'var(--nav-item-root-active-color)',
        backgroundColor: 'var(--nav-item-root-active-bg)',
        '&:hover': { backgroundColor: 'var(--nav-item-root-active-hover-bg)' },
      }),
    }),
    ...(itemVariant === 'subItem' && {
      minHeight: 'var(--nav-item-sub-height)',
      '&::before': {
        left: 0,
        content: '""',
        position: 'absolute',
        width: 'var(--nav-bullet-size)',
        height: 'var(--nav-bullet-size)',
        borderRadius: '50%',
        backgroundColor: 'var(--nav-bullet-light-color)',
        transform: 'translate(calc(var(--nav-bullet-size) * -1), 0) scale(0.38)',
      },
      ...(open && {
        color: 'var(--nav-item-sub-open-color)',
        backgroundColor: 'var(--nav-item-sub-open-bg)',
      }),
      ...(active && {
        color: 'var(--nav-item-sub-active-color)',
        backgroundColor: 'var(--nav-item-sub-active-bg)',
      }),
    }),
  })
)

const ItemIcon = styled('span')({
  width: 'var(--nav-icon-size)',
  height: 'var(--nav-icon-size)',
  flexShrink: 0,
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: 'var(--nav-icon-margin)',
  '& svg': {
    width: '100%',
    height: '100%',
  },
})

const ItemTexts = styled('span')({
  flex: '1 1 auto',
  display: 'inline-flex',
  flexDirection: 'column',
  minWidth: 0,
})

const ItemTitle = styled('span')(({ theme }) => ({
  ...theme.typography.body2,
  flex: '1 1 auto',
  overflow: 'hidden',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  fontWeight: theme.typography.fontWeightMedium,
}))

const ItemInfo = styled('span')(({ theme }) => {
  const primaryMain = theme.vars?.palette.primary.main ?? theme.palette.primary.main
  const primaryMainChannel = theme.vars?.palette.primary.mainChannel ?? '0 167 111'

  return {
    flexShrink: 0,
    marginLeft: 6,
    minWidth: 18,
    height: 18,
    padding: theme.spacing(0, 0.75),
    borderRadius: 999,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 11,
    fontWeight: 700,
    lineHeight: 1,
    color: primaryMain,
    backgroundColor: varAlpha(primaryMainChannel, 0.12),
  }
})

const ItemArrow = styled('span', { shouldForwardProp })<{ open?: boolean }>(({ open, theme }) => ({
  width: 16,
  height: 16,
  flexShrink: 0,
  marginLeft: 6,
  display: 'inline-flex',
  transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
  transition: theme.transitions.create('transform', {
    duration: theme.transitions.duration.shorter,
  }),
}))

const NavCollapse = styled(Collapse, {
  shouldForwardProp: (prop: string) => !['depth', 'sx'].includes(prop),
})<{ depth?: number }>(({ depth }) => ({
  ...(depth && {
    paddingLeft: 'calc(var(--nav-item-pl) + var(--nav-icon-size) / 2)',
    [`& .${navSectionClasses.ul}`]: {
      position: 'relative',
      paddingLeft: 'var(--nav-bullet-size)',
      '&::before': {
        top: 0,
        left: 0,
        width: 2,
        content: '""',
        position: 'absolute',
        backgroundColor: 'var(--nav-bullet-light-color)',
        bottom: 'calc(var(--nav-item-sub-height) - 2px - var(--nav-bullet-size) / 2)',
      },
    },
  }),
}))
