// Preloaded into Bun AOT executables on Lambda by infra/build.ts.
//
// JSC's AOT loader (tryReserveLowPages in AOTImageLoading.cpp) asks mincore() whether the pages
// below mmap_min_addr are mapped and expects ENOMEM. Lambda's seccomp filter fails mincore() with
// EPERM, so the executable refuses to start. Nothing can map those pages, so answer as the kernel
// would for an unmapped range. Only symbols from GLIBC_2.2.5 so it loads on Lambda's glibc 2.34.
#define _DEFAULT_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <stddef.h>
#include <stdint.h>
#include <sys/syscall.h>
#include <unistd.h>

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
