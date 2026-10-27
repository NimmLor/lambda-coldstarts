// SST sets it to PerfApi's Function URL, see infra/perf.ts; the build inlines it.
declare namespace NodeJS {
  interface ProcessEnv {
    readonly BUN_PUBLIC_API_URL: string
  }
}
