/**
 * Failures are said out loud, not only drawn.
 *
 * A screen reader does not move focus to something that merely appeared, so an
 * error rendered into the middle of a screen is an error the reader does not
 * know about: they are still waiting on a request that already failed, and the
 * only way to find out is to swipe around until they land on it.
 */

import { render, screen } from '@testing-library/react-native';
import { AccessibilityInfo } from 'react-native';

import { Dialog } from '../components/ui/Dialog';
import { ErrorState } from '../components/ui/ErrorState';
import { FormError } from '../components/ui/FormError';
import { ThemeProvider } from '../theme';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

describe('an error that appears on screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is announced as soon as it is shown', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    render(<ErrorState title="Could not load" message="The server did not answer." />, {
      wrapper: wrap,
    });

    expect(announce).toHaveBeenCalledWith('Could not load. The server did not answer.');
  });

  it('announces the new text when the failure changes', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    const { rerender } = render(<ErrorState title="Could not load" message="First." />, {
      wrapper: wrap,
    });
    rerender(
      <ThemeProvider>
        <ErrorState title="Still failing" message="Second." />
      </ThemeProvider>,
    );

    expect(announce).toHaveBeenLastCalledWith('Still failing. Second.');
  });

  it('carries the role and live region a reader needs', () => {
    render(<ErrorState title="Could not load" message="The server did not answer." />, {
      wrapper: wrap,
    });

    // Looked up by the label rather than by the visible text, because the two
    // Text nodes are what a sighted user reads and this one string is what a
    // screen reader is handed instead.
    const alert = screen.getByLabelText('Could not load. The server did not answer.');

    expect(alert.props.accessibilityRole).toBe('alert');
    expect(alert.props.accessibilityLiveRegion).toBe('assertive');
  });
});

describe('a dialog that opens', () => {
  beforeEach(() => jest.clearAllMocks());

  it('announces its title and message, since nothing moves focus onto a Modal by itself', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    render(
      <Dialog
        visible
        onDismiss={() => {}}
        title="Delete this meal?"
        message="This cannot be undone."
        actions={[{ label: 'Delete', onPress: () => {} }]}
      />,
      { wrapper: wrap },
    );

    expect(announce).toHaveBeenCalledWith('Delete this meal?. This cannot be undone.');
  });

  it('announces just the title when there is no message', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    render(
      <Dialog visible onDismiss={() => {}} title="Your name" actions={[{ label: 'Save', onPress: () => {} }]} />,
      { wrapper: wrap },
    );

    expect(announce).toHaveBeenCalledWith('Your name');
  });

  it('says nothing while closed, and announces once it opens', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    const { rerender } = render(
      <Dialog
        visible={false}
        onDismiss={() => {}}
        title="Delete this meal?"
        actions={[{ label: 'Delete', onPress: () => {} }]}
      />,
      { wrapper: wrap },
    );
    expect(announce).not.toHaveBeenCalled();

    rerender(
      <ThemeProvider>
        <Dialog
          visible
          onDismiss={() => {}}
          title="Delete this meal?"
          actions={[{ label: 'Delete', onPress: () => {} }]}
        />
      </ThemeProvider>,
    );
    expect(announce).toHaveBeenCalledWith('Delete this meal?');
  });
});

describe('an inline field error', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is announced as soon as it is shown', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    render(<FormError>Incorrect email or password</FormError>, { wrapper: wrap });

    expect(announce).toHaveBeenCalledWith('Incorrect email or password');
  });

  it('says nothing for an empty or blank message', () => {
    const announce = jest.spyOn(AccessibilityInfo, 'announceForAccessibility');

    render(<FormError>{'   '}</FormError>, { wrapper: wrap });

    expect(announce).not.toHaveBeenCalled();
  });
});
