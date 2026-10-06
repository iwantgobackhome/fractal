import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ProviderCard } from './ProviderSetup';
import { AiConnection } from './settings-parts';
import type { HubApi, ProviderStatus } from './hub-api';

describe('Hub-provided installation commands', () => {
  it.each([
    ['codex', 'brew install --cask codex'],
    ['codex', 'npm install -g @openai/codex'],
    ['claude', 'curl -fsSL https://claude.ai/install.sh | bash'],
    ['claude', 'irm https://claude.ai/install.ps1 | iex'],
  ] as const)('shows the Hub command for %s in onboarding and settings', (id, installCommand) => {
    const status: ProviderStatus = { id, installCommand, installed: false, loggedIn: false, version: null, models: [] };
    const hub = { installStatus: async () => null } as unknown as HubApi;
    const onboarding = renderToStaticMarkup(<ProviderCard hub={hub} status={status} account={undefined} onChange={() => {}} />);
    const settings = renderToStaticMarkup(<AiConnection providers={[status]} onRecheck={() => {}} checking={false} />);
    expect(onboarding).toContain(installCommand);
    expect(settings).toContain(installCommand);
  });
});
