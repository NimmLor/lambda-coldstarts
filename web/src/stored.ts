import { useSyncExternalStore } from 'react'

const PREFIX = 'coldstarts:'

/** What was picked this visit, for when storage refuses to keep it. */
const picked = new Map<string, string>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => void listeners.delete(listener)
}
const read = (key: string) => {
  if (picked.has(key)) return picked.get(key)!
  try {
    return localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

/**
 * State the visitor picked, kept in localStorage so the next visit starts with it. Storage can be
 * missing or refuse to work (a private window, blocked site data), and a stored value can be from
 * an older version of the page, so anything that isn't `valid` reads as `fallback`. The
 * prerendered page has `fallback`, so hydrating it does too, and the stored value follows.
 */
export const useStored = <T>(key: string, fallback: T, valid: (value: unknown) => value is T) => {
  const raw = useSyncExternalStore(
    subscribe,
    () => read(key),
    () => null
  )
  let value = fallback
  try {
    const parsed: unknown = raw === null ? undefined : JSON.parse(raw)
    if (valid(parsed)) value = parsed
  } catch {
    // An older version's or a broken value reads as `fallback`.
  }
  const set = (next: T) => {
    const json = JSON.stringify(next)
    picked.set(key, json)
    try {
      localStorage.setItem(PREFIX + key, json)
    } catch {
      // Not kept for the next visit, which is all storage adds.
    }
    for (const listener of listeners) listener()
  }
  return [value, set] as const
}

export const isString = (value: unknown): value is string => typeof value === 'string'
export const isNumber = (value: unknown): value is number => typeof value === 'number'
export const isBoolean = (value: unknown): value is boolean => typeof value === 'boolean'
