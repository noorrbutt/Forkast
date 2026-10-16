/**
 * HeroWash's pullUp math: boolean keeps its old meaning, a number reaches
 * exactly that far up while paying the same amount back as paddingTop so
 * the content inside sits where it would have without the pull.
 */

import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { HeroWash } from '../components/ui/HeroWash';
import { ThemeProvider } from '../theme';

const wrap = ({ children }: { children: React.ReactNode }) => (
  <ThemeProvider>{children}</ThemeProvider>
);

function styles(node: { props: { style?: unknown } }) {
  return Object.assign({}, ...[node.props.style].flat(4).filter((s) => s && typeof s === 'object'));
}

describe('HeroWash pullUp', () => {
  it('pulls up by bleed when true, the existing behaviour', () => {
    const { getByTestId } = render(
      <HeroWash bleed={24} pullUp={true}>
        <Text testID="inner">x</Text>
      </HeroWash>,
      { wrapper: wrap },
    );

    const outer = getByTestId('hero-wash-outer');
    expect(styles(outer).marginTop).toBe(-24);
  });

  it('pulls up by nothing when false, the existing behaviour', () => {
    const { getByTestId } = render(
      <HeroWash bleed={24} pullUp={false}>
        <Text testID="inner">x</Text>
      </HeroWash>,
      { wrapper: wrap },
    );

    expect(styles(getByTestId('hero-wash-outer')).marginTop).toBe(0);
  });

  it('pulls up by exactly the number given', () => {
    const { getByTestId } = render(
      <HeroWash bleed={24} pullUp={83}>
        <Text testID="inner">x</Text>
      </HeroWash>,
      { wrapper: wrap },
    );

    expect(styles(getByTestId('hero-wash-outer')).marginTop).toBe(-83);
  });

  it('pays the pulled amount back as paddingTop plus spacing.lg, so content does not move', () => {
    const pulled = render(
      <HeroWash bleed={24} pullUp={83}>
        <Text testID="inner">x</Text>
      </HeroWash>,
      { wrapper: wrap },
    );
    const notPulled = render(
      <HeroWash bleed={24} pullUp={false}>
        <Text testID="inner">x</Text>
      </HeroWash>,
      { wrapper: wrap },
    );

    const pulledGradient = styles(pulled.getByTestId('hero-wash-gradient'));
    const notPulledGradient = styles(notPulled.getByTestId('hero-wash-gradient'));

    // The outer View's -83 margin plus the gradient's own paddingTop below
    // must land the content at the same absolute position the unpulled,
    // header-based layout already puts it at: 83 of margin cancelled by 83
    // of the extra padding this case adds on top of the unpulled baseline.
    expect(pulledGradient.paddingTop - notPulledGradient.paddingTop).toBe(83);
  });
});
