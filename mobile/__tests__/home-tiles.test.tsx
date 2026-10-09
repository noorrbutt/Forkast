/**
 * Home's Today strip, one tile at a time.
 *
 * The no-photo tile is tested first and hardest, because it is the one most
 * meals will actually render as: people type meals far more often than they
 * photograph them, and a typed meal that looks like a broken photo tile is
 * how the strip would look great in screenshots and empty in real use.
 */

import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { Image, StyleSheet, Text } from 'react-native';

jest.mock('../lib/api', () => {
  const actual = jest.requireActual('../lib/api');
  return { ...actual, getAccessToken: () => 'test-token' };
});

import { MealTile, NoPhotoMealTile, PhotoMealTile, tileLabel } from '../components/home/MealTile';
import { TILE_PHOTO_EDGE, photoSource } from '../hooks/usePhoto';
import { openSlots, slotOf, todaysMeals } from '../components/home/todayMeals';
import { Icon } from '../components/ui';
import type { FoodLog } from '../lib/types';
import { ThemeProvider, palettes, type } from '../theme';

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

/** A local time today, as the ISO string the server would send. */
function todayAt(hour: number, minute = 0): string {
  const at = new Date();
  at.setHours(hour, minute, 0, 0);
  return at.toISOString();
}

function meal(overrides: Partial<FoodLog> = {}): FoodLog {
  return {
    has_photo: false,
    id: 'log-1',
    dish_name: 'chicken biryani',
    category_id: 3,
    restaurant_id: null,
    area: null,
    rating: 4,
    fun_scale: null,
    friend_scale: null,
    serving_size: 'medium',
    estimated_calories: 640,
    estimate_source: 'ai',
    calorie_source: 'category',
    protein_g: null,
    carbs_g: null,
    fat_g: null,
    refined: true,
    created_at: todayAt(13),
    category: { id: 3, slug: 'biryani', name: 'Biryani', is_junk: false } as FoodLog['category'],
    restaurant: null,
    ...overrides,
  };
}

const SIZE = { width: 112, height: 140 };

function flat(style: unknown): Record<string, unknown> {
  return (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;
}

describe('the no-photo tile', () => {
  it('is announced as slot, dish and calories in one label', () => {
    const screen = render(<NoPhotoMealTile log={meal()} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    const tile = screen.getByRole('button');
    expect(tile.props.accessibilityLabel).toBe('Lunch, Chicken Biryani, 640 kcal');
  });

  it('sets the dish name large and shows the calorie pill', () => {
    const screen = render(<NoPhotoMealTile log={meal()} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    const name = screen.getByText('Chicken Biryani');
    expect(flat(name.props.style).fontSize).toBe(type.subtitle.fontSize);
    // The pill is a full step quieter, so the name is the picture.
    const pill = screen.getByText('640 kcal');
    expect(flat(pill.props.style).fontSize as number).toBeLessThan(type.subtitle.fontSize);
    expect(screen.UNSAFE_queryAllByType(Text).length).toBeGreaterThan(0);
  });

  it('is a solid surfaceAlt tile with a category glyph, never an empty photo frame', () => {
    const screen = render(<NoPhotoMealTile log={meal()} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    // No image is requested at all for a meal that has none.
    expect(screen.UNSAFE_queryAllByType(Image)).toHaveLength(0);

    const tile = screen.getByTestId('today-tile-log-1');
    const fill = String(flat(tile.props.style).backgroundColor).toLowerCase();
    expect([palettes.dark.surfaceAlt.toLowerCase(), palettes.light.surfaceAlt.toLowerCase()]).toContain(
      fill,
    );

    // The same "meal" glyph the diary's compact row uses, tinted by category.
    const icons = screen.UNSAFE_queryAllByType(Icon);
    expect(icons.map((icon) => icon.props.name)).toEqual(['meal']);
    const glyphFill = String(
      flat(screen.getByTestId('today-tile-glyph').props.style).backgroundColor,
    ).toLowerCase();
    expect([palettes.dark.successSoft, palettes.light.successSoft].map((c) => c.toLowerCase())).toContain(
      glyphFill,
    );
  });

  it('tints the glyph as junk for a junk meal', () => {
    const junk = meal({
      category: { id: 9, slug: 'burger', name: 'Burger', is_junk: true } as FoodLog['category'],
    });
    const screen = render(<NoPhotoMealTile log={junk} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    const glyphFill = String(
      flat(screen.getByTestId('today-tile-glyph').props.style).backgroundColor,
    ).toLowerCase();
    expect([palettes.dark.dangerSoft, palettes.light.dangerSoft].map((c) => c.toLowerCase())).toContain(
      glyphFill,
    );
  });

  it('opens the meal it shows', () => {
    const onOpen = jest.fn();
    const screen = render(<NoPhotoMealTile log={meal()} size={SIZE} onOpen={onOpen} />, {
      wrapper,
    });

    fireEvent.press(screen.getByRole('button'));
    expect(onOpen).toHaveBeenCalledWith('log-1');
  });

  it('is sized to the size it is given', () => {
    const screen = render(<NoPhotoMealTile log={meal()} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });
    const style = flat(screen.getByTestId('today-tile-log-1').props.style);
    expect(style.width).toBe(112);
    expect(style.height).toBe(140);
  });
});

describe('the photo tile', () => {
  const photographed = meal({ id: 'log-2', has_photo: true, dish_name: 'grilled salmon' });

  it('asks the server for the tile-sized copy, not the full photo', () => {
    const screen = render(<PhotoMealTile log={photographed} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    // useAuthedImage hands native Image a one-entry source array.
    const [source] = screen.UNSAFE_getByType(Image).props.source;
    expect(source.uri).toMatch(/\/logs\/log-2\/photo\?v=\d+&w=560$/);
    expect(source.headers).toEqual({ Authorization: 'Bearer test-token' });
  });

  it('carries the same label, pill and name as the no-photo tile', () => {
    const screen = render(<PhotoMealTile log={photographed} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    expect(screen.getByRole('button').props.accessibilityLabel).toBe(
      'Lunch, Grilled Salmon, 640 kcal',
    );
    expect(screen.getByText('640 kcal')).toBeTruthy();
    expect(screen.getByText('Grilled Salmon')).toBeTruthy();
  });

  it('falls back to the no-photo tile when the picture will not load', () => {
    const screen = render(<PhotoMealTile log={photographed} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });

    fireEvent(screen.getByTestId('today-tile-photo'), 'error');

    expect(screen.queryByTestId('today-tile-photo')).toBeNull();
    expect(screen.getByTestId('today-tile-glyph')).toBeTruthy();
  });

  it('is chosen by has_photo', () => {
    const typed = render(<MealTile log={meal()} size={SIZE} onOpen={jest.fn()} />, { wrapper });
    expect(typed.queryByTestId('today-tile-photo')).toBeNull();

    const pictured = render(<MealTile log={photographed} size={SIZE} onOpen={jest.fn()} />, {
      wrapper,
    });
    expect(pictured.getByTestId('today-tile-photo')).toBeTruthy();
  });
});

describe('photo urls', () => {
  it('leaves the full-size url alone for the diary and the meal screen', () => {
    expect(photoSource('abc', 't', 3).uri).toMatch(/\/logs\/abc\/photo\?v=3$/);
    expect(photoSource('abc', 't', 3, TILE_PHOTO_EDGE).uri).toMatch(/\/logs\/abc\/photo\?v=3&w=560$/);
  });
});

describe('which slot a meal belongs to', () => {
  it('uses the same hour bands as the reminder signal', () => {
    const at = (hour: number) => {
      const date = new Date();
      date.setHours(hour, 0, 0, 0);
      return date;
    };
    expect(slotOf(at(4))).toBeNull();
    expect(slotOf(at(5))).toBe('breakfast');
    expect(slotOf(at(11))).toBe('lunch');
    expect(slotOf(at(16))).toBe('dinner');
    expect(slotOf(at(23))).toBe('dinner');
  });

  it("keeps only today's meals, oldest first, and names the open slots", () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const logs = [
      meal({ id: 'dinner', created_at: todayAt(19) }),
      meal({ id: 'breakfast', created_at: todayAt(8) }),
      meal({ id: 'old', created_at: yesterday.toISOString() }),
      meal({ id: 'saving', created_at: todayAt(12), pending: true }),
    ];

    const today = todaysMeals(logs, new Date());
    expect(today.map((log) => log.id)).toEqual(['breakfast', 'dinner']);
    expect(openSlots(today)).toEqual(['lunch']);
  });

  it('labels a small-hours meal without inventing a slot for it', () => {
    expect(tileLabel(meal({ created_at: todayAt(2) }))).toBe('Late night, Chicken Biryani, 640 kcal');
  });
});
