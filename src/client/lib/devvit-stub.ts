// Stand-ins for @devvit/web/client, used by the standalone web build.
import type { Context } from '@devvit/web/client';

export const context = {
  subredditName: undefined,
  username: undefined,
  postData: undefined
} as unknown as Context;

export function showToast(text: string | { text: string }): void {
  const msg = typeof text === 'string' ? text : text.text;
  window.dispatchEvent(new CustomEvent('mutator-toast', { detail: msg }));
}

export function navigateTo(url: string | { url: string }): void {
  window.open(typeof url === 'string' ? url : url.url, '_blank', 'noopener');
}

export function navigateToPost(): void {}

export function showLoginPrompt(): void {
  showToast('Logging in only applies on Reddit.');
}

export function requestExpandedMode(): void {
  window.location.href = 'game.html';
}

export function exitExpandedMode(): void {
  window.location.href = 'splash.html';
}

export function getWebViewMode(): 'inline' | 'expanded' {
  return window.location.pathname.endsWith('splash.html') ? 'inline' : 'expanded';
}

export async function showShareSheet(opts: { text?: string }): Promise<void> {
  if (opts.text) await navigator.clipboard?.writeText(opts.text);
  showToast('Copied to your clipboard.');
}

export async function canRunAsUser(): Promise<boolean> {
  return false;
}
