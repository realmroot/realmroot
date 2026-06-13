export type EmailTemplate =
  | {
      type: 'verification'
      url: string
    }
  | {
      type: 'password-reset'
      url: string
    }
  | {
      type: 'invitation'
      url: string
      inviterName: string
    }
  | {
      type: 'otp'
      otp: string
    }
  | {
      type: 'security-notification'
      title: string
      body: string
    }

export interface RenderedEmail {
  subject: string
  text: string
  html: string
}

export function renderEmailTemplate(template: EmailTemplate): RenderedEmail {
  if (template.type === 'verification') {
    return renderActionEmail('Verify your email address', 'Verify your email address', template.url)
  }

  if (template.type === 'password-reset') {
    return renderActionEmail('Reset your password', 'Reset your FlareAuth password', template.url)
  }

  if (template.type === 'invitation') {
    return renderActionEmail(
      'You were invited to FlareAuth',
      `${template.inviterName} invited you to FlareAuth`,
      template.url,
    )
  }

  if (template.type === 'otp') {
    return {
      subject: 'Your FlareAuth code',
      text: `Your one-time code is ${template.otp}.`,
      html: `<p>Your one-time code is <strong>${escapeHtml(template.otp)}</strong>.</p>`,
    }
  }

  return {
    subject: template.title,
    text: template.body,
    html: `<p>${escapeHtml(template.body)}</p>`,
  }
}

function renderActionEmail(subject: string, heading: string, url: string): RenderedEmail {
  return {
    subject,
    text: `${heading}\n\n${url}`,
    html: `<p>${escapeHtml(heading)}</p><p><a href="${escapeAttribute(url)}">${escapeHtml(url)}</a></p>`,
  }
}

function escapeHtml(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
}

function escapeAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', '&quot;')
}
