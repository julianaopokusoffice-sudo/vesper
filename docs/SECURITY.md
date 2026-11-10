# Security notes

These notes describe the intended trust boundaries and practical limitations of
the current implementation. They are not an independent security audit.

## Network surfaces

- The runtime listens on all interfaces by default so paired devices on a LAN
  can connect. The management API is restricted to loopback clients; set
  `VESPER_HOST=127.0.0.1` to bind the listener to loopback only when device
  pairing is not needed.
- The peer protocol is exposed under `/link`. Pairing requires a short-lived,
  single-use code and establishes per-peer credentials. Authenticated requests
  use HMAC signatures, timestamps, and single-use nonces to detect tampering and
  replay.
- The peer protocol does not provide transport encryption. Use it only on a
  network you trust, or put it behind a TLS-protected tunnel when connecting
  across an untrusted network. Do not expose the management API through a
  public reverse proxy or tunnel.
- Keep peer grants narrow. A peer can only use the capabilities granted to it;
  in particular, `shell` permits command execution on the paired device.

## Local data and execution

- Vesper stores its SQLite database, configuration, and key file under
  `~/.vesper` by default (or `VESPER_HOME`). Provider secrets are sealed with
  AES-256-GCM using a key stored alongside the database. This protects against
  casual exposure of the database alone, but not against an attacker who can
  read the whole Vesper home directory or run code as your user. Electron can
  additionally bind the key to the operating system keychain.
- File tools constrain paths to the configured workspace. This is not an
  operating-system sandbox: shell commands, plugins, and other child processes
  run with the current user's permissions. Review approvals and only run
  plugins or commands you trust. CLI `--yes` and peer `shell` grants bypass
  interactive approval for their respective operations.
- If you use a hosted model provider, the prompts and context sent for inference
  leave your machine and are subject to that provider's data policies. Vesper
  itself does not relay those requests.

## Android

The Android build targets SDK 28 so its PRoot runtime can execute files in app
storage. Distribute it by sideloading only to devices you control; it is not a
Play Store-targeted build. See [the Android build guide](../android/README.md).

## Before pairing or exposing a device

1. Use a trusted network or a TLS-protected tunnel.
2. Grant only the peer capabilities it needs, and revoke them when no longer
   needed.
3. Keep the Vesper home directory private and back it up together with its key
   file if you need to preserve access to sealed credentials.
4. Treat model output, fetched web content, plugins, and shell commands as
   untrusted input.
