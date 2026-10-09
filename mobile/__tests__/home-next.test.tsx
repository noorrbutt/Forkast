/**
 * Home's one "next" card: which state it picks, and what each state says.
 */

import { fireEvent, render } from '@testing-library/react-native';
import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';

import { NextCard } from '../components/home/NextCard';
import { chooseNextStep, planDayIndex, type NextStep } from '../components/home/nextStep';
import type { FoodLog, Plan, Today } from '../lib/types';
import { ThemeProvider, palettes } from '../theme';

function wrapper({ children }: { children: ReactNode }) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function at(hour: number, dayOffset = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, 0, 0, 0);
  return date;
}

const UNDER: Today = { target: 2000, consumed: 600, burned: 0, net: 600, remaining: 1400 };
const OVER: Today = { target: 2000, consumed: 2300, burned: 100, net: 2200, remaining: -200 };

const A_MEAL = { id: 'm', created_at: at(8).toISOString() } as FoodLog;

function plan(madeDaysAgo = 0): Plan {
  return {
    id: 'p',
    goal: 'lose',
    estimate_source: 'ai',
    model: 'test',
    created_at: at(9, -madeDaysAgo).toISOString(),
    generated_plan: {
      summary: 'Around 1,800 a day.',
      nudges: [],
      days: [0, 1, 2].map((index) => ({
        day: `Day ${index + 1}`,
        meals: [
          {
            slot: 'Breakfast',
            suggestion: 'oats with berries',
            approx_calories: 350,
            estimate_source: 'ai',
          },
          {
            slot: 'Lunch',
            suggestion: 'grilled salmon with quinoa',
            approx_calories: 600,
            estimate_source: 'ai',
          },
          {
            slot: 'Dinner',
            suggestion: 'daal and rice',
            approx_calories: 650,
            estimate_source: 'ai',
          },
        ],
      })),
    },
  } as unknown as Plan;
}

describe('choosing the next step', () => {
  it('is a calm note once the day is over target, whatever else is true', () => {
    const step = chooseNextStep({
      today: OVER,
      meals: [],
      open: ['dinner'],
      plan: plan(),
      now: at(14),
    });
    expect(step).toEqual({ kind: 'over', by: 200 });
  });

  it('asks for lunch when nothing is logged by early afternoon', () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [],
      open: ['lunch', 'dinner'],
      plan: plan(),
      now: at(13),
    });
    expect(step).toEqual({ kind: 'log', slot: 'lunch' });
  });

  it('does not nag in the morning', () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [],
      open: ['breakfast', 'lunch', 'dinner'],
      plan: null,
      now: at(9),
    });
    expect(step.kind).toBe('make-plan');
  });

  it("names the plan's meal for the next open slot", () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [A_MEAL],
      open: ['lunch', 'dinner'],
      plan: plan(),
      now: at(12),
    });
    expect(step).toMatchObject({ kind: 'plan', slotLabel: 'Lunch' });
  });

  it('says the plan is done for today rather than offering a new one', () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [A_MEAL],
      open: [],
      plan: plan(),
      now: at(21),
    });
    expect(step.kind).toBe('plan-done');
  });

  it('does not invent a fourth day for a three-day plan', () => {
    expect(planDayIndex(plan(2), at(10))).toBe(2);
    const step = chooseNextStep({
      today: UNDER,
      meals: [A_MEAL],
      open: ['lunch'],
      plan: plan(3),
      now: at(12),
    });
    expect(step).toEqual({ kind: 'make-plan', expired: true });
  });

  it('offers to make a plan when there is none', () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [A_MEAL],
      open: ['lunch'],
      plan: null,
      now: at(12),
    });
    expect(step).toEqual({ kind: 'make-plan', expired: false });
  });
});

describe('the card', () => {
  function show(step: NextStep) {
    const onLogSlot = jest.fn();
    const onOpenPlan = jest.fn();
    const screen = render(<NextCard step={step} onLogSlot={onLogSlot} onOpenPlan={onOpenPlan} />, {
      wrapper,
    });
    return { screen, onLogSlot, onOpenPlan };
  }

  it('reads a plan as one line: slot, dish, calories', () => {
    const step = chooseNextStep({
      today: UNDER,
      meals: [A_MEAL],
      open: ['lunch'],
      plan: plan(),
      now: at(12),
    });
    const { screen, onOpenPlan } = show(step);

    expect(screen.getByText("Today's plan")).toBeTruthy();
    expect(screen.getByText('Lunch, grilled salmon with quinoa, 600 kcal')).toBeTruthy();
    fireEvent.press(screen.getByText('See the plan'));
    expect(onOpenPlan).toHaveBeenCalled();
  });

  it('offers the slot to log, and logs that slot', () => {
    const { screen, onLogSlot } = show({ kind: 'log', slot: 'lunch' });

    fireEvent.press(screen.getByText('Log lunch'));
    expect(onLogSlot).toHaveBeenCalledWith('lunch');
  });

  it('keeps the over note calm: no button and no danger colour', () => {
    const { screen } = show({ kind: 'over', by: 200 });

    expect(screen.getByText('200 kcal over today')).toBeTruthy();
    expect(screen.queryByRole('button')).toBeNull();
    const danger = [palettes.dark.danger, palettes.light.danger].map((c) => c.toLowerCase());
    for (const node of screen.UNSAFE_queryAllByType(Text)) {
      const color = String((StyleSheet.flatten(node.props.style) as { color?: string }).color);
      expect(danger).not.toContain(color.toLowerCase());
    }
  });

  it('promises the plan length the plan actually has', () => {
    const { screen } = show({ kind: 'make-plan', expired: false });

    expect(screen.getByText('Three days of meals shaped around your goal.')).toBeTruthy();
    expect(screen.getByText('Make a meal plan')).toBeTruthy();
  });

  it('says when the plan has run out', () => {
    const { screen } = show({ kind: 'make-plan', expired: true });

    expect(screen.getByText('Your plan has run its three days')).toBeTruthy();
    expect(screen.getByText('Make a new plan')).toBeTruthy();
  });
});
