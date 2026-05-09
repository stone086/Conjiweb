# Browser Compatibility and Chaos Results

Status: PENDING_REAL_DEVICE_TESTS

## Browser matrix

| Browser | OS/device | Login | Messaging | Upload | OMEMO | Push/PWA | Reconnect | Result | Evidence |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|
| Chrome | Windows/macOS/Android | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |
| Edge | Windows | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |
| Firefox | Windows/Linux | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |
| Safari | macOS 16+ | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |
| iOS Safari PWA | iPhone | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |
| Samsung Internet | Android | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | PENDING | screenshot/log |

## Chaos cases

| Case | Result | Evidence |
|---|---:|---|
| Network drops while sending a message | PENDING | screenshot + console log |
| Token expires while uploading | PENDING | network trace |
| Prosody restarts during active chat | PENDING | reconnect log |
| MinIO unavailable during upload | PENDING | upload UI error screenshot |
| Browser closes mid-send | PENDING | pending/sent reconciliation screenshot |
