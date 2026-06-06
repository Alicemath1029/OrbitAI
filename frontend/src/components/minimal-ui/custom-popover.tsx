import { listClasses } from '@mui/material/List'
import { menuItemClasses } from '@mui/material/MenuItem'
import type { PaperProps } from '@mui/material/Paper'
import type { PopoverOrigin, PopoverProps } from '@mui/material/Popover'
import Popover from '@mui/material/Popover'
import type { CSSObject, SxProps, Theme } from '@mui/material/styles'
import { styled, useTheme } from '@mui/material/styles'
import { mergeRefs, varAlpha } from 'minimal-shared/utils'
import type { Ref } from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'

export type ArrowPlacement =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right'
  | 'left-top'
  | 'left-center'
  | 'left-bottom'
  | 'right-top'
  | 'right-center'
  | 'right-bottom'

type ArrowProps = {
  hide?: boolean
  placement?: ArrowPlacement
  size?: number
  sx?: SxProps<Theme>
}

type PaperOffset = [number, number]

export type CustomPopoverProps = Omit<PopoverProps, 'slotProps'> & {
  slotProps?: PopoverProps['slotProps'] & {
    arrow?: ArrowProps
    paper?: PaperProps & {
      offset?: PaperOffset
      ref?: Ref<HTMLDivElement>
    }
  }
}

type ElementRect = {
  top: number
  left: number
  width: number
  height: number
}

const DEFAULT_ARROW_SIZE = 14
const DEFAULT_ARROW_PLACEMENT: ArrowPlacement = 'top-right'
const DEFAULT_PAPER_OFFSET: PaperOffset = [8, 2]
const ARROW_TRANSLATE = '48%'
const MINIMAL_GREY_500_CHANNEL = '145 158 171'

const ORIGIN_MAP: Record<
  ArrowPlacement,
  { anchorOrigin: PopoverOrigin; transformOrigin: PopoverOrigin }
> = {
  'top-left': {
    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
    transformOrigin: { vertical: 'top', horizontal: 'left' },
  },
  'top-center': {
    anchorOrigin: { vertical: 'bottom', horizontal: 'center' },
    transformOrigin: { vertical: 'top', horizontal: 'center' },
  },
  'top-right': {
    anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
    transformOrigin: { vertical: 'top', horizontal: 'right' },
  },
  'bottom-left': {
    anchorOrigin: { vertical: 'top', horizontal: 'left' },
    transformOrigin: { vertical: 'bottom', horizontal: 'left' },
  },
  'bottom-center': {
    anchorOrigin: { vertical: 'top', horizontal: 'center' },
    transformOrigin: { vertical: 'bottom', horizontal: 'center' },
  },
  'bottom-right': {
    anchorOrigin: { vertical: 'top', horizontal: 'right' },
    transformOrigin: { vertical: 'bottom', horizontal: 'right' },
  },
  'left-top': {
    anchorOrigin: { vertical: 'top', horizontal: 'right' },
    transformOrigin: { vertical: 'top', horizontal: 'left' },
  },
  'left-center': {
    anchorOrigin: { vertical: 'center', horizontal: 'right' },
    transformOrigin: { vertical: 'center', horizontal: 'left' },
  },
  'left-bottom': {
    anchorOrigin: { vertical: 'bottom', horizontal: 'right' },
    transformOrigin: { vertical: 'bottom', horizontal: 'left' },
  },
  'right-top': {
    anchorOrigin: { vertical: 'top', horizontal: 'left' },
    transformOrigin: { vertical: 'top', horizontal: 'right' },
  },
  'right-center': {
    anchorOrigin: { vertical: 'center', horizontal: 'left' },
    transformOrigin: { vertical: 'center', horizontal: 'right' },
  },
  'right-bottom': {
    anchorOrigin: { vertical: 'bottom', horizontal: 'left' },
    transformOrigin: { vertical: 'bottom', horizontal: 'right' },
  },
}

function toNumber(value: string | null) {
  if (!value) return 0
  const parsed = Number.parseFloat(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function extractTranslate(translate: string) {
  if (!translate || translate === 'none') return { translateX: 0, translateY: 0 }

  const [x, y] = translate.split(' ')
  return { translateX: toNumber(x), translateY: toNumber(y) }
}

function useElementRect(
  element: HTMLElement | null,
  context: 'anchor' | 'popoverPaper',
  open: boolean
) {
  const [rect, setRect] = useState<ElementRect | null>(null)

  const updateRect = useCallback(() => {
    if (!element || !open) return

    if (context === 'popoverPaper') {
      const { height, left, marginLeft, marginTop, top, translate, width } =
        getComputedStyle(element)
      const { translateX, translateY } = extractTranslate(translate)

      setRect({
        width: toNumber(width),
        height: toNumber(height),
        top: toNumber(top) + toNumber(marginTop) + translateY,
        left: toNumber(left) + toNumber(marginLeft) + translateX,
      })
      return
    }

    const domRect = element.getBoundingClientRect()
    setRect({
      top: domRect.top,
      left: domRect.left,
      width: domRect.width,
      height: domRect.height,
    })
  }, [context, element, open])

  useEffect(() => {
    if (!element || !open) return undefined

    updateRect()

    const resizeObserver = new ResizeObserver(updateRect)
    resizeObserver.observe(element)
    window.addEventListener('resize', updateRect, { passive: true })
    window.addEventListener('scroll', updateRect, { capture: true })

    return () => {
      resizeObserver.disconnect()
      window.removeEventListener('resize', updateRect)
      window.removeEventListener('scroll', updateRect)
    }
  }, [element, open, updateRect])

  return rect
}

function flipHorizontal(origin: PopoverOrigin): PopoverOrigin {
  if (origin.horizontal === 'left') return { ...origin, horizontal: 'right' }
  if (origin.horizontal === 'right') return { ...origin, horizontal: 'left' }
  return origin
}

function getPopoverOrigin(
  placement: ArrowPlacement,
  isRtl = false
): { anchorOrigin: PopoverOrigin; transformOrigin: PopoverOrigin } {
  const originPair = ORIGIN_MAP[placement]

  if (!isRtl) return originPair

  return {
    anchorOrigin: flipHorizontal(originPair.anchorOrigin),
    transformOrigin: flipHorizontal(originPair.transformOrigin),
  }
}

function getPaperOffsetStyles(
  placement: ArrowPlacement,
  paperOffsets: PaperOffset,
  isRtl: boolean
): CSSObject {
  const [primaryOffset, secondaryOffset] = paperOffsets
  const rtlDirection = isRtl ? -1 : 1

  const offsetBySide: Record<string, Record<string, readonly [number, number]>> = {
    top: {
      left: [-primaryOffset * rtlDirection, secondaryOffset],
      center: [0, secondaryOffset],
      right: [primaryOffset * rtlDirection, secondaryOffset],
    },
    bottom: {
      left: [-primaryOffset * rtlDirection, -secondaryOffset],
      center: [0, -secondaryOffset],
      right: [primaryOffset * rtlDirection, -secondaryOffset],
    },
    left: {
      top: [secondaryOffset * rtlDirection, -primaryOffset],
      center: [secondaryOffset * rtlDirection, 0],
      bottom: [secondaryOffset * rtlDirection, primaryOffset],
    },
    right: {
      top: [-secondaryOffset * rtlDirection, -primaryOffset],
      center: [-secondaryOffset * rtlDirection, 0],
      bottom: [-secondaryOffset * rtlDirection, primaryOffset],
    },
  }

  const [side, align = 'center'] = placement.split('-')
  const [translateX, translateY] = offsetBySide[side]?.[align] ?? [0, 0]

  return { translate: `${translateX}px ${translateY}px` }
}

function getArrowOffset(anchorRect: ElementRect, paperRect: ElementRect, arrowSize: number) {
  const anchorCenterX = anchorRect.left - paperRect.left + anchorRect.width / 2
  const anchorCenterY = anchorRect.top - paperRect.top + anchorRect.height / 2
  const minOffset = arrowSize / 2
  const maxOffsetX = paperRect.width - arrowSize * 2
  const maxOffsetY = paperRect.height - arrowSize * 2

  return {
    offsetX: Math.max(minOffset, Math.min(anchorCenterX - arrowSize / 2, maxOffsetX)),
    offsetY: Math.max(minOffset, Math.min(anchorCenterY - arrowSize / 2, maxOffsetY)),
  }
}

function getArrowPlacementStyles(side: 'top' | 'bottom' | 'left' | 'right', isRtl = false) {
  const styleBySide = {
    top: { top: 0, rotate: '135deg', translate: `0 -${ARROW_TRANSLATE}` },
    bottom: { bottom: 0, rotate: '-45deg', translate: `0 ${ARROW_TRANSLATE}` },
    left: isRtl
      ? { left: 0, rotate: '-135deg', translate: `${ARROW_TRANSLATE} 0` }
      : { left: 0, rotate: '45deg', translate: `-${ARROW_TRANSLATE} 0` },
    right: isRtl
      ? { right: 0, rotate: '45deg', translate: `-${ARROW_TRANSLATE} 0` }
      : { right: 0, rotate: '-135deg', translate: `${ARROW_TRANSLATE} 0` },
  }

  return styleBySide[side]
}

const Arrow = styled('span', {
  shouldForwardProp: (prop: string) =>
    !['anchorRect', 'paperRect', 'placement', 'size', 'sx'].includes(prop),
})<{
  anchorRect: ElementRect
  paperRect: ElementRect
  placement: ArrowPlacement
  size: number
}>(({ anchorRect, paperRect, placement, size, theme }) => {
  const isRtl = theme.direction === 'rtl'
  const { offsetX, offsetY } = getArrowOffset(anchorRect, paperRect, size)

  return {
    width: size,
    height: size,
    position: 'absolute',
    clipPath: 'polygon(0% 0%, 100% 100%, 0% 100%)',
    borderBottomLeftRadius: isRtl ? 0 : size / 4,
    borderBottomRightRadius: isRtl ? size / 4 : 0,
    backgroundColor: theme.palette.background.paper,
    border: `solid 1px ${varAlpha(MINIMAL_GREY_500_CHANNEL, 0.12)}`,
    ...(placement.startsWith('top-') && {
      ...getArrowPlacementStyles('top'),
      left: `${offsetX}px`,
    }),
    ...(placement.startsWith('bottom-') && {
      ...getArrowPlacementStyles('bottom'),
      left: `${offsetX}px`,
    }),
    ...(placement.startsWith('left-') && {
      ...getArrowPlacementStyles('left', isRtl),
      top: `${offsetY}px`,
    }),
    ...(placement.startsWith('right-') && {
      ...getArrowPlacementStyles('right', isRtl),
      top: `${offsetY}px`,
    }),
  }
})

export function CustomPopover({
  anchorEl,
  children,
  onClose,
  open,
  slotProps,
  ...other
}: CustomPopoverProps) {
  const theme = useTheme()
  const isRtl = theme.direction === 'rtl'
  const { arrow: arrowProps, paper: paperProps, ...otherSlotProps } = slotProps ?? {}
  const arrowSize = arrowProps?.size ?? DEFAULT_ARROW_SIZE
  const arrowPlacement = arrowProps?.placement ?? DEFAULT_ARROW_PLACEMENT
  const paperOffset = paperProps?.offset ?? DEFAULT_PAPER_OFFSET
  const { anchorOrigin, transformOrigin } = getPopoverOrigin(arrowPlacement, isRtl)
  const paperRef = useRef<HTMLDivElement>(null)
  const paperRect = useElementRect(paperRef.current, 'popoverPaper', Boolean(open))
  const anchorRect = useElementRect(anchorEl as HTMLElement, 'anchor', Boolean(open))
  const showArrow = !arrowProps?.hide && !!paperRect && !!anchorRect

  const paperStyles: SxProps<Theme> = {
    ...getPaperOffsetStyles(arrowPlacement, paperOffset, isRtl),
    overflow: 'inherit',
    [`& .${listClasses.root}`]: { minWidth: 140 },
    [`& .${menuItemClasses.root}`]: { gap: 2 },
  }

  return (
    <Popover
      aria-hidden={!open}
      open={Boolean(open)}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      slotProps={{
        ...otherSlotProps,
        paper: {
          ...paperProps,
          ref: mergeRefs([paperRef, paperProps?.ref]),
          sx: [paperStyles, ...(Array.isArray(paperProps?.sx) ? paperProps.sx : [paperProps?.sx])],
        },
      }}
      {...other}
    >
      {showArrow && (
        <Arrow
          size={arrowSize}
          placement={arrowPlacement}
          paperRect={paperRect}
          anchorRect={anchorRect}
          sx={arrowProps?.sx}
        />
      )}

      {children}
    </Popover>
  )
}
