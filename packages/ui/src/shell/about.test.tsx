import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { AboutContent, AboutSection, type CheckResult } from './AboutSection';
import type { DesktopUpdates } from '../updates/UpdateToast';
import hubPackage from '../../../hub/package.json';
import { t } from '../i18n';

const updates: DesktopUpdates = { check: async () => ({ status: 'current' }), download: async () => {}, install: async () => {}, onEvent: () => () => {} };
function render(result: CheckResult, updater?: DesktopUpdates) {
  return renderToStaticMarkup(<AboutContent version="9.8.7" updates={updater} result={result} onCheck={() => {}} />);
}
describe('Settings version and updates', () => {
  it('shows the supplied shell version', () => expect(render({ status: 'idle' })).toContain('9.8.7'));
  it('uses the Hub package version in browser mode', () => expect(renderToStaticMarkup(<AboutSection />)).toContain(hubPackage.version));
  it('hides the update button without an updater', () => expect(render({ status: 'idle' })).not.toContain('<button'));
  it('shows the update button with an updater', () => expect(render({ status: 'idle' }, updates)).toContain(t('settings.checkUpdates')));
  it('disables checks while checking', () => {
    const markup = render({ status: 'checking' }, updates);
    expect(markup).toContain('disabled=""');
    expect(markup).toContain(t('settings.checkingUpdates'));
  });
  it('renders up-to-date, available, and error states inline', () => {
    expect(render({ status: 'current' }, updates)).toContain(t('settings.upToDate'));
    expect(render({ status: 'available', version: '9.9.0' }, updates)).toContain(t('updates.available', { version: '9.9.0' }));
    expect(render({ status: 'error', error: 'Network unavailable' }, updates)).toContain('Network unavailable');
  });
});
