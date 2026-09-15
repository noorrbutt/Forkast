import { createContext, useContext, useMemo, type ReactNode } from 'react';
import { useColorScheme } from 'react-native';

import { layout, palettes, radius, spacing, type, type Palette, type ThemeName } from './tokens';

export type Theme = {
  name: ThemeName;
  colors: Palette;
  radius: typeof radius;
  spacing: typeof spacing;
  layout: typeof layout;
  type: typeof type;
  isDark: boolean;
};

function buildTheme(name: ThemeName): Theme {
  return {
    name,
    colors: palettes[name],
    radius,
    spacing,
    layout,
    type,
    isDark: name === 'dark',
  };
}

const ThemeContext = createContext<Theme>(buildTheme('dark'));

export function ThemeProvider({ children }: { children: ReactNode }) {
  // Follows the system appearance. app.json sets userInterfaceStyle to automatic
  // so this updates live when the device flips between light and dark.
  const scheme = useColorScheme();
  const name: ThemeName = scheme === 'light' ? 'light' : 'dark';
  const value = useMemo(() => buildTheme(name), [name]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  return useContext(ThemeContext);
}
