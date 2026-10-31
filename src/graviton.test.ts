import { describe, expect, it } from 'bun:test'
import { gravitonOf } from './graviton'

// The first core of a /proc/cpuinfo; the others repeat it.
const cpuinfo = (part: string) => `processor\t: 0
BogoMIPS\t: 2000.00
Features\t: fp asimd evtstrm aes pmull sha1 sha2 crc32 atomics
CPU implementer\t: 0x41
CPU architecture: 8
CPU variant\t: 0x1
CPU part\t: ${part}
CPU revision\t: 1
`

describe('gravitonOf', () => {
  it('names the Graviton of a known core', () => {
    expect(gravitonOf(cpuinfo('0xd40'))).toBe('Graviton3')
    expect(gravitonOf(cpuinfo('0xd4f'))).toBe('Graviton4')
  })

  it('passes another part number through', () => {
    expect(gravitonOf(cpuinfo('0xd8e'))).toBe('0xd8e')
  })

  it('has nothing to say off Arm', () => {
    expect(gravitonOf('processor\t: 0\nvendor_id\t: GenuineIntel\n')).toBeUndefined()
  })
})
