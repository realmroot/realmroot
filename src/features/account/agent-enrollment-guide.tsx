import { Copy } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { tt } from '@/lib/i18n'

export function AgentEnrollmentGuide() {
  const [open, setOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const prompt = tt(
    'Read the Agent setup instructions at {{url}} and enroll yourself with this Realmroot deployment from your own environment. Follow the published CLI instructions, ask me to approve the controller connection when required, and verify your identity after enrollment. Never ask for my password or copy my session credentials.',
    { url: `${window.location.origin}/.well-known/agent-skills/index.json` },
  )
  return (
    <>
      <Button
        variant="outline"
        onClick={() => {
          setOpen(true)
          setCopied(false)
          setError('')
        }}
      >
        {tt('How to enroll an Agent')}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{tt('Let your Agent enroll itself')}</DialogTitle>
            <DialogDescription>
              {tt(
                'Send these instructions to your Agent. It completes enrollment in its own environment; you approve the connection when prompted.',
              )}
            </DialogDescription>
          </DialogHeader>
          <textarea
            aria-label={tt('Enrollment prompt')}
            className="min-h-48 w-full rounded-lg border bg-muted p-4 text-sm leading-7"
            readOnly
            value={prompt}
          />
          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
          <Button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(prompt)
                setCopied(true)
              } catch {
                setError(tt('Unable to copy. Select and copy the instructions above.'))
              }
            }}
          >
            <Copy />
            {copied ? tt('Copied') : tt('Copy instructions')}
          </Button>
        </DialogContent>
      </Dialog>
    </>
  )
}
