import { defineCatalog } from '@json-render/core'
import { schema } from '@json-render/react/schema'
import { z } from 'zod'

const xyChart = (kind: string) => ({
  props: z.object({
    title: z.string().nullish(),
    data: z.array(z.record(z.string(), z.union([z.string(), z.number()]))).min(1),
    xKey: z.string(),
    series: z.array(z.object({ key: z.string(), label: z.string() })).min(1),
    unit: z.string().nullish(),
  }),
  description: `${kind} chart. data: one object per x value, e.g. [{"month":"2026-01","ron":120}]. xKey: the key of the x axis. series: the numeric keys to draw, with labels. unit: e.g. "RON" or "%".`,
})

// Names and props follow @json-render/shadcn's definitions; that package needs Radix, this app uses Base UI.
export const catalog = defineCatalog(schema, {
  components: {
    Card: {
      props: z.object({ title: z.string().nullish(), description: z.string().nullish() }),
      slots: ['default'],
      description: 'Container card for a group of content.',
    },
    Stack: {
      props: z.object({
        direction: z.enum(['horizontal', 'vertical']).nullish(),
        gap: z.enum(['none', 'sm', 'md', 'lg']).nullish(),
      }),
      slots: ['default'],
      description: 'Flex container for layouts.',
    },
    Heading: {
      props: z.object({ text: z.string(), level: z.enum(['h2', 'h3', 'h4']).nullish() }),
      description: 'Section heading.',
    },
    Text: {
      props: z.object({ text: z.string(), variant: z.enum(['body', 'caption', 'muted', 'lead']).nullish() }),
      description: 'Paragraph text.',
    },
    Badge: {
      props: z.object({ text: z.string(), variant: z.enum(['default', 'secondary', 'destructive', 'outline']).nullish() }),
      description: 'Small status label.',
    },
    Table: {
      props: z.object({ columns: z.array(z.string()), rows: z.array(z.array(z.string())), caption: z.string().nullish() }),
      description: 'Data table. columns: header labels. rows: 2D array of cell strings.',
    },
    LineChart: xyChart('Line'),
    AreaChart: xyChart('Area'),
    BarChart: xyChart('Bar'),
    PieChart: {
      props: z.object({
        title: z.string().nullish(),
        data: z.array(z.object({ name: z.string(), value: z.number().nonnegative() })).min(1),
        unit: z.string().nullish(),
      }),
      description: 'Allocation (donut) chart: the share of each part in a whole, e.g. holdings by asset.',
    },
  },
  actions: {},
})
