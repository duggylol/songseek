#!/bin/bash
# Idempotent patches to make go-librespot's pipe backend build & run on Windows.
set -e
R="$1"   # go-librespot repo dir

# 1) Compile the alsa stub (provides newAlsaOutput) on windows too, not just darwin.
sed -i '' 's#^//go:build darwin$#//go:build darwin || windows#' "$R/output/driver-alsa-stub.go"

# 2) Replace the Unix FIFO open (O_NONBLOCK + SetNonblock) with a portable helper.
python3 - "$R/output/driver-pipe.go" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
# drop the syscall import (only used for the FIFO dance)
s = s.replace('\t"sync"\n\t"syscall"\n', '\t"sync"\n')
block_start = s.index('\t// Open the FIFO for writing')
block_end = s.index('go out.outputLoop()')
replacement = (
'\tout.file, err = openOutputPipe(opts.OutputPipe)\n'
'\tif err != nil {\n'
'\t\treturn nil, fmt.Errorf("failed to open output pipe: %w", err)\n'
'\t}\n\n\t'
)
s = s[:block_start] + replacement + s[block_end:]
open(p, 'w').write(s)
print("patched driver-pipe.go")
PY

# 3a) Unix implementation: original non-blocking FIFO open semantics.
cat > "$R/output/driver-pipe_unix.go" <<'GO'
//go:build !windows

package output

import (
	"os"
	"syscall"
)

// openOutputPipe opens a Unix FIFO for writing, failing fast if no reader is present.
func openOutputPipe(path string) (*os.File, error) {
	f, err := os.OpenFile(path, os.O_WRONLY|syscall.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	if err := syscall.SetNonblock(int(f.Fd()), false); err != nil {
		_ = f.Close()
		return nil, err
	}
	return f, nil
}
GO

# 3b) Windows implementation: connect to a named pipe the host app is serving.
cat > "$R/output/driver-pipe_windows.go" <<'GO'
//go:build windows

package output

import "os"

// openOutputPipe opens a Windows named pipe (e.g. \\.\pipe\name) for writing.
// The host application creates the pipe server before starting the daemon.
func openOutputPipe(path string) (*os.File, error) {
	return os.OpenFile(path, os.O_WRONLY, 0)
}
GO

# 4) Windows can't rename a file that still has an open handle: close the temp
# state file before renaming it over state.json (upstream bug — "Sharing violation"
# fatal at startup on Windows, harmless on unix).
python3 - "$R/cmd/daemon/file_state_store.go" <<'PY'
import sys
p = sys.argv[1]
s = open(p).read()
old = '''	if err := json.NewEncoder(tmpFile).Encode(state); err != nil {
		return fmt.Errorf("failed writing marshalled app state: %w", err)
	}

	if err := os.Rename(tmpFile.Name(), s.statePath); err != nil {
		return fmt.Errorf("failed replacing app state file: %w", err)
	}'''
new = '''	if err := json.NewEncoder(tmpFile).Encode(state); err != nil {
		_ = tmpFile.Close()
		_ = os.Remove(tmpFile.Name())
		return fmt.Errorf("failed writing marshalled app state: %w", err)
	}

	// Close before rename: Windows cannot rename a file with an open handle.
	if err := tmpFile.Close(); err != nil {
		_ = os.Remove(tmpFile.Name())
		return fmt.Errorf("failed closing temporary app state file: %w", err)
	}

	if err := os.Rename(tmpFile.Name(), s.statePath); err != nil {
		_ = os.Remove(tmpFile.Name())
		return fmt.Errorf("failed replacing app state file: %w", err)
	}'''
if new in s:
    print("state store already patched")
elif old in s:
    open(p, 'w').write(s.replace(old, new))
    print("patched file_state_store.go")
else:
    sys.exit("ERROR: file_state_store.go did not match expected content")
PY

echo "patches applied"
