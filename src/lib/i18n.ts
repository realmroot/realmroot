import type { TOptions } from 'i18next'
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'

export const supportedLanguages = ['en', 'zh'] as const
export type SupportedLanguage = (typeof supportedLanguages)[number]

export const languageStorageKey = 'realmroot.language'
export const localeCookieName = 'realmroot_locale'

import { zhFlatTranslations } from './i18n-zh'

const resources = {
  en: {
    translation: {
      account: {
        loading: 'Loading account',
        settings: 'Account settings',
        signOut: 'Sign out',
        title: 'Your account',
      },
      auth: {
        accountRecovery: 'Account recovery',
        back: 'Back',
        backToSignIn: 'Back to sign in',
        callback: 'Callback',
        checkingCallback: 'Checking callback state',
        emailVerification: 'Email verification',
        hostedAuthentication: 'Hosted authentication',
        hostedLegalLinks: 'Hosted authentication legal links',
        hostedSignIn: 'Hosted sign-in',
        loadingSignInOptions: 'Loading sign-in options',
        poweredBy: 'Powered by {{productName}}',
        signInDescription: 'Use one of the enabled methods to access this application.',
        signInTitle: 'Sign in to continue.',
      },
      common: {
        account: 'Account',
        adminConsole: 'Admin Console',
        applications: 'Applications',
        back: 'Back',
        change: 'Change',
        dark: 'Dark',
        default: 'Default',
        language: 'Language',
        light: 'Light',
        profile: 'Profile',
        security: 'Security',
        signIn: 'Sign in',
        signOut: 'Sign out',
        theme: 'Theme',
        users: 'Users',
      },
      console: {
        accountMenu: 'Account menu',
        authentication: 'Authentication',
        authorization: 'Authorization',
        closeNavigation: 'Close console navigation',
        console: 'Console',
        dashboard: 'Dashboard',
        developer: 'Developer',
        dismissNavigation: 'Dismiss console navigation',
        mobileNavigation: 'Console mobile',
        overview: 'Overview',
        signInAccount: 'Sign-in & account',
        tenant: 'Tenant',
      },
    },
  },
  zh: {
    translation: {
      ...zhFlatTranslations,
      account: {
        loading: '正在加载账户',
        settings: '账户设置',
        signOut: '退出登录',
        title: '你的账户',
      },
      auth: {
        accountRecovery: '账户恢复',
        back: '返回',
        backToSignIn: '返回登录',
        callback: '回调',
        checkingCallback: '正在检查回调状态',
        chooseRecoveryMethod: '选择恢复方式',
        emailVerification: '邮箱验证',
        hostedAuthentication: '托管认证',
        hostedLegalLinks: '托管认证法律链接',
        hostedSignIn: '托管登录',
        loadingSignInOptions: '正在加载登录选项',
        poweredBy: '由 {{productName}} 提供支持',
        signInTitle: '登录以继续。',
        signInDescription: '使用已启用的方式访问此应用。',
      },
      common: {
        account: '账户',
        adminConsole: '管理控制台',
        applications: '应用',
        back: '返回',
        change: '更改',
        dark: '深色',
        default: '默认',
        language: '语言',
        light: '浅色',
        profile: '资料',
        security: '安全',
        signIn: '登录',
        signOut: '退出登录',
        theme: '主题',
        users: '用户',
      },
      console: {
        accountMenu: '账户菜单',
        authentication: '认证',
        authorization: '授权',
        closeNavigation: '关闭控制台导航',
        console: '控制台',
        dashboard: '仪表盘',
        developer: '开发者',
        dismissNavigation: '关闭控制台导航',
        mobileNavigation: '控制台移动导航',
        overview: '概览',
        signInAccount: '登录和账户',
        tenant: '租户',
      },
    },
  },
} as const

void i18n.use(initReactI18next).init({
  fallbackLng: 'en',
  interpolation: {
    escapeValue: false,
  },
  lng: readStoredLanguage(),
  resources,
})

i18n.on('languageChanged', (language) => {
  const nextLanguage = normalizeLanguage(language)
  document.documentElement.lang = nextLanguage === 'zh' ? 'zh-CN' : 'en'
  window.localStorage.setItem(languageStorageKey, nextLanguage)
  // Better Auth's i18n plugin detects the locale from a regular request cookie.
  // biome-ignore lint/suspicious/noDocumentCookie: Cookie Store API support is not universal enough here.
  document.cookie = `${localeCookieName}=${nextLanguage}; Path=/; Max-Age=31536000; SameSite=Lax`
})

document.documentElement.lang = i18n.language === 'zh' ? 'zh-CN' : 'en'

export function normalizeLanguage(language: string | undefined): SupportedLanguage {
  return language === 'zh' || language?.startsWith('zh-') ? 'zh' : 'en'
}

export function tt(key: string, options?: TOptions) {
  return i18n.t(key, { defaultValue: key, ...options })
}

function readStoredLanguage(): SupportedLanguage {
  return normalizeLanguage(window.localStorage.getItem(languageStorageKey) ?? navigator.language)
}

export { i18n }
