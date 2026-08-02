import { Fingerprint, Mail, MousePointer, Smartphone, Wallet } from 'lucide-react'

type ProviderIconProps = {
  className?: string
  provider: {
    displayName: string
    icon: string
    providerId?: string
  }
}

export function ProviderIcon({ className = 'providerIcon', provider }: ProviderIconProps) {
  return (
    <span aria-hidden="true" className={className}>
      {provider.icon === 'email' ? <Mail size={16} /> : null}
      {provider.icon === 'phone' ? <Smartphone size={16} /> : null}
      {provider.icon === 'wallet' ? <Wallet size={16} /> : null}
      {provider.icon === 'passkey' ? <Fingerprint size={16} /> : null}
      {provider.icon === 'onetap' ? <MousePointer size={16} /> : null}
      {!builtinIcon(provider.icon) ? (
        <span className="text-[10px] font-bold leading-none">
          {provider.displayName.trim().slice(0, 1).toUpperCase()}
        </span>
      ) : null}
    </span>
  )
}

function builtinIcon(icon: string) {
  return icon === 'email' || icon === 'phone' || icon === 'wallet' || icon === 'passkey' || icon === 'onetap'
}
