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
  itemVariant: 'rootItem' | 'sectionItem' | 'subItem'
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
    <Box component="nav" sx={{ ...cssVars, px: mini ? 1 : 2, py: 1, overflowY: 'auto' }}>
      <NavUl sx={{ gap: mini ? 'var(--nav-item-gap)' : '2px' }}>
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
  const active = group.items.some((item) => isItemActive(item, pathname))
  const GroupIcon = group.icon

  return (
    <NavLi>
      {!mini && (
        <NavSubheader active={active} open={open} onClick={() => setOpen((value) => !value)}>
          <ChevronRight className="minimal-nav-subheader-arrow" size={14} />
          <Box component="span" className="minimal-nav-subheader-body">
            {GroupIcon && (
              <Box component="span" className="minimal-nav-subheader-icon">
                <GroupIcon size={17} strokeWidth={2.25} />
              </Box>
            )}
            <Box component="span" className="minimal-nav-subheader-title">
              {group.title}
            </Box>
          </Box>
        </NavSubheader>
      )}

      <Collapse in={mini || open} timeout={180}>
        <NavUl
          sx={{
            gap: 'var(--nav-item-gap)',
            pl: mini ? 0 : 'var(--nav-group-content-pl)',
          }}
        >
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
  const itemVariant = mini && isRootItem ? 'rootItem' : isRootItem ? 'sectionItem' : 'subItem'

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
      itemVariant={itemVariant}
      onClick={handleClick}
    >
      <ItemBody className="minimal-nav-item-body">
        {Icon && (
          <ItemIcon className="minimal-nav-item-icon">
            <Icon
              size={itemVariant === 'rootItem' ? 23 : itemVariant === 'sectionItem' ? 21 : 17}
              strokeWidth={2.2}
            />
          </ItemIcon>
        )}

        {!mini && (
          <ItemTexts>
            <ItemTitle className="minimal-nav-item-title">{title}</ItemTitle>
          </ItemTexts>
        )}
      </ItemBody>

      {!mini && (
        <>
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
  const sectionActiveColor = '#006C80'
  const sectionActiveChannel = '0 184 217'
  const subActiveColor = '#B76E00'
  const subActiveChannel = '255 171 0'

  return {
    '--nav-item-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-hover-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-caption-color': palette?.text.disabled ?? theme.palette.text.disabled,
    '--nav-item-root-active-color': palette?.primary.main ?? theme.palette.primary.main,
    '--nav-item-root-active-color-on-dark': palette?.primary.light ?? theme.palette.primary.light,
    '--nav-item-root-active-bg': varAlpha(primaryMainChannel, 0.08),
    '--nav-item-root-active-hover-bg': varAlpha(primaryMainChannel, 0.16),
    '--nav-item-root-open-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-root-open-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-section-active-color': sectionActiveColor,
    '--nav-item-section-active-bg': varAlpha(sectionActiveChannel, 0.14),
    '--nav-item-section-active-hover-bg': varAlpha(sectionActiveChannel, 0.2),
    '--nav-item-section-open-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-section-open-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-sub-active-color': subActiveColor,
    '--nav-item-sub-active-bg': varAlpha(subActiveChannel, 0.18),
    '--nav-item-sub-active-hover-bg': varAlpha(subActiveChannel, 0.26),
    '--nav-item-sub-open-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-item-sub-open-bg': palette?.action.hover ?? theme.palette.action.hover,
    '--nav-item-sub-bullet-active-color': subActiveColor,
    '--nav-subheader-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-subheader-hover-color': palette?.text.primary ?? theme.palette.text.primary,
    '--nav-subheader-active-color': palette?.primary.main ?? theme.palette.primary.main,
    '--nav-subheader-active-bg': varAlpha(primaryMainChannel, 0.12),
    '--nav-subheader-active-hover-bg': varAlpha(primaryMainChannel, 0.18),
    '--nav-group-content-pl': '14px',
    '--nav-item-gap': '5px',
    '--nav-item-radius': `${theme.shape.borderRadius}px`,
    '--nav-item-pt': '5px',
    '--nav-item-pr': '16px',
    '--nav-item-pb': '5px',
    '--nav-item-pl': '18px',
    '--nav-item-root-height': '48px',
    '--nav-item-section-height': '44px',
    '--nav-item-sub-height': '39px',
    '--nav-icon-size': '25px',
    '--nav-icon-margin': '0 13px 0 0',
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

const navSubheaderShouldForwardProp = (prop: string) => !['active', 'open'].includes(prop)

const NavSubheader = styled(ListSubheader, {
  shouldForwardProp: navSubheaderShouldForwardProp,
})<{ active?: boolean; open?: boolean }>(({ active, theme, open }) => ({
  cursor: 'pointer',
  width: '100%',
  boxSizing: 'border-box',
  userSelect: 'none',
  alignItems: 'center',
  position: 'relative',
  gap: theme.spacing(0.75),
  display: 'flex',
  justifyContent: 'center',
  minHeight: 48,
  margin: theme.spacing(0.25, 0),
  padding: theme.spacing(0.75, 1.5),
  borderRadius: 'var(--nav-item-radius)',
  color: 'var(--nav-subheader-color)',
  fontSize: theme.typography.pxToRem(15.5),
  fontWeight: 800,
  lineHeight: 1.4,
  letterSpacing: 0,
  textTransform: 'none',
  backgroundColor: 'transparent',
  transition: theme.transitions.create(['background-color', 'color'], {
    duration: theme.transitions.duration.shorter,
  }),
  '& .minimal-nav-subheader-arrow': {
    left: theme.spacing(1.25),
    width: 17,
    height: 17,
    flexShrink: 0,
    opacity: 0.86,
    position: 'absolute',
    transform: open ? 'rotate(90deg)' : 'rotate(0deg)',
    transition: theme.transitions.create(['opacity', 'transform'], {
      duration: theme.transitions.duration.shorter,
    }),
  },
  '& .minimal-nav-subheader-body': {
    minWidth: 0,
    maxWidth: 'calc(100% - 44px)',
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: theme.spacing(0.85),
    transform: 'translateX(-10px)',
  },
  '& .minimal-nav-subheader-icon': {
    width: 21,
    height: 21,
    flexShrink: 0,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    opacity: 0.92,
    '& svg': {
      width: '100%',
      height: '100%',
    },
  },
  '& .minimal-nav-subheader-title': {
    display: 'block',
    minWidth: 0,
    overflow: 'hidden',
    textAlign: 'center',
    whiteSpace: 'nowrap',
    textOverflow: 'ellipsis',
  },
  '&:hover': {
    color: 'var(--nav-subheader-hover-color)',
    backgroundColor: 'var(--nav-item-hover-bg)',
    '& .minimal-nav-subheader-arrow, & .minimal-nav-subheader-icon': { opacity: 1 },
  },
  ...(active && {
    color: 'var(--nav-subheader-active-color)',
    backgroundColor: 'var(--nav-subheader-active-bg)',
    '&:hover': {
      backgroundColor: 'var(--nav-subheader-active-hover-bg)',
    },
  }),
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
    justifyContent: 'center',
    textAlign: 'center',
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
        [`& .minimal-nav-item-body`]: {
          maxWidth: 'none',
          transform: 'none',
        },
      }),
      ...(open &&
        !active &&
        !mini && {
          color: 'var(--nav-item-root-open-color)',
          backgroundColor: 'var(--nav-item-root-open-bg)',
        }),
      ...(active &&
        (mini
          ? {
              color: 'var(--nav-item-root-active-color)',
              backgroundColor: 'var(--nav-item-root-active-bg)',
              '&:hover': { backgroundColor: 'var(--nav-item-root-active-hover-bg)' },
            }
          : {
              color: 'var(--nav-item-sub-active-color)',
              backgroundColor: 'var(--nav-item-sub-active-bg)',
            })),
    }),
    ...(itemVariant === 'sectionItem' && {
      minHeight: 'var(--nav-item-section-height)',
      paddingLeft: theme.spacing(1.75),
      paddingRight: theme.spacing(1.5),
      color: 'var(--nav-item-color)',
      [`& .minimal-nav-item-title`]: {
        fontSize: theme.typography.pxToRem(15),
        fontWeight: 800,
      },
      [`& .minimal-nav-item-icon`]: {
        width: 22,
        height: 22,
        margin: theme.spacing(0, 1.25, 0, 0),
        opacity: 0.95,
        transition: theme.transitions.create('opacity', {
          duration: theme.transitions.duration.shorter,
        }),
      },
      ...(open &&
        !active && {
          color: 'var(--nav-item-section-open-color)',
          backgroundColor: 'var(--nav-item-section-open-bg)',
        }),
      ...(active && {
        color: 'var(--nav-item-section-active-color)',
        backgroundColor: 'var(--nav-item-section-active-bg)',
        '&:hover': {
          backgroundColor: 'var(--nav-item-section-active-hover-bg)',
        },
        [`& .minimal-nav-item-icon`]: {
          opacity: 1,
        },
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
        transition: theme.transitions.create(['background-color', 'transform'], {
          duration: theme.transitions.duration.shorter,
        }),
      },
      ...(open && {
        color: 'var(--nav-item-sub-open-color)',
        backgroundColor: 'var(--nav-item-sub-open-bg)',
      }),
      ...(active && {
        color: 'var(--nav-item-sub-active-color)',
        backgroundColor: 'var(--nav-item-sub-active-bg)',
        '&:hover': {
          backgroundColor: 'var(--nav-item-sub-active-hover-bg)',
        },
        '&::before': {
          backgroundColor: 'var(--nav-item-sub-bullet-active-color)',
          transform: 'translate(calc(var(--nav-bullet-size) * -1), 0) scale(0.56)',
        },
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

const ItemBody = styled('span')(({ theme }) => ({
  minWidth: 0,
  maxWidth: 'calc(100% - 40px)',
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto',
  transform: 'translateX(-10px)',
  [theme.breakpoints.down('sm')]: {
    maxWidth: 'calc(100% - 24px)',
    transform: 'translateX(-5px)',
  },
}))

const ItemTexts = styled('span')({
  flex: '0 1 auto',
  display: 'inline-flex',
  flexDirection: 'column',
  minWidth: 0,
})

const ItemTitle = styled('span')(({ theme }) => ({
  ...theme.typography.body2,
  flex: '0 1 auto',
  overflow: 'hidden',
  textAlign: 'center',
  whiteSpace: 'nowrap',
  textOverflow: 'ellipsis',
  fontSize: theme.typography.pxToRem(14),
  fontWeight: 600,
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
  right: theme.spacing(1.25),
  position: 'absolute',
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
