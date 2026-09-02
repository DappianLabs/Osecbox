"use client"

import React from "react"
import * as ResizablePrimitive from "react-resizable-panels"

import { cn } from "@/lib/utils"

const ResizablePanelGroup = ({
  className,
  ...props
}: React.ComponentProps<typeof ResizablePrimitive.PanelGroup>) => (
  <ResizablePrimitive.PanelGroup
    className={cn(
      "flex h-full w-full data-[panel-group-direction=vertical]:flex-col",
      className
    )}
    style={{
      contain: 'layout style',
    }}
    {...props}
  />
)

const ResizablePanel = React.forwardRef<
  React.ElementRef<typeof ResizablePrimitive.Panel>,
  React.ComponentProps<typeof ResizablePrimitive.Panel>
>(({ className, style, ...props }, ref) => (
  <ResizablePrimitive.Panel
    ref={ref}
    className={cn(className)}
    style={{
      ...style,
      willChange: 'auto',
      transform: 'translateZ(0)',
    }}
    {...props}
  />
))
ResizablePanel.displayName = "ResizablePanel"

/**
 * ResizeGrip — the subtle, grabbable affordance shown on a divider.
 *
 * Size is driven in JS (plain Tailwind classes that always compile) so the
 * affordance remains visible regardless of arbitrary-variant generation.
 *
 * `direction` is the parent panel-group direction:
 *   "vertical"   => panels stacked (e.g. terminal at the bottom) =>
 *                   HORIZONTAL divider => a wide pill you drag up/down.
 *   "horizontal" => panels side-by-side => VERTICAL divider =>
 *                   a tall pill you drag left/right.
 *
 * `active` forces the dragging look (used by custom resizers that don't expose
 * react-resizable-panels' `data-resize-handle-state`).
 */
const ResizeGrip = ({
  active = false,
  direction = "vertical",
  className,
}: {
  active?: boolean;
  direction?: "horizontal" | "vertical";
  className?: string;
}) => {
  const isHorizontalDivider = direction === "vertical";
  return (
    <div
      aria-hidden
      className={cn(
        "pointer-events-none relative flex items-center justify-center",
        "transition-[color,opacity,filter,transform] duration-150 ease-out origin-center",
        "shrink-0",
        // A compact glass capsule with a six-dot grip reads as an affordance,
        // not as a solid legacy divider block.
        isHorizontalDivider ? "h-2 w-10" : "h-10 w-2",
        "group-data-[panel-group-direction=horizontal]:h-10 group-data-[panel-group-direction=horizontal]:w-2",
        "text-slate-400/75 opacity-70 group-hover:text-sky-200/95 group-hover:opacity-100 group-hover:drop-shadow-[0_0_5px_rgba(125,211,252,0.35)]",
        "group-data-[resize-handle-state=drag]:text-sky-100 group-data-[resize-handle-state=drag]:opacity-100 group-data-[resize-handle-state=drag]:drop-shadow-[0_0_6px_rgba(125,211,252,0.55)]",
        // Forced active look for custom resizers
        active && "text-sky-100 opacity-100 drop-shadow-[0_0_6px_rgba(125,211,252,0.55)]",
        className
      )}
      style={{ WebkitUserSelect: "none", userSelect: "none" }}
    >
      <span
        className={cn(
          "flex shrink-0 items-center justify-center gap-1.5",
          isHorizontalDivider
            ? "h-[3px] w-8 flex-row"
            : "h-8 w-[3px] flex-col",
          "transition-transform duration-150 group-hover:scale-110 group-data-[resize-handle-state=drag]:scale-125"
        )}
      >
        {Array.from({ length: 3 }, (_, index) => (
          <span
            key={index}
            className="h-[3px] w-[3px] shrink-0 rounded-full bg-current"
          />
        ))}
      </span>
    </div>
  );
};

const ResizableHandle = ({
  withHandle,
  className,
  ...props
}: Omit<React.ComponentProps<typeof ResizablePrimitive.PanelResizeHandle>, 'ref'> & {
  withHandle?: boolean;
  ref?: any;
}) => {
  const handleRef = React.useRef<HTMLDivElement>(null);
  const [direction, setDirection] = React.useState<"horizontal" | "vertical">("vertical");

  // Read the actual panel-group direction from the DOM (set by the library)
  // so the grip can be sized in JS instead of via fragile CSS variants.
  React.useLayoutEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;

    const readDirection = () => {
      const group = handle.closest('[data-panel-group]');
      const dir = handle.getAttribute('data-panel-group-direction') ||
        group?.getAttribute('data-panel-group-direction');
      if (dir === "horizontal" || dir === "vertical") setDirection(dir);
    };

    readDirection();
    // The panel library may finish decorating the handle in its own layout
    // effect. Re-read on the next frame so the first paint has the right axis.
    const frame = typeof requestAnimationFrame === 'function'
      ? requestAnimationFrame(readDirection)
      : undefined;
    const group = handle.closest('[data-panel-group]');
    if (typeof MutationObserver === 'undefined') return;

    // react-resizable-panels can apply the direction attribute to the handle
    // after mount. Observe both nodes so a side splitter cannot keep the
    // horizontal grip shape from its initial default.
    const observer = new MutationObserver(readDirection);
    const observerOptions = { attributes: true, attributeFilter: ['data-panel-group-direction'] };
    observer.observe(handle, observerOptions);
    if (group && group !== handle) observer.observe(group, observerOptions);
    return () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);
  
  React.useEffect(() => {
    const handle = handleRef.current;
    if (!handle) return;
    
    let isDragging = false;
    
    const onMouseDown = () => {
      isDragging = true;
      // Direction-aware cursor so horizontal dividers feel right too
      const direction = handle.getAttribute('data-panel-group-direction');
      document.body.style.cursor = direction === 'horizontal' ? 'ew-resize' : 'ns-resize';
      document.body.style.userSelect = 'none';
      
      // Add will-change during drag only
      const panelGroup = handle.closest('[data-panel-group]');
      if (panelGroup instanceof HTMLElement) {
        panelGroup.style.willChange = 'transform';
      }
    };
    
    const onMouseUp = () => {
      if (!isDragging) return;
      isDragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      
      // Remove will-change after drag
      const panelGroup = handle.closest('[data-panel-group]');
      if (panelGroup instanceof HTMLElement) {
        panelGroup.style.willChange = '';
      }
    };
    
    handle.addEventListener('mousedown', onMouseDown);
    document.addEventListener('mouseup', onMouseUp);
    
    return () => {
      handle.removeEventListener('mousedown', onMouseDown);
      document.removeEventListener('mouseup', onMouseUp);
    };
  }, []);
  
  return (
    <ResizablePrimitive.PanelResizeHandle
      ref={handleRef as any}
      aria-label="Resize panels"
      aria-orientation={direction === "horizontal" ? "vertical" : "horizontal"}
      className={cn(
        "group relative z-20 flex items-center justify-center bg-transparent",
        "hover:bg-transparent active:bg-transparent",
        "border border-transparent hover:border-transparent",
        "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-slate-400/60",
        // 12px transparent grab strip — easy to grab, lives in layout so it's never clipped
        "w-3 cursor-ew-resize",
        "data-[panel-group-direction=vertical]:h-3 data-[panel-group-direction=vertical]:w-full data-[panel-group-direction=vertical]:cursor-ns-resize",
        "select-none touch-none",
        className
      )}
      style={{
        WebkitUserSelect: 'none',
        userSelect: 'none',
        WebkitTouchCallout: 'none',
        touchAction: 'none',
      }}
      {...props}
    >
      {withHandle && <ResizeGrip direction={direction} />}
    </ResizablePrimitive.PanelResizeHandle>
  );
};

export { ResizablePanelGroup, ResizablePanel, ResizableHandle, ResizeGrip }
