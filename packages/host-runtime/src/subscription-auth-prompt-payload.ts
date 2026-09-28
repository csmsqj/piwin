/** Map agent-host auth prompts/events onto the sanitized wire payload. */
import type { AuthPromptPayload } from '@piwin/contracts';
import type { HostAuthEvent, HostAuthPrompt } from '@piwin/agent-host';

export type AuthPayloadLogin = {
  loginId: string;
  providerId: string;
};

export function promptToPayload(
  login: AuthPayloadLogin,
  promptId: string,
  prompt: HostAuthPrompt,
): AuthPromptPayload {
  return {
    loginId: login.loginId,
    promptId,
    providerId: login.providerId,
    kind: prompt.type,
    message: prompt.message,
    expectsResponse: true,
    ...(prompt.placeholder !== undefined ? { placeholder: prompt.placeholder } : {}),
    ...(prompt.options !== undefined ? { options: prompt.options } : {}),
  };
}

export function eventToPayload(
  login: AuthPayloadLogin,
  promptId: string,
  event: HostAuthEvent,
): AuthPromptPayload {
  const base = {
    loginId: login.loginId,
    promptId,
    providerId: login.providerId,
    kind: event.type,
    expectsResponse: false as const,
  };
  switch (event.type) {
    case 'auth_url':
      return {
        ...base,
        url: event.url,
        ...(event.instructions !== undefined ? { instructions: event.instructions } : {}),
      };
    case 'device_code':
      return {
        ...base,
        userCode: event.userCode,
        verificationUri: event.verificationUri,
        ...(event.intervalSeconds !== undefined ? { intervalSeconds: event.intervalSeconds } : {}),
        ...(event.expiresInSeconds !== undefined
          ? { expiresInSeconds: event.expiresInSeconds }
          : {}),
      };
    case 'progress':
    case 'info':
      return {
        ...base,
        message: event.message,
        ...(event.type === 'info' && event.links !== undefined ? { links: event.links } : {}),
      };
  }
}
