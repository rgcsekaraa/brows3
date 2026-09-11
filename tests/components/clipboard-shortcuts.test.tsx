import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, test, vi } from 'vitest';
import { readText } from '@tauri-apps/plugin-clipboard-manager';
import { useClipboardShortcuts } from '@/hooks/useClipboardShortcuts';

vi.mock('@/lib/tauri', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({ readText: vi.fn().mockResolvedValue('paste') }));

function Fields() {
  useClipboardShortcuts();
  return <><input type="checkbox" aria-label="Select object" /><input aria-label="Name" defaultValue="abcd" /></>;
}

test('selection checkboxes leave paste available to object operations', () => {
  render(<Fields />);
  const checkbox = screen.getByRole('checkbox');
  checkbox.focus();
  const event = new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true, cancelable: true });
  fireEvent(checkbox, event);
  expect(event.defaultPrevented).toBe(false);
  expect(readText).not.toHaveBeenCalled();
});

test('text fields still receive native clipboard text at the selection', async () => {
  render(<Fields />);
  const input = screen.getByRole('textbox') as HTMLInputElement;
  input.focus();
  input.setSelectionRange(1, 3);
  fireEvent.keyDown(input, { key: 'v', ctrlKey: true });
  await waitFor(() => expect(input.value).toBe('apasted'));
  expect(readText).toHaveBeenCalledTimes(1);
});
