// LD_PRELOADed by the AotWithShim bootstrap (see build.sh). Works around two things the AOT
// runtime asks of the kernel that Lambda doesn't give it. Only symbols from GLIBC_2.2.5 so it
// loads on Lambda's glibc 2.34.
//
// mincore: JSC's AOT loader (tryReserveLowPages in AOTImageLoading.cpp) asks mincore() whether the
// pages below mmap_min_addr are mapped and expects ENOMEM. Lambda's seccomp filter fails mincore()
// with EPERM, so the executable refuses to start. Nothing can map those pages, so answer as the
// kernel would for an unmapped range.
//
// mmap: once at startup, the AOT runtime maps a 256 MB table without MAP_NORESERVE and aborts if
// that fails. At 128 MB, Lambda's microVM has less RAM than that, so the kernel's overcommit check
// refuses the whole mapping up front, although only the pages the table uses ever get memory. Map
// anything that big as a reservation instead: at least as large as the smallest Lambda, it could
// never be committed in full there anyway.
#define _DEFAULT_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/mman.h>
#include <sys/syscall.h>
#include <unistd.h>

#define RESERVE_FROM_BYTES ((size_t)128 << 20)

static uintptr_t mmap_min_addr(void)
{
    static uintptr_t cached = UINTPTR_MAX;
    if (cached != UINTPTR_MAX)
        return cached;
    uintptr_t value = 0;
    char text[32];
    int fd = open("/proc/sys/vm/mmap_min_addr", O_RDONLY | O_CLOEXEC);
    if (fd >= 0) {
        ssize_t length = read(fd, text, sizeof(text));
        close(fd);
        for (ssize_t i = 0; i < length && text[i] >= '0' && text[i] <= '9'; i++)
            value = value * 10 + (uintptr_t)(text[i] - '0');
    }
    cached = value;
    return value;
}

int mincore(void* address, size_t length, unsigned char* vector)
{
    long result = syscall(SYS_mincore, address, length, vector);
    if (result == -1 && errno == EPERM && (uintptr_t)address + length <= mmap_min_addr())
        errno = ENOMEM;
    return (int)result;
}

void* mmap(void* address, size_t length, int protection, int flags, int fd, off_t offset)
{
    if (length >= RESERVE_FROM_BYTES && (protection & PROT_WRITE)
        && (flags & (MAP_PRIVATE | MAP_ANONYMOUS)) == (MAP_PRIVATE | MAP_ANONYMOUS))
        flags |= MAP_NORESERVE;
    return (void*)syscall(SYS_mmap, address, length, protection, flags, fd, offset);
}

// The executable imports both names; on 64-bit glibc they're the same function.
void* mmap64(void* address, size_t length, int protection, int flags, int fd, off_t offset)
{
    return mmap(address, length, protection, flags, fd, offset);
}
