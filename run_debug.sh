#!/bin/bash
export PATH="$HOME/.cargo/bin:$PATH"
echo "Starting debug run at $(date)" > debug_log.txt
node --version >> debug_log.txt 2>&1
rustc --version >> debug_log.txt 2>&1
pnpm tauri dev >> debug_log.txt 2>&1
echo "Finished debug run at $(date)" >> debug_log.txt
