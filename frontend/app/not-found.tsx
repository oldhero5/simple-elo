import { LinkButton, PageHeader } from '@/components/ui'

export default function NotFound() {
  return (
    <div className="space-y-6">
      <PageHeader title="Page not found" description="There is nothing at this address." />
      <LinkButton href="/">Go to the dashboard</LinkButton>
    </div>
  )
}
