/**
 * Copyright 2025 RAIDS Lab
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import '@fontsource-variable/public-sans'
import '@fontsource/barlow/400.css'
import '@fontsource/barlow/500.css'
import '@fontsource/barlow/600.css'
import '@fontsource/barlow/700.css'
import '@fontsource/barlow/800.css'
import CssBaseline from '@mui/material/CssBaseline'
import { ThemeProvider as MuiThemeProvider, createTheme } from '@mui/material/styles'
import { createPaletteChannel, varAlpha } from 'minimal-shared/utils'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

type Theme = 'dark' | 'light' | 'system'

type ThemeProviderProps = {
  children: React.ReactNode
  defaultTheme?: Theme
  storageKey?: string
}

type ThemeProviderState = {
  theme: Theme
  setTheme: (theme: Theme) => void
}

const initialState: ThemeProviderState = {
  theme: 'light',
  setTheme: () => null,
}

const ThemeProviderContext = createContext<ThemeProviderState>(initialState)

const minimalGrey = createPaletteChannel({
  50: '#FCFDFD',
  100: '#F9FAFB',
  200: '#F4F6F8',
  300: '#DFE3E8',
  400: '#C4CDD5',
  500: '#919EAB',
  600: '#637381',
  700: '#454F5B',
  800: '#1C252E',
  900: '#141A21',
})
const minimalGrey500Channel = '145 158 171'
const minimalGrey900Channel = '20 26 33'
const minimalPrimaryChannel = '0 167 111'
const minimalRadius = 8
const minimalDropdownRadius = 10

const minimalPrimary = createPaletteChannel({
  lighter: '#C8FAD6',
  light: '#5BE49B',
  main: '#00A76F',
  dark: '#007867',
  darker: '#004B50',
  contrastText: '#FFFFFF',
})

const minimalPalette = {
  primary: minimalPrimary,
  grey: minimalGrey,
  common: createPaletteChannel({
    black: '#000000',
    white: '#FFFFFF',
  }),
  text: createPaletteChannel({
    primary: minimalGrey[800],
    secondary: minimalGrey[600],
    disabled: minimalGrey[500],
  }),
  background: createPaletteChannel({
    paper: '#FFFFFF',
    default: '#FFFFFF',
    neutral: minimalGrey[200],
  }),
  divider: varAlpha(minimalGrey500Channel, 0.2),
  action: {
    active: minimalGrey[600],
    hover: varAlpha(minimalGrey500Channel, 0.08),
    selected: varAlpha(minimalGrey500Channel, 0.16),
    focus: varAlpha(minimalGrey500Channel, 0.24),
    disabled: varAlpha(minimalGrey500Channel, 0.8),
    disabledBackground: varAlpha(minimalGrey500Channel, 0.24),
    hoverOpacity: 0.08,
    selectedOpacity: 0.08,
    focusOpacity: 0.12,
    activatedOpacity: 0.12,
    disabledOpacity: 0.48,
  },
}

export function ThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'vite_ui_theme_minimals',
  ...props
}: ThemeProviderProps) {
  const [theme, setTheme] = useState<Theme>(
    () => (localStorage.getItem(storageKey) as Theme) || defaultTheme
  )
  const muiTheme = useMemo(
    () =>
      createTheme({
        cssVariables: {
          cssVarPrefix: '',
          colorSchemeSelector: 'class',
        },
        colorSchemes: {
          light: {
            palette: minimalPalette,
          },
          dark: {
            palette: minimalPalette,
          },
        },
        shape: { borderRadius: minimalRadius },
        typography: {
          fontFamily:
            '"Public Sans Variable", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          fontWeightRegular: 400,
          fontWeightMedium: 500,
          fontWeightBold: 700,
          button: { textTransform: 'none' },
        },
        components: {
          MuiCssBaseline: {
            styleOverrides: {
              body: {
                backgroundColor: '#F4F6F8',
              },
            },
          },
          MuiPaper: {
            styleOverrides: {
              root: {
                backgroundImage: 'none',
              },
            },
          },
          MuiPopover: {
            styleOverrides: {
              paper: ({ theme }) => ({
                borderRadius: minimalDropdownRadius,
                border: `1px solid ${varAlpha(minimalGrey500Channel, 0.12)}`,
                boxShadow: `0 0 2px 0 ${varAlpha(minimalGrey500Channel, 0.16)}, 0 18px 36px -18px ${varAlpha(
                  minimalGrey900Channel,
                  0.28
                )}`,
                backgroundImage: 'none',
                backgroundColor: theme.palette.background.paper,
              }),
            },
          },
          MuiMenu: {
            styleOverrides: {
              list: {
                padding: 4,
              },
              paper: {
                borderRadius: minimalDropdownRadius,
              },
            },
          },
          MuiTablePagination: {
            styleOverrides: {
              root: {
                overflow: 'visible',
              },
              toolbar: {
                paddingLeft: 0,
                paddingRight: 0,
              },
            },
          },
          MuiMenuItem: {
            styleOverrides: {
              root: ({ theme }) => ({
                minHeight: 36,
                gap: theme.spacing(1.25),
                margin: theme.spacing(0.25, 0),
                padding: theme.spacing(1, 1.25),
                borderRadius: 10,
                color: theme.palette.text.secondary,
                transition: theme.transitions.create(['background-color', 'color'], {
                  duration: theme.transitions.duration.shorter,
                }),
                '&:hover': {
                  color: theme.palette.text.primary,
                  backgroundColor: theme.palette.action.hover,
                },
                '&.Mui-selected': {
                  color: theme.palette.primary.dark,
                  backgroundColor: varAlpha(minimalPrimaryChannel, 0.08),
                  '&:hover': {
                    backgroundColor: varAlpha(minimalPrimaryChannel, 0.14),
                  },
                },
                '&.Mui-disabled': {
                  opacity: 1,
                  color: theme.palette.text.disabled,
                },
              }),
            },
          },
          MuiButton: {
            defaultProps: {
              disableElevation: true,
            },
            styleOverrides: {
              root: ({ theme }) => ({
                minHeight: 36,
                borderRadius: theme.shape.borderRadius,
                fontWeight: 700,
                textTransform: 'none',
                boxShadow: 'none',
                transition: theme.transitions.create(
                  ['background-color', 'border-color', 'color', 'box-shadow', 'transform'],
                  { duration: theme.transitions.duration.shorter }
                ),
                '&:hover': {
                  boxShadow: 'none',
                },
                '&:active': {
                  transform: 'translateY(1px)',
                },
              }),
              contained: {
                boxShadow: `0 8px 16px 0 ${varAlpha(minimalPrimaryChannel, 0.22)}`,
                '&:hover': {
                  boxShadow: `0 10px 20px 0 ${varAlpha(minimalPrimaryChannel, 0.22)}`,
                },
              },
              outlined: ({ theme }) => ({
                borderColor: 'transparent',
                color: theme.palette.text.secondary,
                backgroundColor: varAlpha(minimalGrey500Channel, 0.08),
                '&:hover': {
                  borderColor: 'transparent',
                  color: theme.palette.primary.dark,
                  backgroundColor: varAlpha(minimalPrimaryChannel, 0.08),
                },
              }),
              text: ({ theme }) => ({
                color: theme.palette.text.secondary,
                '&:hover': {
                  color: theme.palette.primary.dark,
                  backgroundColor: varAlpha(minimalPrimaryChannel, 0.08),
                },
              }),
            },
          },
          MuiIconButton: {
            styleOverrides: {
              root: ({ theme }) => ({
                borderRadius: minimalDropdownRadius,
                transition: theme.transitions.create(['background-color', 'color', 'transform'], {
                  duration: theme.transitions.duration.shorter,
                }),
                '&:hover': {
                  color: theme.palette.primary.dark,
                  backgroundColor: varAlpha(minimalPrimaryChannel, 0.08),
                },
                '&:active': {
                  transform: 'translateY(1px)',
                },
              }),
            },
          },
          MuiChip: {
            styleOverrides: {
              root: ({ theme }) => ({
                borderRadius: minimalDropdownRadius,
                fontWeight: 700,
                backgroundColor: varAlpha(minimalGrey500Channel, 0.12),
                color: theme.palette.text.secondary,
              }),
              sizeSmall: {
                borderRadius: minimalRadius,
              },
              colorPrimary: ({ theme }) => ({
                color: theme.palette.primary.dark,
                backgroundColor: varAlpha(minimalPrimaryChannel, 0.12),
              }),
            },
          },
          MuiTextField: {
            defaultProps: {
              variant: 'outlined',
            },
          },
          MuiInputBase: {
            styleOverrides: {
              root: ({ theme }) => ({
                fontSize: theme.typography.pxToRem(14),
              }),
              input: ({ theme }) => ({
                '&::placeholder': {
                  color: theme.palette.text.disabled,
                  opacity: 1,
                },
              }),
            },
          },
          MuiFilledInput: {
            defaultProps: {
              disableUnderline: true,
            },
            styleOverrides: {
              root: ({ theme }) => ({
                minHeight: 36,
                borderRadius: theme.shape.borderRadius,
                backgroundColor: varAlpha(minimalGrey500Channel, 0.08),
                transition: theme.transitions.create(['background-color', 'box-shadow'], {
                  duration: theme.transitions.duration.shorter,
                }),
                '&:hover, &.Mui-focused': {
                  backgroundColor: varAlpha(minimalGrey500Channel, 0.14),
                },
                '&.Mui-focused': {
                  boxShadow: `0 0 0 3px ${varAlpha(minimalPrimaryChannel, 0.12)}`,
                },
              }),
              input: {
                paddingTop: 9,
                paddingBottom: 9,
              },
            },
          },
          MuiOutlinedInput: {
            styleOverrides: {
              root: ({ theme }) => ({
                borderRadius: theme.shape.borderRadius,
                backgroundColor: theme.palette.background.paper,
                transition: theme.transitions.create(['background-color', 'box-shadow'], {
                  duration: theme.transitions.duration.shorter,
                }),
                '& .MuiOutlinedInput-notchedOutline': {
                  borderColor: varAlpha(minimalGrey500Channel, 0.2),
                  transition: theme.transitions.create('border-color', {
                    duration: theme.transitions.duration.shorter,
                  }),
                },
                '&:hover .MuiOutlinedInput-notchedOutline': {
                  borderColor: varAlpha(minimalPrimaryChannel, 0.4),
                },
                '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                  borderColor: theme.palette.text.primary,
                  borderWidth: 1,
                },
                '&.Mui-focused': {
                  boxShadow: `0 0 0 3px ${varAlpha(minimalPrimaryChannel, 0.12)}`,
                },
              }),
              input: {
                paddingTop: 9,
                paddingBottom: 9,
              },
            },
          },
          MuiSelect: {
            styleOverrides: {
              icon: {
                right: 10,
                width: 18,
                height: 18,
              },
            },
          },
          MuiCheckbox: {
            styleOverrides: {
              root: ({ theme }) => ({
                padding: 6,
                color: theme.palette.text.disabled,
                '&.Mui-checked': {
                  color: theme.palette.primary.main,
                },
              }),
            },
          },
        },
      }),
    []
  )

  useEffect(() => {
    const root = window.document.documentElement

    root.classList.remove('light', 'dark')

    if (theme === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: dark)').matches
        ? 'dark'
        : 'light'
      setTheme(systemTheme)
      return
    }

    root.classList.add(theme)
  }, [theme])

  const value = {
    theme,
    setTheme: (theme: Theme) => {
      localStorage.setItem(storageKey, theme)
      setTheme(theme)
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      <MuiThemeProvider theme={muiTheme} defaultMode="light" modeStorageKey={`${storageKey}_mui`}>
        <CssBaseline />
        {children}
      </MuiThemeProvider>
    </ThemeProviderContext.Provider>
  )
}

export const useTheme = () => {
  const context = useContext(ThemeProviderContext)

  if (context === undefined) throw new Error('useTheme must be used within a ThemeProvider')

  return context
}
