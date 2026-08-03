import { Fingerprint, Globe2, Mail, MousePointer, Smartphone, Wallet } from 'lucide-react'
import appleIcon from 'simple-icons/icons/apple.svg'
import atlassianIcon from 'simple-icons/icons/atlassian.svg'
import discordIcon from 'simple-icons/icons/discord.svg'
import dropboxIcon from 'simple-icons/icons/dropbox.svg'
import facebookIcon from 'simple-icons/icons/facebook.svg'
import figmaIcon from 'simple-icons/icons/figma.svg'
import githubIcon from 'simple-icons/icons/github.svg'
import gitlabIcon from 'simple-icons/icons/gitlab.svg'
import googleIcon from 'simple-icons/icons/google.svg'
import huggingfaceIcon from 'simple-icons/icons/huggingface.svg'
import kakaoIcon from 'simple-icons/icons/kakao.svg'
import kickIcon from 'simple-icons/icons/kick.svg'
import lineIcon from 'simple-icons/icons/line.svg'
import linearIcon from 'simple-icons/icons/linear.svg'
import naverIcon from 'simple-icons/icons/naver.svg'
import notionIcon from 'simple-icons/icons/notion.svg'
import paypalIcon from 'simple-icons/icons/paypal.svg'
import railwayIcon from 'simple-icons/icons/railway.svg'
import redditIcon from 'simple-icons/icons/reddit.svg'
import robloxIcon from 'simple-icons/icons/roblox.svg'
import spotifyIcon from 'simple-icons/icons/spotify.svg'
import tiktokIcon from 'simple-icons/icons/tiktok.svg'
import twitchIcon from 'simple-icons/icons/twitch.svg'
import vercelIcon from 'simple-icons/icons/vercel.svg'
import vkIcon from 'simple-icons/icons/vk.svg'
import wechatIcon from 'simple-icons/icons/wechat.svg'
import xIcon from 'simple-icons/icons/x.svg'
import zoomIcon from 'simple-icons/icons/zoom.svg'

type ProviderIconProps = {
  className?: string
  provider: {
    displayName: string
    icon: string
    providerId?: string
  }
}

export function ProviderIcon({ className = 'providerIcon', provider }: ProviderIconProps) {
  const socialIcon = socialIcons[provider.providerId ?? provider.icon]
  return (
    <span aria-hidden="true" className={className}>
      {provider.icon === 'email' ? <Mail size={16} /> : null}
      {provider.icon === 'phone' ? <Smartphone size={16} /> : null}
      {provider.icon === 'wallet' ? <Wallet size={16} /> : null}
      {provider.icon === 'passkey' ? <Fingerprint size={16} /> : null}
      {provider.icon === 'onetap' ? <MousePointer size={16} /> : null}
      {socialIcon ? <img alt="" src={socialIcon} /> : null}
      {!builtinIcon(provider.icon) && !socialIcon ? <Globe2 size={16} /> : null}
    </span>
  )
}

const socialIcons: Record<string, string> = {
  apple: appleIcon,
  atlassian: atlassianIcon,
  discord: discordIcon,
  dropbox: dropboxIcon,
  facebook: facebookIcon,
  figma: figmaIcon,
  github: githubIcon,
  gitlab: gitlabIcon,
  google: googleIcon,
  huggingface: huggingfaceIcon,
  kakao: kakaoIcon,
  kick: kickIcon,
  line: lineIcon,
  linear: linearIcon,
  naver: naverIcon,
  notion: notionIcon,
  paypal: paypalIcon,
  railway: railwayIcon,
  reddit: redditIcon,
  roblox: robloxIcon,
  spotify: spotifyIcon,
  tiktok: tiktokIcon,
  twitch: twitchIcon,
  twitter: xIcon,
  vercel: vercelIcon,
  vk: vkIcon,
  wechat: wechatIcon,
  zoom: zoomIcon,
}

function builtinIcon(icon: string) {
  return icon === 'email' || icon === 'phone' || icon === 'wallet' || icon === 'passkey' || icon === 'onetap'
}
