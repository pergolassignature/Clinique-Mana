import * as React from 'react'
import { useCallback, useEffect, useRef, useState, useMemo } from 'react'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { cn } from '@/shared/lib/utils'

interface StablePopoverContextValue {
  open: boolean
  onOpenChange: (open: boolean) => void
  triggerRef: React.RefObject<HTMLButtonElement | null>
  anchorRect: DOMRect | null
}

const StablePopoverContext = React.createContext<StablePopoverContextValue | null>(null)

function useStablePopoverContext() {
  const context = React.useContext(StablePopoverContext)
  if (!context) {
    throw new Error('StablePopover components must be used within a StablePopover')
  }
  return context
}

interface StablePopoverProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}

/**
 * StablePopover - A popover that locks its position while open.
 *
 * Unlike standard Radix Popover, this component captures the trigger's
 * position when opened and maintains that position even if the trigger
 * moves due to layout reflow (e.g., when chips wrap to new lines).
 *
 * The position only updates on window scroll/resize, not on trigger
 * dimension changes while open.
 */
export function StablePopover({ open, onOpenChange, children }: StablePopoverProps) {
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [anchorRect, setAnchorRect] = useState<DOMRect | null>(null)

  // Capture anchor position when popover opens
  useEffect(() => {
    if (open && triggerRef.current) {
      setAnchorRect(triggerRef.current.getBoundingClientRect())
    } else if (!open) {
      setAnchorRect(null)
    }
  }, [open])

  // Update position on scroll/resize only
  useEffect(() => {
    if (!open || !triggerRef.current) return

    const updatePosition = () => {
      if (triggerRef.current) {
        setAnchorRect(triggerRef.current.getBoundingClientRect())
      }
    }

    // Debounce scroll updates for performance
    let scrollTimeout: ReturnType<typeof setTimeout>
    const handleScroll = () => {
      clearTimeout(scrollTimeout)
      scrollTimeout = setTimeout(updatePosition, 16)
    }

    window.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', updatePosition)

    return () => {
      window.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', updatePosition)
      clearTimeout(scrollTimeout)
    }
  }, [open])

  const contextValue = useMemo(
    () => ({ open, onOpenChange, triggerRef, anchorRect }),
    [open, onOpenChange, anchorRect]
  )

  return (
    <StablePopoverContext.Provider value={contextValue}>
      <PopoverPrimitive.Root open={open} onOpenChange={onOpenChange}>
        {children}
      </PopoverPrimitive.Root>
    </StablePopoverContext.Provider>
  )
}

interface StablePopoverTriggerProps {
  children: React.ReactNode
  asChild?: boolean
  className?: string
}

export function StablePopoverTrigger({
  children,
  asChild = false,
  className,
}: StablePopoverTriggerProps) {
  const { triggerRef } = useStablePopoverContext()

  return (
    <PopoverPrimitive.Trigger ref={triggerRef} asChild={asChild} className={className}>
      {children}
    </PopoverPrimitive.Trigger>
  )
}

interface StablePopoverContentProps {
  children: React.ReactNode
  className?: string
  align?: 'start' | 'center' | 'end'
  sideOffset?: number
  collisionPadding?: number
}

export function StablePopoverContent({
  children,
  className,
  align = 'start',
  sideOffset = 8,
  collisionPadding = 12,
}: StablePopoverContentProps) {
  const { anchorRect, open } = useStablePopoverContext()
  const contentRef = useRef<HTMLDivElement>(null)
  const [position, setPosition] = useState<{ top: number; left: number } | null>(null)
  const [measuredHeight, setMeasuredHeight] = useState(0)

  // Calculate position based on anchor rect
  const calculatePosition = useCallback(() => {
    if (!anchorRect || !contentRef.current) return null

    const contentRect = contentRef.current.getBoundingClientRect()
    const viewportWidth = window.innerWidth
    const viewportHeight = window.innerHeight

    // Start with position below the anchor
    let top = anchorRect.bottom + sideOffset
    let left: number

    // Calculate left position based on alignment
    switch (align) {
      case 'start':
        left = anchorRect.left
        break
      case 'center':
        left = anchorRect.left + (anchorRect.width - contentRect.width) / 2
        break
      case 'end':
        left = anchorRect.right - contentRect.width
        break
    }

    // Collision detection - horizontal
    if (left < collisionPadding) {
      left = collisionPadding
    } else if (left + contentRect.width > viewportWidth - collisionPadding) {
      left = viewportWidth - contentRect.width - collisionPadding
    }

    // Collision detection - vertical (flip to top if not enough space below)
    if (top + contentRect.height > viewportHeight - collisionPadding) {
      const topPosition = anchorRect.top - contentRect.height - sideOffset
      if (topPosition >= collisionPadding) {
        top = topPosition
      }
    }

    return { top, left }
  }, [anchorRect, align, sideOffset, collisionPadding])

  // Measure content height after render
  useEffect(() => {
    if (open && contentRef.current) {
      const height = contentRef.current.getBoundingClientRect().height
      if (height !== measuredHeight) {
        setMeasuredHeight(height)
      }
    }
  }, [open, children, measuredHeight])

  // Update position when anchor rect changes or content is measured
  useEffect(() => {
    if (!open || !anchorRect) {
      setPosition(null)
      return
    }

    // Use requestAnimationFrame to ensure content is measured
    const frame = requestAnimationFrame(() => {
      const newPosition = calculatePosition()
      if (newPosition) {
        setPosition(newPosition)
      }
    })

    return () => cancelAnimationFrame(frame)
  }, [open, anchorRect, calculatePosition, measuredHeight])

  if (!open) return null

  return (
    <PopoverPrimitive.Portal forceMount>
      <PopoverPrimitive.Content
        ref={contentRef}
        forceMount
        onOpenAutoFocus={(e) => {
          // Prevent auto-focus stealing from search input
          e.preventDefault()
        }}
        style={
          position
            ? {
                position: 'fixed',
                top: position.top,
                left: position.left,
                // Prevent Radix from overriding our position
                transform: 'none',
              }
            : {
                // Initial render - invisible until positioned
                position: 'fixed',
                opacity: 0,
                pointerEvents: 'none',
              }
        }
        className={cn(
          'z-50 rounded-xl border border-border bg-background shadow-medium outline-none',
          'data-[state=open]:animate-in data-[state=closed]:animate-out',
          'data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
          'data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95',
          className
        )}
      >
        {children}
      </PopoverPrimitive.Content>
    </PopoverPrimitive.Portal>
  )
}

// Export a hook for creating stable multi-select popovers
export function useStableMultiSelect<T>(
  initialSelected: T[] = [],
  onChange?: (selected: T[]) => void
) {
  const [selected, setSelected] = useState<T[]>(initialSelected)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const toggle = useCallback(
    (item: T) => {
      setSelected((prev) => {
        const newSelected = prev.includes(item)
          ? prev.filter((i) => i !== item)
          : [...prev, item]
        onChange?.(newSelected)
        return newSelected
      })
    },
    [onChange]
  )

  const remove = useCallback(
    (item: T) => {
      setSelected((prev) => {
        const newSelected = prev.filter((i) => i !== item)
        onChange?.(newSelected)
        return newSelected
      })
    },
    [onChange]
  )

  return {
    selected,
    setSelected,
    popoverOpen,
    setPopoverOpen,
    toggle,
    remove,
  }
}
