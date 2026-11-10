# Android build

Vesper's Android app is an arm64 Capacitor shell that can install and run the
Linux runtime used by the local Vesper server.

## Requirements

- Node.js 22 and npm
- JDK 21
- Android SDK platform 35, build-tools 35.0.0, and platform-tools
- Gradle 8.11.1 available as `gradle`

The repository does not include a Gradle wrapper. Android Studio can be used to
install the SDK components; make sure `ANDROID_HOME` (or `ANDROID_SDK_ROOT`) is
configured and `gradle` is on `PATH`.

## Build a debug APK

From the repository root:

```bash
npm ci
npm run mobile:runtime
npm run mobile:apk
```

`mobile:runtime` downloads the Ubuntu base filesystem, Node.js, and PRoot
artifacts for arm64 into `android/runtime/`. It requires network access and can
download several large files. The generated manifest records their SHA-256
hashes; the app verifies those hashes when installing the runtime.

`mobile:apk` builds the web console and server payload, syncs the Capacitor
project, and runs `gradle assembleDebug`. The APK is written under
`android/app/build/outputs/apk/debug/`.

## Build a signed release APK

Set these environment variables to the signing credentials and keystore path:

- `ANDROID_KEYSTORE_PATH`
- `ANDROID_KEYSTORE_PASSWORD`
- `ANDROID_KEY_ALIAS`
- `ANDROID_KEY_PASSWORD`

Then, from `android/`, run:

```bash
gradle assembleRelease
```

Tagged CI releases require the Android signing secrets. A manually dispatched
release workflow run from a branch may build a debug APK if no keystore is
configured. A run against a tag requires signing and will not attach a debug APK
to that release.

## Platform limitations

- The runtime only supports `arm64-v8a`.
- `targetSdk` is 28 so PRoot can execute files in app storage. This requires
  sideloading; this build is not intended for Play Store distribution.
- See [the security notes](../docs/SECURITY.md) before pairing the phone with
  another device.
