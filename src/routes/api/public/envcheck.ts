import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/api/public/envcheck')({
  server: {
    handlers: {
      GET: async () => {
        const keys = Object.keys(process.env ?? {}).filter((k) => k.includes('LOVABLE'))
        return Response.json({ keys, present: !!process.env['LOVABLE_API_KEY'] })
      },
    },
  },
})
