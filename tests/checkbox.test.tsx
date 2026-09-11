import { useState } from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, test, vi } from 'vitest';
import { StyledCheckbox } from '@/components/common/StyledCheckbox';

test('Tab focuses the checkbox and Space toggles selection without opening the row', async () => {
  const rowClick = vi.fn();
  const changed = vi.fn();
  function Row() {
    const [checked, setChecked] = useState(false);
    return <div onClick={rowClick}><StyledCheckbox aria-label="Select file.txt" checked={checked} onChange={event => { changed(event.target.checked); setChecked(event.target.checked); }} /></div>;
  }
  render(<Row />);
  const user = userEvent.setup();
  const checkbox = screen.getByRole('checkbox', { name: 'Select file.txt' }) as HTMLInputElement;
  await user.tab();
  expect(document.activeElement).toBe(checkbox);
  await user.keyboard(' ');
  expect(checkbox.checked).toBe(true);
  expect(changed).toHaveBeenLastCalledWith(true);
  await user.keyboard(' ');
  expect(checkbox.checked).toBe(false);
  expect(changed).toHaveBeenLastCalledWith(false);
  expect(rowClick).not.toHaveBeenCalled();
});

test('indeterminate selection is exposed on the native checkbox', () => {
  const view = render(<StyledCheckbox aria-label="Select all objects" checked={false} indeterminate onChange={vi.fn()} />);
  const checkbox = screen.getByRole('checkbox', { name: 'Select all objects' }) as HTMLInputElement;
  expect(checkbox.indeterminate).toBe(true);
  view.rerender(<StyledCheckbox aria-label="Select all objects" checked indeterminate={false} onChange={vi.fn()} />);
  expect(checkbox.indeterminate).toBe(false);
  expect(checkbox.checked).toBe(true);
});
