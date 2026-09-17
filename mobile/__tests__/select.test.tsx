/**
 * The searchable picker that replaces the category chips.
 *
 * There are 38 categories and 10 cuisines. As chips that is a wall of tiny text
 * that pushes the rest of the form off the screen, which is exactly what was
 * wrong with the log form. A closed field is one readable line; the list only
 * exists while it is being used.
 */

import { fireEvent, render } from '@testing-library/react-native';
import { ThemeProvider } from '../theme';
import { Select, type SelectOption } from '../components/ui/Select';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

/** A realistic slice: categories carrying their cuisine as the hint. */
const OPTIONS: SelectOption[] = [
  { value: '1', label: 'Biryani', hint: 'Desi', emoji: '\u{1F35B}', color: '#D79256' },
  { value: '2', label: 'Karahi', hint: 'Desi', emoji: '\u{1F35B}', color: '#D79256' },
  { value: '3', label: 'Pizza', hint: 'Italian', emoji: '\u{1F35D}', color: '#7ED345' },
  { value: '4', label: 'Pasta', hint: 'Italian', emoji: '\u{1F35D}', color: '#7ED345' },
  { value: '5', label: 'Sushi', hint: 'Japanese', emoji: '\u{1F363}', color: '#E283B3' },
  { value: '6', label: 'Ramen', hint: 'Japanese', emoji: '\u{1F363}', color: '#E283B3' },
  { value: '7', label: 'Burger', hint: 'American', emoji: '\u{1F354}', color: '#E38793' },
  { value: '8', label: 'Tacos', hint: 'Mexican', emoji: '\u{1F32E}', color: '#DF8F77' },
  { value: '9', label: 'Pad Thai', hint: 'Thai', emoji: '\u{1F336}', color: '#B7D345' },
];

function open(ui: ReturnType<typeof render>) {
  fireEvent.press(ui.getByRole('button', { name: 'Category' }));
}

it('shows the placeholder until something is chosen', () => {
  const ui = render(
    <Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} placeholder="Pick a dish" />,
    { wrapper },
  );

  expect(ui.getByText('Pick a dish')).toBeTruthy();
});

it('shows the chosen label in one readable line', () => {
  const ui = render(
    <Select label="Category" value="3" options={OPTIONS} onChange={jest.fn()} />,
    { wrapper },
  );

  expect(ui.getByText(/Pizza/)).toBeTruthy();
});

it('keeps the list closed until it is asked for', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });

  // The whole point: 38 options are not on the page taking up space.
  expect(ui.queryByPlaceholderText('Search')).toBeNull();
  expect(ui.queryByText('Karahi')).toBeNull();
});

it('opens a searchable list', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });

  open(ui);

  expect(ui.getByPlaceholderText('Search')).toBeTruthy();
  expect(ui.getByText('Biryani')).toBeTruthy();
});

it('filters by the option label', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });
  open(ui);

  fireEvent.changeText(ui.getByPlaceholderText('Search'), 'piz');

  expect(ui.getByText('Pizza')).toBeTruthy();
  expect(ui.queryByText('Biryani')).toBeNull();
});

it('filters by the cuisine too, so typing a cuisine finds its dishes', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });
  open(ui);

  fireEvent.changeText(ui.getByPlaceholderText('Search'), 'japanese');

  expect(ui.getByText('Sushi')).toBeTruthy();
  expect(ui.getByText('Ramen')).toBeTruthy();
  expect(ui.queryByText('Pizza')).toBeNull();
});

it('ignores case, because nobody capitalises a search', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });
  open(ui);

  fireEvent.changeText(ui.getByPlaceholderText('Search'), 'KARAHI');

  expect(ui.getByText('Karahi')).toBeTruthy();
});

it('says so when nothing matches, rather than showing an empty page', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });
  open(ui);

  fireEvent.changeText(ui.getByPlaceholderText('Search'), 'zzzz');

  expect(ui.getByText('Nothing matches that.')).toBeTruthy();
});

it('reports the choice and closes', () => {
  const onChange = jest.fn();
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={onChange} />, {
    wrapper,
  });
  open(ui);

  fireEvent.press(ui.getByText('Sushi'));

  expect(onChange).toHaveBeenCalledWith('5');
  expect(ui.queryByPlaceholderText('Search')).toBeNull();
});

it('hides the search box for a short list, where it would be noise', () => {
  const ui = render(
    <Select
      label="Category"
      value={null}
      options={OPTIONS.slice(0, 3)}
      onChange={jest.fn()}
      searchThreshold={8}
    />,
    { wrapper },
  );

  open(ui);

  expect(ui.queryByPlaceholderText('Search')).toBeNull();
  expect(ui.getByText('Biryani')).toBeTruthy();
});

it('does not open when disabled', () => {
  const ui = render(
    <Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} disabled />,
    { wrapper },
  );

  open(ui);

  expect(ui.queryByPlaceholderText('Search')).toBeNull();
});

it('forgets the search text between openings', () => {
  const ui = render(<Select label="Category" value={null} options={OPTIONS} onChange={jest.fn()} />, {
    wrapper,
  });
  open(ui);
  fireEvent.changeText(ui.getByPlaceholderText('Search'), 'piz');
  fireEvent.press(ui.getByText('Pizza'));

  open(ui);

  // A stale query would hide almost everything and look like a broken list.
  expect(ui.getByPlaceholderText('Search').props.value).toBe('');
  expect(ui.getByText('Biryani')).toBeTruthy();
});
