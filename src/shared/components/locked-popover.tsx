import * as React from 'react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/shared/lib/utils'

interface LockedPosition {
  top: number
  left: number
  openUpward: boolean
}

interface LockedPopoverProps {
  /** Ref to the anchor element (e.g., the "Ajouter un motif…" button) */
  anchorRef: React.RefObject<HTMLElement | null>
  /** Whether the popover is open */
  open: boolean
  /** Callback when open state should change */
  onOpenChange: (open: boolean) => void
  /** Content to render in the popover */
  children: React.ReactNode
  /** Width of the popover (default: 320px) */
  width?: number
  /** Offset from anchor (default: 8px) */
  offset?: number
  /** Padding from viewport edges (default: 12px) */
  collisionPadding?: number
  /** Additional className for the popover container */
  className?: string
}

/**
 * LockedPopover - A popover that locks its position while open.
 *
 * Unlike Radix Popover, this component:
 * 1. Captures the anchor's position when opened
 * 2. Uses position: fixed with those exact coordinates
 * 3. NEVER recomputes position when anchor/layout changes (e.g., chip wrap)
 * 4. Only updates position on window scroll/resize
 * 5. Renders in a portal to avoid container clipping
 *
 * This ensures the dropdown stays pinned under the trigger even when
 * chips wrap to new lines and change the layout height.
 */
export function LockedPopover({
  anchorRef,
  open,
  onOpenChange,
  children,
  width = 320,
  offset = 8,
  collisionPadding = 12,
  className,
}: LockedPopoverProps) {
  const contentRef = useRef<HTMLDivElement>(null)
  const [lockedPosition, setLockedPosition] = useState<LockedPosition | null>(null)
  const [isVisible, setIsVisible] = useState(false)
  const [contentHeight, setContentHeight] = useState(0)

  // Calculate and lock position based on anchor
  const calculatePosition = useCallback((): LockedPosition | null => {
    if (!anchorRef.current) return null

    const anchorRect = anchorRef.current.getBoundingClientRect()
    const viewportHeight = window.innerHeight
    const viewportWidth = window.innerWidth

    // Start with position below the anchor
    let top = anchorRect.bottom + offset
    let left = anchorRect.left
    let openUpward = false

    // Horizontal collision: clamp to viewport
    if (left + width > viewportWidth - collisionPadding) {
      left = viewportWidth - width - collisionPadding
    }
    if (left < collisionPadding) {
      left = collisionPadding
    }

    // Vertical collision: flip upward if not enough space below
    const estimatedHeight = contentHeight || 400 // Use measured height or estimate
    if (top + estimatedHeight > viewportHeight - collisionPadding) {
      const topPosition = anchorRect.top - estimatedHeight - offset
      if (topPosition >= collisionPadding) {
        top = topPosition
        openUpward = true
      }
      // If neither direction fits well, stick with bottom but allow scroll
    }

    return { top, left, openUpward }
  }, [anchorRef, width, offset, collisionPadding, contentHeight])

  // Lock position when opening
  useEffect(() => {
    if (open) {
      // Small delay to ensure anchor is rendered
      requestAnimationFrame(() => {
        const position = calculatePosition()
        if (position) {
          setLockedPosition(position)
          setIsVisible(true)
        }
      })
    } else {
      setIsVisible(false)
      // Delay clearing position to allow exit animation
      const timeout = setTimeout(() => {
        setLockedPosition(null)
        setContentHeight(0)
      }, 200)
      return () => clearTimeout(timeout)
    }
  }, [open, calculatePosition])

  // Measure content height after render (for collision detection)
  useEffect(() => {
    if (open && contentRef.current && isVisible) {
      const height = contentRef.current.getBoundingClientRect().height
      if (height > 0 && height !== contentHeight) {
        setContentHeight(height)
        // Recalculate position with actual height
        const newPosition = calculatePosition()
        if (newPosition) {
          setLockedPosition(newPosition)
        }
      }
    }
  }, [open, isVisible, contentHeight, calculatePosition])

  // Update position ONLY on scroll/resize (not on layout changes)
  useEffect(() => {
    if (!open || !isVisible) return

    const updatePosition = () => {
      const position = calculatePosition()
      if (position) {
        setLockedPosition(position)
      }
    }

    // Debounced scroll handler for performance
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
  }, [open, isVisible, calculatePosition])

  // Handle outside click
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const isInsideContent = contentRef.current?.contains(target)
      const isInsideAnchor = anchorRef.current?.contains(target)

      if (!isInsideContent && !isInsideAnchor) {
        onOpenChange(false)
      }
    }

    // Delay to prevent immediate close on the click that opened it
    const timeout = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside)
    }, 0)

    return () => {
      clearTimeout(timeout)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [open, onOpenChange, anchorRef])

  // Handle escape key
  useEffect(() => {
    if (!open) return

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    document.addEventListener('keydown', handleEscape)
    return () => document.removeEventListener('keydown', handleEscape)
  }, [open, onOpenChange])

  // Don't render if not open or no position
  if (!open) return null

  const content = (
    <div
      ref={contentRef}
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        top: lockedPosition?.top ?? -9999,
        left: lockedPosition?.left ?? -9999,
        width,
        zIndex: 9999,
        opacity: isVisible && lockedPosition ? 1 : 0,
        pointerEvents: isVisible && lockedPosition ? 'auto' : 'none',
        transformOrigin: lockedPosition?.openUpward ? 'bottom' : 'top',
      }}
      className={cn(
        'rounded-xl border border-border bg-background shadow-lg outline-none',
        'transition-opacity duration-150',
        isVisible && 'animate-in fade-in-0 zoom-in-95',
        className
      )}
    >
      {children}
    </div>
  )

  // Render in portal to escape parent container clipping
  return createPortal(content, document.body)
}

/**
 * Hook to manage locked popover state and anchor ref together
 */
export function useLockedPopover() {
  const anchorRef = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)

  return {
    anchorRef,
    open,
    setOpen,
    popoverProps: {
      anchorRef,
      open,
      onOpenChange: setOpen,
    },
  }
}
