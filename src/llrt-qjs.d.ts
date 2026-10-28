/** The part of LLRT's `llrt:qjs` module src/llrt-env.ts uses; see LLRT's API.md. */
declare module 'llrt:qjs' {
  export function ComputeMemoryUsage(): {
    /** Bytes QuickJS has allocated. */
    malloc_size: number
    /** Bytes of that in use. */
    memory_used_size: number
  }
}
