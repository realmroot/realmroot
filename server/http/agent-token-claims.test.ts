import { readRealmrootAgentBinding } from '@server/http/agent-token-claims'
import { realmrootAgentBindingClaim } from '@shared/oauth-token-profile'
import { describe, expect, it } from 'vitest'

describe('Agent token claims', () => {
  it('preserves the raw runtime session identifier', () => {
    expect(
      readRealmrootAgentBinding({
        [realmrootAgentBindingClaim]: {
          protocol_agent_id: 'protocol-agent-1',
          host_id: 'host-1',
          runtime: 'codex',
          session_id: 'thread/raw:+123',
        },
      }),
    ).toEqual({
      protocol_agent_id: 'protocol-agent-1',
      host_id: 'host-1',
      runtime: 'codex',
      session_id: 'thread/raw:+123',
    })
  })

  it('accepts a legacy binding without runtime session context', () => {
    expect(
      readRealmrootAgentBinding({
        [realmrootAgentBindingClaim]: { protocol_agent_id: 'protocol-agent-1', host_id: 'host-1' },
      }),
    ).toEqual({ protocol_agent_id: 'protocol-agent-1', host_id: 'host-1' })
  })

  it('rejects partial or oversized runtime session context', () => {
    expect(() =>
      readRealmrootAgentBinding({
        [realmrootAgentBindingClaim]: {
          protocol_agent_id: 'protocol-agent-1',
          host_id: 'host-1',
          runtime: 'codex',
        },
      }),
    ).toThrow('runtime session binding')
    expect(() =>
      readRealmrootAgentBinding({
        [realmrootAgentBindingClaim]: {
          protocol_agent_id: 'protocol-agent-1',
          host_id: 'host-1',
          runtime: 'codex',
          session_id: 'x'.repeat(1025),
        },
      }),
    ).toThrow('runtime session binding')
  })
})
