/** Arm's part numbers of the Neoverse cores in each Graviton, as `/proc/cpuinfo` lists them. */
const PARTS: Record<string, string> = {
  '0xd0c': 'Graviton2',
  '0xd40': 'Graviton3',
  '0xd4f': 'Graviton4',
}

/** Which Graviton `/proc/cpuinfo` describes; another core's part number as it is, undefined off Arm. */
export const gravitonOf = (cpuinfo: string) => {
  const part = /^CPU part\s*:\s*(0x[0-9a-f]+)$/im.exec(cpuinfo)?.[1]?.toLowerCase()
  return part && (PARTS[part] ?? part)
}
