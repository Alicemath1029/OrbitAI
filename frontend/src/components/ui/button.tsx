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

import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-out disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 outline-none focus-visible:border-ring focus-visible:ring-ring/25 focus-visible:ring-[3px] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      variant: {
        default:
          "border border-primary/45 bg-primary text-primary-foreground shadow-[0_0_0_1px_var(--primary-glow-soft),0_12px_28px_-18px_var(--primary)] hover:bg-primary/90 hover:shadow-[0_0_0_1px_var(--primary-glow),0_0_34px_-18px_var(--primary)] active:translate-y-px",
        destructive:
          "bg-destructive text-white shadow-[0_8px_18px_-12px_var(--destructive)] hover:bg-destructive/90 focus-visible:ring-destructive/20 active:translate-y-px dark:focus-visible:ring-destructive/40",
        outline:
          "border border-border/80 bg-card/58 shadow-xs backdrop-blur-sm hover:border-primary/45 hover:bg-accent/72 hover:text-accent-foreground hover:shadow-[0_0_0_1px_var(--primary-glow-soft)] dark:border-input dark:bg-input/20 dark:hover:bg-input/35",
        secondary:
          "border border-border/55 bg-secondary/82 text-secondary-foreground shadow-xs hover:border-primary/30 hover:bg-secondary active:translate-y-px",
        ghost:
          "hover:bg-accent/76 hover:text-accent-foreground dark:hover:bg-accent/55",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 py-2 has-[>svg]:px-3",
        sm: "h-8 rounded-md gap-1.5 px-3 has-[>svg]:px-2.5",
        lg: "h-10 rounded-md px-6 has-[>svg]:px-4",
        icon: "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot : "button"

  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
