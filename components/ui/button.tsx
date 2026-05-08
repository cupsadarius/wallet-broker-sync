import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Primary CTA — solid Mercury Blue, Pure White text. The single accent.
        default:
          "bg-primary text-primary-foreground hover:bg-primary/90 [a]:hover:bg-primary/90",
        // Header pill / secondary CTA — translucent Ghost Blue.
        outline:
          "bg-ghost-blue/15 text-foreground hover:bg-ghost-blue/25 aria-expanded:bg-ghost-blue/25",
        secondary:
          "bg-graphite text-foreground hover:bg-graphite/80 aria-expanded:bg-graphite",
        ghost:
          "text-foreground hover:bg-graphite/60 aria-expanded:bg-graphite/60",
        destructive:
          "bg-destructive/15 text-destructive hover:bg-destructive/25 focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline rounded-none",
      },
      size: {
        // Primary pill — 16px / 24px padding per design tokens.
        default: "h-10 gap-2 px-6 has-data-[icon=inline-end]:pr-5 has-data-[icon=inline-start]:pl-5",
        xs: "h-7 gap-1 px-3 text-xs",
        sm: "h-8 gap-1.5 px-4 text-[13px]",
        // Header pill — 8px / 20px padding per design.
        lg: "h-11 gap-2 px-7 text-[15px]",
        icon: "size-10 rounded-full",
        "icon-xs": "size-7 rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-full",
        "icon-lg": "size-11 rounded-full",
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
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
