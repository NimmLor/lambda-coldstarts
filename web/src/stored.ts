import { useState } from 'react'

const PREFIX = 'coldstarts:'

/**
 * State the visitor picked, kept in localStorage so the next visit starts with it. Storage can be
 * missing or refuse to work (a private window, blocked site data), and a stored value can be from
 * an older version of the page, so anything that isn't `valid` reads as `fallback`.
 */
export const useStored = <T>(key: string, fallback: T, valid: (value: unknown) => value is T) => {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(PREFIX + key)
      const parsed: unknown = raw === null ? undefined : JSON.parse(raw)
      return valid(parsed) ? parsed : fallback
    } catch {
      return fallback
    }
  })
  const set = (next: T) => {
    setValue(next)
    try {
      localStorage.setItem(PREFIX + key, JSON.stringify(next))
    } catch {
      // Not kept for the next visit, which is all storage adds.
    }
  }
  return [value, set] as const
}

export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNumber = (value: unknown): value is number => typeof value === 'number'
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
