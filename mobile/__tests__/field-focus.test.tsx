/**
 * Focus has to be visible without colour.
 *
 * The field proved it was focused by swapping its border from the grey outline
 * to saffron and changing nothing else. That is meaning carried by colour
 * alone, which section 3 forbids, and it is the one control in a form where
 * knowing which of several identical boxes you are typing into matters most.
 *
 * The box must also not move when it happens. A border that thickens without
 * the padding giving back what it takes shifts the text under the cursor by a
 * pixel on every focus and blur.
 */

import { render, fireEvent } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';

import { Field } from '../components/ui/Field';
import { Select } from '../components/ui/Select';
import { ThemeProvider } from '../theme';

function styleOf(node: { props: Record<string, unknown> }) {
  return StyleSheet.flatten(node.props.style as never) as Record<string, number | string>;
}

function mount() {
  const screen = render(
    <ThemeProvider>
      <Field label="Email" placeholder="you@example.com" />
    </ThemeProvider>,
  );
  return screen.getByPlaceholderText('you@example.com');
}

describe('a text field next to a select', () => {
  it('is not the same filled pill with the chevron taken off', () => {
    const screen = render(
      <ThemeProvider>
        <Field label="Dish" placeholder="What was it" />
        <Select label="Category" value={null} options={[]} onChange={() => {}} />
      </ThemeProvider>,
    );
    const field = styleOf(screen.getByPlaceholderText('What was it'));
    const select = StyleSheet.flatten(
      (screen.getByLabelText('Category').props.style as never) ?? {},
    ) as Record<string, unknown>;

    // Typing goes in an outlined box; choosing opens from a filled one.
    expect(field.backgroundColor).toBe('transparent');
    expect(select.backgroundColor).not.toBe('transparent');
    expect(select.backgroundColor).toBeTruthy();
  });
});

describe('a focused text field', () => {
  it('changes more than its colour', () => {
    const input = mount();
    const before = styleOf(input);

    fireEvent(input, 'focus');
    const after = styleOf(input);

    expect(after.borderColor).not.toBe(before.borderColor);
    // The part that does not depend on being able to see the colour.
    expect(after.borderWidth).toBeGreaterThan(Number(before.borderWidth));
  });

  it('does not move the text when it gains or loses focus', () => {
    const input = mount();
    const before = styleOf(input);

    fireEvent(input, 'focus');
    const after = styleOf(input);

    // Border plus padding is what positions the text, so the two have to add up
    // to the same number in both states.
    const box = (s: Record<string, number | string>) => ({
      h: Number(s.borderWidth) + Number(s.paddingHorizontal),
      v: Number(s.borderWidth) + Number(s.paddingVertical),
    });
    expect(box(after)).toEqual(box(before));
  });

  it('goes back to the quiet edge on blur', () => {
    const input = mount();
    const resting = styleOf(input);

    fireEvent(input, 'focus');
    fireEvent(input, 'blur');

    expect(styleOf(input).borderWidth).toBe(resting.borderWidth);
    expect(styleOf(input).borderColor).toBe(resting.borderColor);
  });
});
